import {
	InMemorySyncStorage,
	TLSocketRoom,
	type RoomSnapshot,
	type WebSocketMinimal,
} from "@tldraw/sync-core";
import type { TLRecord } from "@tldraw/tlschema";
import { createTenantScope } from "@beignet/core/ports";
import type { AppContext } from "@/app-context";
import type { DocumentGrant } from "@/features/documents/ports";
import {
	canvasSchema,
	canvasFingerprint,
	projectCanvasRoom,
} from "@/features/canvases/lib/document";
import { canEditContent } from "@/lib/org-roles";

type Socket = Pick<WebSocketMinimal, "send" | "close" | "readyState">;
type Entry = {
	room: TLSocketRoom<TLRecord>;
	storage: InMemorySyncStorage<TLRecord>;
	ctx: AppContext;
	grant: DocumentGrant;
	revision: number;
	savedClock: number;
	fingerprint: string;
	flight: Promise<void>;
	lastUsed: number;
	deleted: boolean;
};
export type PreparedCanvasConnection = {
	entry: Entry;
	grant: DocumentGrant;
	role: string;
};
export type CanvasConnection = {
	entry: Entry;
	grant: DocumentGrant;
	role: string;
	checkedAt: number;
	id: string;
	socket: Socket;
	closed: boolean;
	incoming: Promise<void>;
	outgoing: Promise<void>;
};

/** tldraw owns the sync protocol. This host owns authorization and durable SQL commits. */
export function createCanvasSyncServer(options: {
	verify(token: string): DocumentGrant;
	authorize(grant: DocumentGrant): Promise<{ ctx: AppContext; role: string }>;
	workerOwnerId?: string;
	canWrite?: () => boolean;
	onStorageHealth?: (name: string, healthy: boolean) => void;
}) {
	const rooms = new Map<string, Promise<Entry>>();
	const connections = new Set<CanvasConnection>();
	let stopping = false;
	const name = (grant: DocumentGrant) =>
		`canvas:${grant.workspaceId}:${grant.pageId}`;
	function persist(entry: Entry): Promise<void> {
		const flight = entry.flight
			.catch(() => {})
			.then(async () => {
				if (entry.deleted) return;
				const snapshot = entry.storage.getSnapshot();
				const clock = snapshot.documentClock ?? 0;
				if (clock === entry.savedClock) return;
				if (options.canWrite?.() === false)
					throw new Error("Worker lease unavailable");
				const projected = projectCanvasRoom(snapshot);
				const roomJson = JSON.stringify(snapshot);
				if (roomJson.length > 8 * 1024 * 1024)
					throw new Error("Canvas exceeds storage limit");
				const fingerprint = await canvasFingerprint(projected);
				const result = await entry.ctx.ports.uow.transaction(async (tx) => {
					if (options.workerOwnerId)
						await tx.documents.assertWorkerLease(options.workerOwnerId);
					return tx.canvases.commitSyncRoom(
						createTenantScope({ id: entry.grant.workspaceId }),
						{
							id: entry.grant.pageId,
							roomJson,
							snapshotJson: JSON.stringify(projected),
							baseRevision: entry.revision,
						},
					);
				});
				entry.revision = result.revision;
				entry.savedClock = clock;
				entry.fingerprint = fingerprint;
				for (const connection of connections) {
					if (connection.entry === entry && !connection.closed)
						entry.room.sendCustomMessage(connection.id, {
							type: "canvas-saved",
							fingerprint,
							revision: entry.revision,
						});
				}
				options.onStorageHealth?.(name(entry.grant), true);
			})
			.catch(async (error) => {
				// Intentional resource deletion must not leave a permanently dirty
				// room blocking health checks or graceful shutdown. A failed lookup
				// is never evidence of deletion: preserve the room on storage errors.
				let deleted = false;
				try {
					deleted = !(await entry.ctx.ports.canvases.findSyncRoom(
						createTenantScope({ id: entry.grant.workspaceId }),
						entry.grant.pageId,
					));
				} catch {}
				if (deleted) {
					entry.deleted = true;
					for (const connection of [...connections])
						if (connection.entry === entry)
							close(connection, 4404, "Canvas deleted");
					entry.room.close();
					rooms.delete(name(entry.grant));
					options.onStorageHealth?.(name(entry.grant), true);
					return;
				}
				options.onStorageHealth?.(name(entry.grant), false);
				throw error;
			});
		entry.flight = flight;
		return flight;
	}
	async function load(grant: DocumentGrant, ctx: AppContext) {
		const key = name(grant);
		let promise = rooms.get(key);
		if (!promise) {
			promise = (async () => {
				const stored = await ctx.ports.canvases.findSyncRoom(
					createTenantScope({ id: grant.workspaceId }),
					grant.pageId,
				);
				if (!stored) throw new Error("Canvas not migrated or deleted");
				const snapshot: RoomSnapshot = JSON.parse(stored.roomJson);
				const fingerprint = await canvasFingerprint(
					projectCanvasRoom(snapshot),
				);
				const storage = new InMemorySyncStorage<TLRecord>({ snapshot });
				const room = new TLSocketRoom<TLRecord>({
					storage,
					schema: canvasSchema,
				});
				return {
					room,
					storage,
					ctx,
					grant,
					revision: stored.revision,
					savedClock: snapshot.documentClock ?? 0,
					fingerprint,
					flight: Promise.resolve(),
					lastUsed: Date.now(),
					deleted: false,
				};
			})();
			rooms.set(key, promise);
			void promise.catch(() => {
				if (rooms.get(key) === promise) rooms.delete(key);
			});
		}
		return promise;
	}
	function close(
		connection: CanvasConnection,
		code = 4401,
		reason = "Canvas access changed",
	) {
		if (connection.closed) return;
		connection.closed = true;
		connection.socket.close(code, reason);
		connection.entry.room.handleSocketClose(connection.id);
		connection.entry.lastUsed = Date.now();
		connections.delete(connection);
	}
	async function check(connection: CanvasConnection) {
		if (connection.grant.expiresAt <= Date.now()) throw new Error("Expired");
		const next = await options.authorize(connection.grant);
		if (next.role !== connection.role)
			throw new Error("Role changed; reconnect");
		connection.checkedAt = Date.now();
	}
	const timer = setInterval(() => {
		for (const connection of connections) {
			if (Date.now() - connection.checkedAt >= 30_000)
				void check(connection).catch(() => close(connection));
		}
		for (const [key, promise] of rooms)
			void promise
				.then(async (entry) => {
					await persist(entry);
					if (
						!entry.room.getNumActiveSessions() &&
						Date.now() - entry.lastUsed > 30_000 &&
						rooms.get(key) === promise
					) {
						entry.room.close();
						rooms.delete(key);
						options.onStorageHealth?.(key, true);
					}
				})
				.catch(() => {});
	}, 2000);
	timer.unref();
	return {
		async prepare(request: Request) {
			if (stopping || options.canWrite?.() === false)
				throw new Error("Worker unavailable");
			const url = new URL(request.url);
			const match = /^\/canvas\/([a-f0-9-]{36})$/.exec(url.pathname);
			const token = url.searchParams.get("token");
			if (!match || !token) throw new Error("Invalid canvas connection");
			const grant = options.verify(token);
			if (
				grant.kind !== "canvas" ||
				grant.pageId !== match[1] ||
				grant.generation !== 0
			)
				throw new Error("Wrong canvas");
			const { ctx, role } = await options.authorize(grant);
			const entry = await load(grant, ctx);
			entry.lastUsed = Date.now();
			return { entry, grant, role };
		},
		open(prepared: PreparedCanvasConnection, socket: Socket): CanvasConnection {
			const connection: CanvasConnection = {
				...prepared,
				id: crypto.randomUUID(),
				checkedAt: Date.now(),
				socket,
				closed: false,
				incoming: Promise.resolve(),
				outgoing: Promise.resolve(),
			};
			prepared.entry.lastUsed = Date.now();
			connections.add(connection);
			const durableSocket: WebSocketMinimal = {
				get readyState() {
					return socket.readyState;
				},
				close(code, reason) {
					close(connection, code, reason);
				},
				send(message) {
					// Do not deliver even native push acknowledgements until the room state is durable.
					// Keep per-socket ordering while allowing the SDK to batch record changes normally.
					connection.outgoing = connection.outgoing
						.then(async () => {
							if (connection.closed) return;
							await persist(prepared.entry);
							if (!connection.closed && socket.readyState === 1)
								socket.send(message);
						})
						.catch(() => close(connection, 1011, "Canvas storage unavailable"));
				},
			};
			prepared.entry.room.handleSocketConnect({
				sessionId: connection.id,
				socket: durableSocket,
				isReadonly: !canEditContent(prepared.role),
			});
			return connection;
		},
		message(connection: CanvasConnection, message: string | Uint8Array) {
			connection.incoming = connection.incoming
				.then(async () => {
					if (connection.closed) return;
					if (stopping || options.canWrite?.() === false)
						throw new Error("Worker unavailable");
					if (connection.grant.expiresAt <= Date.now())
						throw new Error("Expired");
					if (Date.now() - connection.checkedAt >= 5000)
						await check(connection);
					connection.entry.lastUsed = Date.now();
					connection.entry.room.handleSocketMessage(connection.id, message);
					// Continue ingesting native updates while SQL is in flight. The next
					// commit coalesces them; the outbound gate still waits for durability.
					void persist(connection.entry)
						.then(() => {
							if (!connection.closed)
								connection.entry.room.sendCustomMessage(connection.id, {
									type: "canvas-saved",
									fingerprint: connection.entry.fingerprint,
									revision: connection.entry.revision,
								});
						})
						.catch(() => close(connection, 1011, "Canvas storage unavailable"));
				})
				.catch(() => close(connection));
		},
		close,
		closeConnections() {
			for (const connection of [...connections])
				close(connection, 1012, "Collaboration restarting");
		},
		async flush() {
			await Promise.all(
				[...rooms.values()].map(async (promise) => persist(await promise)),
			);
		},
		async stop() {
			stopping = true;
			for (const connection of [...connections])
				close(connection, 1012, "Collaboration restarting");
			try {
				await Promise.all(
					[...rooms.values()].map(async (promise) => persist(await promise)),
				);
			} catch (error) {
				stopping = false;
				throw error;
			}
			clearInterval(timer);
			for (const promise of rooms.values()) (await promise).room.close();
			rooms.clear();
		},
	};
}
export type CanvasSyncServer = ReturnType<typeof createCanvasSyncServer>;

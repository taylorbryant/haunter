import { Hocuspocus } from "@hocuspocus/server";
import * as Y from "yjs";
import { createPersistenceReceipt } from "@/features/documents/receipt";
import type { AppContext } from "@/app-context";
import { pageDocumentName } from "@/features/documents/model";
import type { DocumentGrant } from "@/features/documents/ports";
import { createTenantScope } from "@beignet/core/ports";
import { canEditContent } from "@/lib/org-roles";
import { loadPageBody, persistPageBody } from "./persistence";
import { DocumentRestoredError } from "@/features/documents/restoration";
import { trackAssignmentChanges } from "./assignment-attribution";
import { deliverTaskAssignmentNotifications } from "@/features/tasks/notifications/assigned";
import { validateDocumentUpdate } from "./validate-update";

type ConnectionContext = {
	grant: DocumentGrant;
	ctx: AppContext;
	checkedAt: number;
	role: string;
	syncType?: number;
};

export function createDocumentServer(options: {
	origin: string;
	verify(token: string): DocumentGrant;
	authorize(grant: DocumentGrant): Promise<{ ctx: AppContext; role: string }>;
	workerOwnerId?: string;
	canWrite?: () => boolean;
	onStorageHealth?: (documentName: string, healthy: boolean) => void;
}) {
	const attributions = new Map<
		string,
		ReturnType<typeof trackAssignmentChanges>
	>();
	const revisions = new Map<string, number>();
	const receipts = new Map<string, string>();
	const accessTimers = new Map<string, ReturnType<typeof setInterval>>();
	const contexts = new Map<string, ConnectionContext>();
	function retireDocument(name: string, generation: number) {
		const document = hocuspocus.documents.get(name);
		if (!document) return;
		receipts.delete(name);
		options.onStorageHealth?.(name, true);
		document.broadcastStateless(
			JSON.stringify({ type: "restored", generation }),
		);
		for (const connection of document.getConnections()) {
			connection.readOnly = true;
			connection.close({ code: 4409, reason: "Document restored" });
		}
	}
	let checkingChanges = false;
	let refreshFlight = Promise.resolve();
	const refreshTimer = setInterval(() => {
		if (!checkingChanges) refreshFlight = refreshCommittedChanges();
	}, 1000);
	refreshTimer.unref();
	async function refreshCommittedChanges() {
		if (checkingChanges) return;
		checkingChanges = true;
		try {
			const workspaces = new Map<
				string,
				{ ctx: AppContext; known: { pageId: string; revision: number }[] }
			>();
			for (const [name, context] of contexts) {
				if (!hocuspocus.documents.has(name)) continue;
				const { workspaceId, pageId } = context.grant;
				let entry = workspaces.get(workspaceId);
				if (!entry) {
					entry = { ctx: context.ctx, known: [] };
					workspaces.set(workspaceId, entry);
				}
				entry.known.push({ pageId, revision: revisions.get(name) ?? 0 });
			}
			for (const [workspaceId, { ctx, known }] of workspaces) {
				try {
					const changes = await ctx.ports.documents.findChanged(
						createTenantScope({ id: workspaceId }),
						known,
					);
					for (const stored of changes) {
						// A restored page can have old and new generations loaded briefly.
						for (const [name, context] of contexts) {
							if (
								context.grant.workspaceId !== workspaceId ||
								context.grant.pageId !== stored.pageId
							)
								continue;
							if (context.grant.generation !== stored.generation) {
								retireDocument(name, stored.generation);
								continue;
							}
							const document = hocuspocus.documents.get(name);
							if (!document || stored.revision <= (revisions.get(name) ?? 0))
								continue;
							revisions.set(name, stored.revision);
							Y.applyUpdate(document, stored.state, {
								source: "local",
								skipStoreHooks: true,
							});
							// Only acknowledge the committed snapshot, not any typing
							// still pending in the in-memory document.
							const committed = new Y.Doc();
							try {
								Y.applyUpdate(committed, stored.state);
								const receipt = JSON.stringify({
									type: "persisted",
									revision: stored.revision,
									tasksChanged: true,
									linksChanged: true,
									...createPersistenceReceipt(committed),
								});
								receipts.set(name, receipt);
								document.broadcastStateless(receipt);
							} finally {
								committed.destroy();
							}
						}
					}
				} catch (error) {
					ctx.ports.logger.warn(
						"Could not refresh collaborative document changes",
						{ error, workspaceId },
					);
				}
			}
		} finally {
			checkingChanges = false;
		}
	}
	async function authenticate(
		token: string,
		documentName: string,
	): Promise<ConnectionContext> {
		const grant = options.verify(token);
		if (
			grant.kind === "canvas" ||
			documentName !==
				pageDocumentName(grant.workspaceId, grant.pageId, grant.generation)
		)
			throw new Error("Wrong document");
		return {
			grant,
			...(await options.authorize(grant)),
			checkedAt: Date.now(),
		};
	}
	const hocuspocus = new Hocuspocus<ConnectionContext>({
		debounce: 300,
		maxDebounce: 2000,
		async onConnect({ requestHeaders }) {
			const origin = requestHeaders.get("origin");
			if (origin && origin !== options.origin)
				throw new Error("Origin not allowed");
		},
		async onAuthenticate({ token, documentName, connectionConfig }) {
			const context = await authenticate(token, documentName);
			connectionConfig.readOnly = !canEditContent(context.role);
			return context;
		},
		async connected({ connection, context, documentName, socketId }) {
			let checking = false;
			const key = `${socketId}:${documentName}`;
			accessTimers.set(
				key,
				setInterval(async () => {
					if (checking) return;
					checking = true;
					try {
						if (context.grant.expiresAt <= Date.now())
							throw new Error("Expired");
						const next = await options.authorize(context.grant);
						Object.assign(context, next, { checkedAt: Date.now() });
						connection.readOnly = !canEditContent(next.role);
					} catch {
						connection.close({ code: 4401, reason: "Document access changed" });
					} finally {
						checking = false;
					}
				}, 30_000),
			);
		},
		async onDisconnect({ socketId, documentName }) {
			const key = `${socketId}:${documentName}`;
			clearInterval(accessTimers.get(key));
			accessTimers.delete(key);
		},
		async onTokenSync({ token, documentName, context, connection }) {
			const next = await authenticate(token, documentName);
			if (
				next.grant.userId !== context.grant.userId ||
				next.grant.sessionId !== context.grant.sessionId
			)
				throw new Error("Session changed; reconnect");
			Object.assign(context, next);
			connection.readOnly = !canEditContent(next.role);
		},
		async beforeHandleMessage({ context, connection }) {
			if (options.canWrite?.() === false)
				throw new Error("Collaboration worker unavailable");
			if (context.grant.expiresAt <= Date.now())
				throw new Error("Document session expired");
			if (Date.now() - context.checkedAt >= 5000) {
				const next = await options.authorize(context.grant);
				Object.assign(context, next, { checkedAt: Date.now() });
				connection.readOnly = !canEditContent(next.role);
			}
		},
		async beforeSync({ context, type, document, payload, connection }) {
			context.syncType = type;
			if (type === 0 || connection.readOnly) return;
			try {
				validateDocumentUpdate(document, payload);
			} catch {
				connection.sendStateless(JSON.stringify({ type: "invalid-document" }));
				throw new Error("Invalid or unsupported document update");
			}
		},
		async onLoadDocument({ context, documentName, document }) {
			attributions.set(
				documentName,
				trackAssignmentChanges(document, (origin) => {
					const source = origin as {
						source?: string;
						connection?: { context: ConnectionContext };
					} | null;
					const ctx =
						source?.source === "connection"
							? source.connection?.context
							: undefined;
					return ctx?.syncType === 2 ? ctx.grant.userId : null;
				}),
			);
			const stored = await loadPageBody(
				context.ctx,
				context.grant.workspaceId,
				context.grant.pageId,
			);
			if (stored.generation !== context.grant.generation)
				throw new DocumentRestoredError(stored.generation);
			revisions.set(documentName, stored.revision);
			contexts.set(documentName, context);
			const persisted = new Y.Doc();
			Y.applyUpdate(persisted, stored.state);
			receipts.set(
				documentName,
				JSON.stringify({
					type: "persisted",
					revision: stored.revision,
					...createPersistenceReceipt(persisted),
				}),
			);
			persisted.destroy();
			return stored.state;
		},
		async onStoreDocument({ document, documentName, lastContext }) {
			try {
				const attribution = attributions.get(documentName);
				const captured = attribution?.capture();
				const { state, assignmentNotifications, ...result } =
					await persistPageBody(lastContext.ctx, {
						...lastContext.grant,
						baseRevision: revisions.get(documentName) ?? 0,
						doc: document,
						assignmentChanges: captured,
						workerOwnerId: options.workerOwnerId,
					});
				if (captured) attribution?.acknowledge(captured);
				options.onStorageHealth?.(documentName, true);
				Y.applyUpdate(document, state, {
					source: "local",
					skipStoreHooks: true,
				});
				if (result.revision >= (revisions.get(documentName) ?? 0)) {
					revisions.set(documentName, result.revision);
					const receipt = JSON.stringify({ type: "persisted", ...result });
					receipts.set(documentName, receipt);
					document.broadcastStateless(receipt);
				}
				// The inbox rows committed with the document. Failed push delivery is
				// retried by the existing notification schedule and cannot undo the save.
				void deliverTaskAssignmentNotifications(
					lastContext.ctx.ports,
					assignmentNotifications,
				).catch(() => {
					lastContext.ctx.ports.logger.warn(
						"Collaborative assignment push deferred to scheduled retry",
						{ documentName },
					);
				});
			} catch (error) {
				if (error instanceof DocumentRestoredError) {
					retireDocument(documentName, error.generation);
					return;
				}
				document.broadcastStateless(JSON.stringify({ type: "storage-error" }));
				options.onStorageHealth?.(documentName, false);
				throw error;
			}
		},
		async onStateless({ payload, connection, documentName, document }) {
			if (payload === "flush" && !connection.readOnly) {
				await hocuspocus.storeDocumentHooks(
					document,
					{
						document,
						documentName,
						lastContext: connection.context,
						lastTransactionOrigin: { source: "connection", connection },
						clientsCount: document.getConnectionsCount(),
						instance: hocuspocus,
					},
					true,
				);
			}
			if (payload === "receipt") {
				const receipt = receipts.get(documentName);
				if (receipt) connection.sendStateless(receipt);
			}
		},
		async afterUnloadDocument({ documentName }) {
			options.onStorageHealth?.(documentName, true);
			attributions.delete(documentName);
			contexts.delete(documentName);
			revisions.delete(documentName);
			receipts.delete(documentName);
		},
		async onDestroy() {
			clearInterval(refreshTimer);
			await refreshFlight;
			contexts.clear();
			for (const timer of accessTimers.values()) clearInterval(timer);
			accessTimers.clear();
		},
	});
	return hocuspocus;
}

import { atom } from "tldraw";
import type {
	TLPersistentClientSocket,
	TLSocketStatusChangeEvent,
} from "@tldraw/sync-core";

/** Public tldraw transport interface; the SDK owns sync, rebasing, presence and heartbeats.
 * This small host adapter allows Haunter to pause a connection during account recovery.
 * It never queues edits: TLSyncClient retains and resends unacknowledged changes itself.
 */
export class AuthenticatedCanvasSocket implements TLPersistentClientSocket {
	private readonly statusValue = atom<"offline" | "online" | "error">(
		"canvas socket status",
		"offline",
	);
	get connectionStatus() {
		return this.statusValue.get();
	}
	isDisposed = false;
	private socket: WebSocket | null = null;
	private epoch = 0;
	private attempt = 0;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private messages = new Set<(value: object) => void>();
	private statuses = new Set<(value: TLSocketStatusChangeEvent) => void>();
	constructor(private getUri: () => Promise<string>) {
		void this.connect();
	}
	private status(event: TLSocketStatusChangeEvent) {
		this.statusValue.set(event.status);
		for (const callback of this.statuses) callback(event);
	}
	private async connect() {
		const epoch = ++this.epoch;
		const current = () => !this.isDisposed && epoch === this.epoch;
		try {
			const uri = await this.getUri();
			if (!current()) return;
			const socket = new WebSocket(uri);
			this.socket = socket;
			socket.onopen = () => {
				if (!current()) return;
				this.attempt = 0;
				this.status({ status: "online" });
			};
			socket.onmessage = (event) => {
				if (!current()) return;
				let value: object;
				try {
					value = JSON.parse(String(event.data));
				} catch {
					this.restart();
					return;
				}
				for (const callback of this.messages) callback(value);
			};
			socket.onclose = (event) => {
				if (!current()) return;
				this.socket = null;
				if (event.code === 4099) {
					this.status({ status: "error", reason: event.reason });
					return;
				}
				this.schedule();
			};
			socket.onerror = () => {
				if (current()) this.restart();
			};
		} catch {
			if (current()) this.schedule();
		}
	}
	private schedule() {
		this.status({ status: "offline" });
		clearTimeout(this.retry);
		const delay = Math.min(30_000, 500 * 2 ** Math.min(this.attempt++, 6));
		this.retry = setTimeout(() => void this.connect(), delay);
	}
	sendMessage(message: object) {
		if (this.connectionStatus === "online")
			this.socket?.send(JSON.stringify(message));
	}
	onReceiveMessage = (callback: (value: object) => void) => {
		this.messages.add(callback);
		return () => {
			this.messages.delete(callback);
		};
	};
	onStatusChange = (callback: (value: TLSocketStatusChangeEvent) => void) => {
		this.statuses.add(callback);
		return () => {
			this.statuses.delete(callback);
		};
	};
	restart() {
		if (this.isDisposed) return;
		this.epoch++;
		clearTimeout(this.retry);
		this.socket?.close();
		this.socket = null;
		this.schedule();
	}
	close() {
		this.isDisposed = true;
		this.epoch++;
		clearTimeout(this.retry);
		this.socket?.close();
		this.socket = null;
		this.messages.clear();
		this.statuses.clear();
	}
}

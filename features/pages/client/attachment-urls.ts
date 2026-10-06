import { sessionFetch } from "@/client/session-recovery";
import { attachmentKey } from "../attachments";

/** Lifetime is one mounted editor. Persisted blocks keep stable API URLs, never blob URLs or credentials. */
export function createAttachmentUrlResolver(onError: () => void = () => {}) {
	const controller = new AbortController();
	const urls = new Map<string, Promise<string>>();
	const blobs = new Set<string>();
	return {
		resolve(url: string): Promise<string> {
			if (!attachmentKey(url)) return Promise.resolve(url);
			let pending = urls.get(url);
			if (!pending) {
				pending = (async () => {
					const response = await sessionFetch(url, {
						signal: controller.signal,
						cache: "no-store",
					});
					if (!response.ok)
						throw new Error("This attachment is no longer available.");
					const blob = await response.blob();
					controller.signal.throwIfAborted();
					const objectUrl = URL.createObjectURL(blob);
					blobs.add(objectUrl);
					return objectUrl;
				})().catch(() => {
					urls.delete(url);
					// BlockNote's HTML serializer calls the resolver without a rejection
					// handler. A cancelled preview must not become an unhandled rejection.
					if (!controller.signal.aborted) onError();
					return `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="60"><text x="12" y="35" fill="gray" font-family="sans-serif">Attachment unavailable</text></svg>')}`;
				});
				urls.set(url, pending);
			}
			return pending;
		},
		dispose() {
			controller.abort();
			for (const url of blobs) URL.revokeObjectURL(url);
			blobs.clear();
			urls.clear();
		},
	};
}

import "@beignet/core/server-only";
import type {
	StorageBody,
	StorageObject,
	StorageObjectBody,
	StoragePort,
	StoragePutOptions,
} from "@beignet/core/ports";
import { createProvider } from "@beignet/core/providers";
import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";

/**
 * Beignet StoragePort backed by Vercel Blob (private access). All reads go
 * through the app's own routes (membership / share-token checks); blobs are
 * never exposed by URL, so `publicUrl` is always null.
 *
 * Vercel Blob has no arbitrary per-object metadata, and nothing in the app
 * reads metadata back (authorization is key-prefix based), so `metadata` is
 * reported empty.
 */
export function createVercelBlobStorage(): StoragePort {
	function toObject(info: {
		pathname: string;
		size: number;
		uploadedAt: Date;
		contentType?: string;
		cacheControl?: string;
	}): StorageObject {
		return {
			key: info.pathname,
			size: info.size,
			contentType: info.contentType,
			cacheControl: info.cacheControl,
			metadata: {},
			visibility: "private",
			lastModified: info.uploadedAt,
		};
	}

	return {
		async put(key: string, body: StorageBody, options?: StoragePutOptions) {
			const result = await put(key, body as Parameters<typeof put>[1], {
				access: "private",
				addRandomSuffix: false,
				contentType: options?.contentType,
				// Vercel Blob takes max-age seconds, not a Cache-Control string;
				// our uploads use long immutable caching, which this preserves.
				cacheControlMaxAge: parseMaxAge(options?.cacheControl),
			});
			const info = await head(result.pathname);
			return toObject(info);
		},
		async get(key: string) {
			const result = await get(key, { access: "private" });
			if (result?.statusCode !== 200 || !result.stream) {
				return null;
			}

			const object = toObject({
				pathname: result.blob.pathname,
				size: result.blob.size,
				uploadedAt: result.blob.uploadedAt,
				contentType: result.blob.contentType ?? undefined,
				cacheControl: result.blob.cacheControl,
			});
			let bodyUsed = false;
			const stream = result.stream;
			const consume = () => {
				if (bodyUsed) throw new Error("Storage body already consumed");
				bodyUsed = true;
				return stream;
			};

			const objectBody: StorageObjectBody = {
				...object,
				get bodyUsed() {
					return bodyUsed;
				},
				stream: consume,
				async bytes() {
					const buffer = await new Response(consume()).arrayBuffer();
					return new Uint8Array(buffer);
				},
				async arrayBuffer() {
					return new Response(consume()).arrayBuffer();
				},
				async text() {
					return new Response(consume()).text();
				},
			};
			return objectBody;
		},
		async stat(key: string) {
			try {
				const info = await head(key);
				return toObject(info);
			} catch (error) {
				if (error instanceof BlobNotFoundError) return null;
				throw error;
			}
		},
		async delete(key: string) {
			try {
				await head(key);
			} catch (error) {
				if (error instanceof BlobNotFoundError) return false;
				throw error;
			}
			await del(key);
			return true;
		},
		async exists(key: string) {
			try {
				await head(key);
				return true;
			} catch (error) {
				if (error instanceof BlobNotFoundError) return false;
				throw error;
			}
		},
		async publicUrl() {
			// Private store: files are only reachable through the app's routes.
			return null;
		},
	};
}

function parseMaxAge(cacheControl?: string): number | undefined {
	const match = cacheControl?.match(/max-age=(\d+)/);
	return match ? Number(match[1]) : undefined;
}

/** Provider contributing the Vercel Blob-backed storage port. */
export const vercelBlobStorageProvider = createProvider()({
	name: "vercel-blob-storage",
	async setup() {
		return {
			ports: { storage: createVercelBlobStorage() },
		};
	},
});

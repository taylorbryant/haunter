import { createHmac, timingSafeEqual } from "node:crypto";
import { isAppError } from "@beignet/core/errors";
import { z } from "zod";
import type { AppContext } from "@/app-context";
import {
	CanvasCommandSchema,
	CanvasCommandOutputSchema,
} from "@/features/canvases/editing";
import type { CanvasEditingPort } from "@/features/canvases/ports";
import { appError } from "@/features/shared/errors";
import type { CanvasSyncServer } from "./sync-server";

const MAX_BODY = 1_000_000;
const publicErrors = {
	INVALID_CANVAS_EDIT: "InvalidCanvasEdit",
	CANVAS_REVISION_CONFLICT: "CanvasRevisionConflict",
	CANVAS_NOT_FOUND: "CanvasNotFound",
	FORBIDDEN: "Forbidden",
} as const;
const Envelope = z
	.object({
		userId: z.string().min(1).max(300),
		workspaceId: z.string().min(1).max(300),
		command: CanvasCommandSchema,
	})
	.strict();
const sign = (secret: string, expires: string, body: string) =>
	createHmac("sha256", secret)
		.update(`haunter-canvas-command-v1:${expires}:${body}`)
		.digest();

export function createCanvasEditingClient(options: {
	url: string;
	secret: string;
	fetch?: typeof fetch;
}): CanvasEditingPort {
	return {
		async execute(input) {
			const url = new URL(options.url);
			url.protocol =
				url.protocol === "wss:"
					? "https:"
					: url.protocol === "ws:"
						? "http:"
						: url.protocol;
			url.pathname = "/internal/canvas-command";
			url.search = "";
			url.hash = "";
			const body = JSON.stringify(Envelope.parse(input));
			if (Buffer.byteLength(body) > MAX_BODY)
				throw appError("InvalidCanvasEdit", {
					message: "Canvas commands must be 1 MB or smaller.",
				});
			const expires = String(Date.now() + 30_000);
			try {
				const response = await (options.fetch ?? fetch)(url, {
					method: "POST",
					body,
					redirect: "error",
					signal: AbortSignal.timeout(30_000),
					headers: {
						"content-type": "application/json",
						"x-haunter-expires": expires,
						"x-haunter-signature": sign(options.secret, expires, body).toString(
							"hex",
						),
					},
				});
				const value = await response.json();
				if (!response.ok) {
					const error = z
						.object({
							code: z.enum([
								"INVALID_CANVAS_EDIT",
								"CANVAS_REVISION_CONFLICT",
								"CANVAS_NOT_FOUND",
								"FORBIDDEN",
							]),
							message: z.string(),
							details: z.unknown().optional(),
						})
						.safeParse(value);
					if (error.success)
						throw appError(publicErrors[error.data.code], {
							message: error.data.message,
							details: error.data.details,
						});
					throw appError("CanvasWorkerUnavailable");
				}
				return CanvasCommandOutputSchema.parse(value);
			} catch (error) {
				if (isAppError(error)) throw error;
				throw appError("CanvasWorkerUnavailable");
			}
		},
	};
}

/** The MAC binds identity, resource, action, and full payload; browser session tokens cannot call this route. */
export function createCanvasCommandHandler(options: {
	secret: string;
	canvases: CanvasSyncServer;
	authorize(input: {
		userId: string;
		workspaceId: string;
	}): Promise<AppContext>;
}) {
	return async (request: Request): Promise<Response> => {
		if (request.method !== "POST")
			return new Response("Method not allowed", { status: 405 });
		const expires = request.headers.get("x-haunter-expires") ?? "";
		const signature = request.headers.get("x-haunter-signature") ?? "";
		if (
			!/^\d+$/.test(expires) ||
			Number(expires) <= Date.now() ||
			Number(expires) > Date.now() + 30_000 ||
			!/^[a-f0-9]{64}$/.test(signature)
		)
			return new Response("Forbidden", { status: 403 });
		let length = 0;
		const chunks: Uint8Array[] = [];
		const reader = request.body?.getReader();
		if (!reader) return new Response("Invalid command", { status: 400 });
		const deadline = setTimeout(
			() => {
				void reader.cancel().catch(() => {});
			},
			Math.max(1, Number(expires) - Date.now()),
		);
		deadline.unref();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				length += value.length;
				if (length > MAX_BODY) {
					await reader.cancel();
					return new Response("Too large", { status: 413 });
				}
				chunks.push(value);
			}
			const body = Buffer.concat(chunks).toString("utf8");
			if (
				!timingSafeEqual(
					Buffer.from(signature, "hex"),
					sign(options.secret, expires, body),
				)
			)
				return new Response("Forbidden", { status: 403 });
			const parsed = Envelope.safeParse(JSON.parse(body));
			if (!parsed.success)
				return new Response("Invalid command", { status: 400 });
			// Check again after body ingestion; a slow sender cannot prolong a grant.
			if (Number(expires) <= Date.now())
				return new Response("Forbidden", { status: 403 });
			const authorize = async () => {
				if (Number(expires) <= Date.now()) throw appError("Forbidden");
				return options.authorize(parsed.data);
			};
			const ctx = await authorize();
			return Response.json(
				await options.canvases.execute(ctx, parsed.data.command, authorize),
			);
		} catch (error) {
			if (isAppError(error))
				return Response.json(
					{ code: error.code, message: error.message, details: error.details },
					{ status: error.status },
				);
			return Response.json(
				{ name: "CanvasWorkerUnavailable" },
				{ status: 503 },
			);
		} finally {
			clearTimeout(deadline);
			reader.releaseLock();
		}
	};
}

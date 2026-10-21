import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { MAX_AGENT_FILE_BYTES } from "@/features/agents/file-input";
import { appError } from "@/features/shared/errors";
import { isPublicAddress } from "@/infra/network/public-address";

export { isPublicAddress as isPublicFileAddress } from "@/infra/network/public-address";
const invalid = () =>
	appError("UnsupportedAttachment", {
		message:
			"The file could not be downloaded. Supply a fresh HTTPS file URL or inlineFile (up to 2 MiB).",
	});

/** Validate every redirect and pin its DNS answer to the socket. Never forward credentials. */
export async function downloadAgentFile(
	raw: string,
	dependencies: {
		lookup?: typeof lookup;
		request?: typeof request;
		timeoutMs?: number;
	} = {},
): Promise<{ bytes: Buffer; contentType: string }> {
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		dependencies.timeoutMs ?? 15_000,
	);
	try {
		let url = new URL(raw);
		for (let redirects = 0; redirects <= 3; redirects++) {
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				(url.port && url.port !== "443")
			)
				throw invalid();
			const hostname = url.hostname.replace(/^\[|\]$/g, "");
			const addresses = isIP(hostname)
				? [{ address: hostname, family: isIP(hostname) }]
				: await Promise.race([
						(dependencies.lookup ?? lookup)(hostname, { all: true }),
						new Promise<never>((_, reject) =>
							controller.signal.addEventListener(
								"abort",
								() => reject(invalid()),
								{ once: true },
							),
						),
					]);
			if (
				!addresses.length ||
				addresses.some(({ address }) => !isPublicAddress(address))
			)
				throw invalid();
			controller.signal.throwIfAborted();
			const selected = addresses[0]!;
			const response = await new Promise<{
				redirect?: string;
				bytes: Buffer;
				contentType: string;
			}>((resolve, reject) => {
				const req = (dependencies.request ?? request)(
					url,
					{
						agent: false,
						signal: controller.signal,
						lookup: (_host, options, callback) => {
							if (options.all) callback(null, [selected]);
							else callback(null, selected.address, selected.family);
						},
						headers: { "accept-encoding": "identity" },
					},
					(res) => {
						if (
							[301, 302, 303, 307, 308].includes(res.statusCode ?? 0) &&
							res.headers.location
						) {
							resolve({
								redirect: res.headers.location,
								bytes: Buffer.alloc(0),
								contentType: "",
							});
							res.destroy();
							return;
						}
						if (
							res.statusCode !== 200 ||
							Number(res.headers["content-length"]) > MAX_AGENT_FILE_BYTES ||
							(res.headers["content-encoding"] &&
								res.headers["content-encoding"] !== "identity")
						) {
							reject(invalid());
							res.destroy();
							return;
						}
						const chunks: Buffer[] = [];
						let size = 0;
						res.on("data", (chunk: Buffer) => {
							size += chunk.length;
							if (size > MAX_AGENT_FILE_BYTES) {
								reject(invalid());
								res.destroy();
							} else chunks.push(chunk);
						});
						res.on("error", reject);
						res.on("end", () =>
							resolve({
								bytes: Buffer.concat(chunks),
								contentType: res.headers["content-type"] ?? "",
							}),
						);
					},
				);
				req.on("error", reject);
				req.end();
			});
			if (!response.redirect) return response;
			url = new URL(response.redirect, url);
		}
		throw invalid();
	} catch {
		throw invalid();
	} finally {
		clearTimeout(timer);
	}
}

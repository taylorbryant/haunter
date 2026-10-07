import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { MAX_AGENT_FILE_BYTES } from "@/features/agents/file-input";
import { appError } from "@/features/shared/errors";

const blocked = new BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 3],
] as const)
	blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("3fff::", 20, "ipv6");
export function isPublicFileAddress(address: string): boolean {
	const family = isIP(address);
	return family === 4
		? !blocked.check(address, "ipv4")
		: family === 6 &&
				globalV6.check(address, "ipv6") &&
				!blocked.check(address, "ipv6");
}
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
				addresses.some(({ address }) => !isPublicFileAddress(address))
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

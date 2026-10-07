import { expect, test } from "bun:test";
import sharp from "sharp";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { request } from "node:https";
import type { lookup } from "node:dns/promises";
import { createAgentFiles, decodeFileBase64 } from "@/infra/agents/file-input";
import {
	downloadAgentFile,
	isPublicFileAddress,
} from "@/infra/agents/file-download";
import { MAX_AGENT_FILE_BYTES } from "../file-input";

test("file inputs validate actual bytes, bound size and normalize raster images", async () => {
	const bytes = await sharp({
		create: { width: 24, height: 16, channels: 3, background: "#ff0055" },
	})
		.jpeg()
		.toBuffer();
	const file = await createAgentFiles().read({
		inlineFile: {
			name: "../image.jpg",
			mimeType: "image/jpeg",
			data: bytes.toString("base64"),
		},
	});
	expect(file).toMatchObject({
		name: ".._image.png",
		mimeType: "image/png",
		width: 24,
		height: 16,
	});
	expect((await sharp(file.bytes).metadata()).format).toBe("png");
	for (const mimeType of ["image/svg+xml", "text/html", "application/x-sh"]) {
		await expect(
			createAgentFiles().read({
				inlineFile: {
					name: "bad",
					mimeType,
					data: Buffer.from("<svg/>").toString("base64"),
				},
			}),
		).rejects.toMatchObject({ code: "UNSUPPORTED_ATTACHMENT" });
	}
	await expect(
		createAgentFiles().read({
			inlineFile: {
				name: "fake.png",
				mimeType: "image/png",
				data: Buffer.from("Not an image").toString("base64"),
			},
		}),
	).rejects.toMatchObject({ code: "UNSUPPORTED_ATTACHMENT" });
	for (const data of ["", "not-base64", "YQ=", "YR==", "A".repeat(3_000_000)])
		expect(() => decodeFileBase64(data)).toThrow();
	await expect(createAgentFiles().read({})).rejects.toThrow();
});

test("host file metadata is optional and content type can come from the download", async () => {
	const files = createAgentFiles(async () => ({
		bytes: Buffer.from("hello"),
		contentType: "text/plain; charset=utf-8",
	}));
	expect(
		await files.read({
			file: { download_url: "https://files.example/file", file_id: "file-a" },
		}),
	).toMatchObject({
		name: "attachment",
		mimeType: "text/plain",
		bytes: Buffer.from("hello"),
	});
	await expect(
		files.read({
			file: { download_url: "https://files.example/file", file_id: "file-a" },
			inlineFile: { name: "x", mimeType: "text/plain", data: "aGk=" },
		}),
	).rejects.toThrow();
});

test("only public unicast IP addresses can serve agent files", () => {
	for (const ip of [
		"127.0.0.1",
		"10.2.3.4",
		"100.64.0.1",
		"172.31.255.255",
		"192.168.1.1",
		"169.254.169.254",
		"0.0.0.0",
		"192.0.2.1",
		"224.0.0.1",
		"::1",
		"::ffff:127.0.0.1",
		"fd00::1",
		"fe80::1",
		"64:ff9b::a00:1",
		"2002:7f00:1::",
		"2001:db8::1",
		"not-an-ip",
	])
		expect(isPublicFileAddress(ip)).toBe(false);
	for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])
		expect(isPublicFileAddress(ip)).toBe(true);
});

function downloadFixture(
	responses: {
		status?: number;
		location?: string;
		length?: number;
		body?: Buffer[];
	}[],
) {
	const calls: { url: string; address: string }[] = [];
	const resolve = (async (host: string) => [
		{
			address: host === "private.example" ? "127.0.0.1" : "1.1.1.1",
			family: 4,
		},
	]) as unknown as typeof lookup;
	const connect = ((
		url: URL,
		options: {
			lookup: (
				host: string,
				options: { all: boolean },
				callback: (error: unknown, addresses: { address: string }[]) => void,
			) => void;
		},
		callback: (res: IncomingMessage) => void,
	) => {
		const req = new EventEmitter() as EventEmitter & { end(): void };
		req.end = () => {
			options.lookup(url.hostname, { all: true }, (_error, addresses) => {
				calls.push({ url: url.href, address: addresses[0]!.address });
				const entry = responses.shift() ?? {};
				const response = Readable.from(
					entry.body ?? [Buffer.from("hello")],
				) as IncomingMessage;
				response.statusCode = entry.status ?? 200;
				response.headers = {
					"content-type": "text/plain",
					...(entry.location ? { location: entry.location } : {}),
					...(entry.length ? { "content-length": String(entry.length) } : {}),
				};
				callback(response);
			});
		};
		return req;
	}) as unknown as typeof request;
	return { calls, dependencies: { lookup: resolve, request: connect } };
}

test("downloads pin DNS, follow validated redirects, and do not contact private redirect targets", async () => {
	const f = downloadFixture([
		{ status: 302, location: "https://next.example/file" },
		{},
	]);
	expect(
		(
			await downloadAgentFile("https://files.example/start", f.dependencies)
		).bytes.toString(),
	).toBe("hello");
	expect(f.calls).toEqual([
		{ url: "https://files.example/start", address: "1.1.1.1" },
		{ url: "https://next.example/file", address: "1.1.1.1" },
	]);
	const denied = downloadFixture([
		{ status: 302, location: "https://private.example/secret" },
	]);
	await expect(
		downloadAgentFile("https://files.example/start", denied.dependencies),
	).rejects.toMatchObject({ code: "UNSUPPORTED_ATTACHMENT" });
	expect(denied.calls).toHaveLength(1);
	for (const url of [
		"http://files.example/",
		"https://u:p@files.example/",
		"https://files.example:8443/",
		"https://127.0.0.1/",
		"https://[::1]/",
	]) {
		const blocked = downloadFixture([]);
		await expect(
			downloadAgentFile(url, blocked.dependencies),
		).rejects.toThrow();
		expect(blocked.calls).toHaveLength(0);
	}
});

test("downloads cap claimed and streamed bytes, reject errors, and bound DNS time", async () => {
	for (const response of [
		{ length: MAX_AGENT_FILE_BYTES + 1 },
		{ body: [Buffer.alloc(MAX_AGENT_FILE_BYTES), Buffer.from("x")] },
		{ status: 404 },
	]) {
		const f = downloadFixture([response]);
		await expect(
			downloadAgentFile("https://files.example/file", f.dependencies),
		).rejects.toThrow();
	}
	await expect(
		downloadAgentFile("https://files.example/file", {
			lookup: (() => new Promise(() => {})) as typeof lookup,
			timeoutMs: 10,
		}),
	).rejects.toMatchObject({ code: "UNSUPPORTED_ATTACHMENT" });
});

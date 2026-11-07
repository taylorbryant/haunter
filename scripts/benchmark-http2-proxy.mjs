import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createSecureServer } from "node:http2";
import { connect } from "node:net";

// Local benchmark transport only. Node's HTTP/2 compatibility API terminates
// TLS, and HTTP/1 upgrades carry the real collaboration WebSocket unchanged.
// https://nodejs.org/api/http2.html#compatibility-api
const [certificate, privateKey, ...mappings] = process.argv.slice(2);
assert.ok(
	certificate && privateKey && mappings.length,
	"Usage: node scripts/benchmark-http2-proxy.mjs cert.pem key.pem listen:target [...]",
);
const tls = {
	cert: readFileSync(certificate),
	key: readFileSync(privateKey),
	allowHTTP1: true,
};
const hopHeaders = new Set([
	"connection",
	"keep-alive",
	"proxy-connection",
	"transfer-encoding",
	"upgrade",
]);
for (const mapping of mappings) {
	const ports = mapping.split(":").map(Number);
	assert.ok(
		ports.length === 2 &&
			ports.every(
				(port) => Number.isInteger(port) && port > 0 && port <= 65535,
			),
		"Use two valid ports per mapping",
	);
	const [port, target] = ports;
	const server = createSecureServer(tls);
	server.on("request", (req, res) => {
		const headers = Object.fromEntries(
			Object.entries(req.headers).filter(
				([name]) => !name.startsWith(":") && !hopHeaders.has(name),
			),
		);
		headers.host = `127.0.0.1:${port}`;
		const upstream = request(
			{
				hostname: "127.0.0.1",
				port: target,
				path: req.url,
				method: req.method,
				headers,
			},
			(response) => {
				if (res.destroyed) {
					response.destroy();
					return;
				}
				res.writeHead(
					response.statusCode ?? 502,
					Object.fromEntries(
						Object.entries(response.headers).filter(
							([name]) => !hopHeaders.has(name),
						),
					),
				);
				response.pipe(res);
			},
		);
		upstream.on("error", () => {
			if (res.destroyed) return;
			if (!res.headersSent) res.writeHead(502);
			res.end();
		});
		req.on("aborted", () => upstream.destroy());
		res.on("close", () => upstream.destroy());
		req.pipe(upstream);
	});
	server.on("upgrade", (req, socket, head) => {
		const upstream = connect(target, "127.0.0.1", () => {
			upstream.write(
				`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers)
					.map(([name, value]) => `${name}: ${value}`)
					.join("\r\n")}\r\n\r\n`,
			);
			if (head.length) upstream.write(head);
			socket.pipe(upstream);
			upstream.pipe(socket);
		});
		upstream.on("error", () => socket.destroy());
		socket.on("error", () => upstream.destroy());
		socket.on("close", () => upstream.destroy());
	});
	server.listen(port, "127.0.0.1", () =>
		console.log(`HTTPS ${port} -> HTTP ${target}`),
	);
}

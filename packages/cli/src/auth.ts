import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
	auth,
	type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationMixed,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Profile, ProfileStore } from "./config";

export const LOGIN_REQUIRED = "Sign in with haunter login, then try again.";

export class AuthProvider implements OAuthClientProvider {
	private verifier?: string;
	constructor(
		readonly store: ProfileStore,
		readonly profile: Profile,
		private readonly authorize?: (url: URL) => Promise<void>,
		private readonly oauthState = randomBytes(32).toString("base64url"),
	) {}
	get redirectUrl() {
		return this.profile.redirectUrl ?? "http://127.0.0.1:43821/callback";
	}
	get clientMetadata() {
		return {
			client_name: "Haunter CLI",
			client_uri: "https://www.haunter.app",
			redirect_uris: [this.redirectUrl],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
			scope: "haunter:mcp offline_access",
		};
	}
	state() {
		return this.oauthState;
	}
	clientInformation() {
		return this.profile.client;
	}
	async saveClientInformation(client: OAuthClientInformationMixed) {
		this.profile.client = { ...this.clientMetadata, ...client };
		await this.store.save(this.profile);
	}
	tokens() {
		return this.profile.tokens;
	}
	async saveTokens(tokens: OAuthTokens) {
		this.profile.tokens = tokens;
		await this.store.save(this.profile);
	}
	async redirectToAuthorization(url: URL) {
		if (!this.authorize) throw new Error(LOGIN_REQUIRED);
		await this.authorize(url);
	}
	saveCodeVerifier(verifier: string) {
		if (!this.authorize) throw new Error(LOGIN_REQUIRED);
		this.verifier = verifier;
	}
	codeVerifier() {
		if (!this.verifier)
			throw new Error("The sign-in attempt expired. Run haunter login again.");
		return this.verifier;
	}
	async invalidateCredentials(
		scope: "all" | "client" | "tokens" | "verifier" | "discovery",
	) {
		if (scope === "all" || scope === "client") delete this.profile.client;
		if (scope === "all" || scope === "tokens") delete this.profile.tokens;
		if (scope === "all" || scope === "verifier") this.verifier = undefined;
		await this.store.save(this.profile);
	}
}

export async function oauthCallback(
	state: string,
	port: number,
	signal?: AbortSignal,
) {
	let succeed!: (code: string) => void;
	let fail!: (error: Error) => void;
	const code = new Promise<string>((resolve, reject) => {
		succeed = resolve;
		fail = reject;
	});
	void code.catch(() => {});
	let accepted = false;
	const server = createServer((request, response) => {
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("Content-Type", "text/plain; charset=utf-8");
		let url: URL;
		try {
			url = new URL(request.url ?? "/", "http://127.0.0.1");
		} catch {
			response.writeHead(400).end("Invalid callback URL");
			return;
		}
		const address = server.address();
		if (
			request.method !== "GET" ||
			url.pathname !== "/callback" ||
			!address ||
			typeof address === "string" ||
			request.headers.host !== `127.0.0.1:${address.port}`
		) {
			response.writeHead(404).end("Not found");
			return;
		}
		const received = Buffer.from(url.searchParams.get("state") ?? "");
		const expected = Buffer.from(state);
		if (
			accepted ||
			received.length !== expected.length ||
			!timingSafeEqual(received, expected)
		) {
			response
				.writeHead(400)
				.end("Invalid sign-in state. Return to the terminal and try again.");
			return;
		}
		if (url.searchParams.has("error")) {
			accepted = true;
			response
				.writeHead(400)
				.end("Sign-in was not approved. Return to your terminal.");
			fail(new Error("Sign-in was not approved."));
			return;
		}
		const value = url.searchParams.get("code");
		if (!value || value.length > 8192) {
			response.writeHead(400).end("Missing authorization code");
			return;
		}
		accepted = true;
		response.end("Authorization received. You can return to your terminal.");
		succeed(value);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Could not start the sign-in callback.");
	const timer = setTimeout(
		() => fail(new Error("Sign-in timed out. Run haunter login again.")),
		5 * 60_000,
	);
	const abort = () => fail(new Error("Sign-in cancelled."));
	signal?.addEventListener("abort", abort, { once: true });
	if (signal?.aborted) abort();
	return {
		url: `http://127.0.0.1:${address.port}/callback`,
		code,
		close: async () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

export function openBrowser(url: URL): Promise<void> {
	if (
		url.protocol !== "https:" &&
		!(
			url.protocol === "http:" &&
			["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
		)
	) {
		throw new Error("The sign-in server returned an unsafe authorization URL.");
	}
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "rundll32"
				: "xdg-open";
	const args =
		process.platform === "win32"
			? ["url.dll,FileProtocolHandler", url.href]
			: [url.href];
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "ignore", shell: false });
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0 ? resolve() : reject(new Error("Could not open a browser.")),
		);
	});
}

export function boundedFetch(signal?: AbortSignal): typeof fetch {
	return ((input: RequestInfo | URL, init?: RequestInit) =>
		fetch(input, {
			...init,
			signal: AbortSignal.any([
				AbortSignal.timeout(30_000),
				...(signal ? [signal] : []),
				...(init?.signal ? [init.signal] : []),
			]),
		})) as typeof fetch;
}

export async function login(
	store: ProfileStore,
	profile: Profile,
	options: {
		port?: number;
		noBrowser?: boolean;
		signal?: AbortSignal;
		notice: (message: string) => void;
		open?: (url: URL) => Promise<void>;
	},
) {
	const state = randomBytes(32).toString("base64url");
	const port =
		options.port ??
		(profile.redirectUrl ? Number(new URL(profile.redirectUrl).port) : 43821);
	const callback = await oauthCallback(state, port, options.signal).catch(
		(error) => {
			throw new Error(
				"Could not listen for sign-in. Try haunter login --port 43822.",
				{ cause: error },
			);
		},
	);
	try {
		if (profile.redirectUrl !== callback.url) delete profile.client;
		profile.redirectUrl = callback.url;
		delete profile.tokens;
		delete profile.workspaceId;
		await store.save(profile);
		const provider = new AuthProvider(
			store,
			profile,
			async (url) => {
				options.notice(
					`Open this URL to sign in and choose workspace access:\n${url.href}`,
				);
				if (!options.noBrowser)
					await (options.open ?? openBrowser)(url).catch(() =>
						options.notice("Open the URL above in your browser to continue."),
					);
			},
			state,
		);
		const fetchFn = boundedFetch(options.signal);
		const result = await auth(provider, {
			serverUrl: store.server,
			scope: "haunter:mcp offline_access",
			fetchFn,
		});
		if (result === "REDIRECT") {
			const authorizationCode = await callback.code;
			const finished = await auth(provider, {
				serverUrl: store.server,
				authorizationCode,
				fetchFn,
			});
			if (finished !== "AUTHORIZED")
				throw new Error("Sign-in did not finish. Run haunter login again.");
		}
		if (!profile.tokens) throw new Error("Sign-in returned no credentials.");
	} finally {
		await callback.close();
	}
}

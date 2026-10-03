import {
	EmbeddedEditorIdentitySchema,
	type EmbeddedEditorIdentity,
} from "../embedded-editor-session";

function base64url(bytes: Uint8Array) {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

/** Lives only in this iframe's memory. Never exposes a verifier to the host. */
export function createEmbeddedEditorAuth() {
	let credential:
		| { token: string; identity: EmbeddedEditorIdentity }
		| undefined;
	let flight: Promise<EmbeddedEditorIdentity> | undefined;
	let originalIdentity: EmbeddedEditorIdentity | undefined;
	async function renew() {
		if (flight) return flight;
		flight = (async () => {
			const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
			const challenge = base64url(
				new Uint8Array(
					await crypto.subtle.digest(
						"SHA-256",
						new TextEncoder().encode(verifier),
					),
				),
			);
			const query = new URLSearchParams(window.location.search);
			const nonce = query.get("nonce");
			const origin = query.get("parentOrigin");
			if (
				!nonce ||
				!origin ||
				new URL(origin).origin !== origin ||
				window.parent === window
			)
				throw new Error("Open this editor from your Haunter plugin.");
			const requestId = crypto.randomUUID();
			const id = await new Promise<string>((resolve, reject) => {
				const finish = () => {
					clearTimeout(timer);
					window.removeEventListener("message", listener);
				};
				const listener = (event: MessageEvent) => {
					if (
						event.source !== window.parent ||
						event.origin !== origin ||
						event.data?.nonce !== nonce ||
						event.data?.requestId !== requestId ||
						event.data?.type !== "haunter/editor/authorized"
					)
						return;
					finish();
					if (typeof event.data?.handoff?.id === "string")
						resolve(event.data.handoff.id);
					else
						reject(
							new Error("Reconnect Haunter to open this editor, then retry."),
						);
				};
				const timer = setTimeout(() => {
					finish();
					reject(
						new Error("Haunter did not authorize this editor. Try again."),
					);
				}, 15_000);
				window.addEventListener("message", listener);
				window.parent.postMessage(
					{ type: "haunter/editor/authorize", requestId, nonce, challenge },
					origin,
				);
			});
			const response = await fetch("/api/embedded-editor/exchange", {
				method: "POST",
				credentials: "omit",
				cache: "no-store",
				signal: AbortSignal.timeout(15_000),
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id, proofSecret: verifier }),
			});
			if (!response.ok)
				throw new Error(
					"This editor authorization expired or access changed. Try again.",
				);
			const result = await response.json();
			const identity = EmbeddedEditorIdentitySchema.parse(result.identity);
			if (typeof result.token !== "string")
				throw new Error("Invalid editor session");
			if (
				originalIdentity &&
				(originalIdentity.user.id !== identity.user.id ||
					originalIdentity.connectionId !== identity.connectionId ||
					originalIdentity.workspaceId !== identity.workspaceId ||
					originalIdentity.pageId !== identity.pageId)
			)
				throw new Error(
					"The connected Haunter account or page changed. Reopen the editor.",
				);
			originalIdentity ??= identity;
			credential = { token: result.token, identity };
			return identity;
		})().finally(() => {
			flight = undefined;
		});
		return flight;
	}
	return {
		renew,
		async token() {
			if (!credential || credential.identity.expiresAt < Date.now() + 30_000)
				await renew();
			if (!credential) throw new Error("Editor authentication unavailable");
			return credential.token;
		},
		async verify(signal: AbortSignal, recover: boolean) {
			if (recover) await renew();
			const response = await fetch("/api/embedded-editor/session", {
				credentials: "omit",
				cache: "no-store",
				signal,
				headers: { Authorization: `HaunterEmbed ${await this.token()}` },
			});
			if (response.status === 401 || response.status === 403) {
				credential = undefined;
				return null;
			}
			if (!response.ok) throw new Error("Editor verification failed");
			const identity = EmbeddedEditorIdentitySchema.parse(
				await response.json(),
			);
			return {
				userId: identity.user.id,
				workspaceId: identity.workspaceId,
				role: identity.role,
			};
		},
	};
}

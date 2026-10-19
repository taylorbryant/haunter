import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	OAuthClientInformationFullSchema,
	OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";

export const DEFAULT_SERVER = "https://www.haunter.app/mcp";
const profileSchema = z.object({
	version: z.literal(1),
	server: z.string(),
	workspaceId: z.string().optional(),
	redirectUrl: z.string().optional(),
	client: OAuthClientInformationFullSchema.optional(),
	tokens: OAuthTokensSchema.optional(),
});
export type Profile = z.infer<typeof profileSchema>;

export function serverUrl(value: string): string {
	const url = new URL(value);
	const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(
			"Use an HTTPS server URL (HTTP is allowed only on localhost), without credentials, a query, or a fragment.",
		);
	}
	if (url.pathname === "/") url.pathname = "/mcp";
	return url.toString().replace(/\/$/, "");
}

export function configDirectory(
	env: Record<string, string | undefined> = process.env,
) {
	if (env.HAUNTER_CONFIG_DIR) return resolve(env.HAUNTER_CONFIG_DIR);
	const base =
		process.platform === "win32"
			? (env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
			: (env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
	return join(base, "haunter");
}

/** One private file per server; serialize commands to protect refresh-token rotation. */
export class ProfileStore {
	readonly path: string;
	constructor(
		readonly directory: string,
		readonly server: string,
	) {
		this.path = join(
			directory,
			`${createHash("sha256").update(server).digest("hex")}.json`,
		);
	}
	async load(): Promise<Profile> {
		try {
			const profile = profileSchema.parse(
				JSON.parse(await readFile(this.path, "utf8")),
			);
			if (profile.server !== this.server) throw new Error("Server mismatch");
			return profile;
		} catch (error) {
			if (isFileError(error, "ENOENT"))
				return { version: 1, server: this.server };
			throw new Error(
				`Could not read CLI configuration at ${this.path}. Move it aside and run haunter login again.`,
				{ cause: error },
			);
		}
	}
	async save(profile: Profile) {
		profileSchema.parse(profile);
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		await chmod(this.directory, 0o700);
		const temporary = `${this.path}.${randomUUID()}.tmp`;
		const file = await open(temporary, "wx", 0o600);
		try {
			await file.writeFile(`${JSON.stringify(profile, null, 2)}\n`);
			await file.sync();
			await file.close();
			await rename(temporary, this.path);
		} finally {
			await file.close();
			await unlink(temporary).catch((error) => {
				if (!isFileError(error, "ENOENT")) throw error;
			});
		}
	}
	async lock(): Promise<() => Promise<void>> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const lockPath = `${this.path}.lock`;
		try {
			const file = await open(lockPath, "wx", 0o600);
			await file.writeFile(String(process.pid));
			await file.close();
		} catch (error) {
			if (!isFileError(error, "EEXIST")) throw error;
			throw new Error(
				`Another Haunter command is using this server. Wait for it to finish. If it was interrupted, remove ${lockPath} before retrying.`,
			);
		}
		return () =>
			unlink(lockPath).catch((error) => {
				if (!isFileError(error, "ENOENT")) throw error;
			});
	}
}

function isFileError(error: unknown, code: string) {
	return error instanceof Error && "code" in error && error.code === code;
}

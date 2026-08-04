import type { AgentPresenceStatus } from "./ports";

export const ACTIVE_AGENT_PRESENCE_TTL_SECONDS = 60;
export const FINISHED_AGENT_PRESENCE_TTL_SECONDS = 3;

type PagePresenceTarget = {
	pageId: string;
	status: Exclude<AgentPresenceStatus, "finished">;
};

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function pageIdFrom(value: unknown): string | null {
	const pageId = record(value)?.pageId;
	return typeof pageId === "string" ? pageId : null;
}

/**
 * Page capabilities that have a meaningful, user-visible room presence.
 * List and search operations intentionally stay invisible because they do not
 * enter or mutate one page.
 */
export function pagePresenceTarget(
	capability: string,
	input: unknown,
	output?: unknown,
): PagePresenceTarget | null {
	const inputPageId = pageIdFrom(input);
	switch (capability) {
		case "read_page":
			return inputPageId ? { pageId: inputPageId, status: "reading" } : null;
		case "append_to_page":
			return inputPageId ? { pageId: inputPageId, status: "editing" } : null;
		case "update_page":
			return inputPageId
				? {
						pageId: inputPageId,
						status:
							record(input)?.title === undefined ? "organizing" : "editing",
					}
				: null;
		case "archive_page":
		case "restore_page":
			return inputPageId ? { pageId: inputPageId, status: "organizing" } : null;
		case "create_page": {
			const parentPageId = record(input)?.parentPageId;
			if (typeof parentPageId === "string") {
				return { pageId: parentPageId, status: "creating" };
			}
			const outputPageId = pageIdFrom(output);
			return outputPageId ? { pageId: outputPageId, status: "creating" } : null;
		}
		default:
			return null;
	}
}

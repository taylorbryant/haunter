import { tenantScopeId } from "@beignet/core/ports";
import type { LiveContextPort } from "../ports";
import {
	LIVE_CONTEXT_TTL_MS,
	type StoredContext,
	type CanvasTextEditing,
	type PageSelection,
} from "../schemas";

export const textEditingFixture: CanvasTextEditing = {
	shapeId: "shape:a",
	selection: {
		coordinateSystem: "prosemirror",
		kind: "text",
		anchor: 1,
		head: 9,
		from: 1,
		to: 9,
		selectedText: "Hello 😺",
		truncated: false,
	},
};

export const pageSelectionFixture: PageSelection = {
	activeBlockId: "block-two",
	selectedBlockIds: ["block-one", "block-two"],
	selectionCount: 2,
	selection: {
		coordinateSystem: "prosemirror",
		kind: "text",
		anchor: 3,
		head: 24,
		from: 3,
		to: 24,
		selectedText: "First paragraph\nSecond",
		truncated: false,
	},
};

export function memoryContext(now = Date.now): LiveContextPort {
	const entries = new Map<string, StoredContext>();
	return {
		isConfigured: () => true,
		async publish(scope, userId, input) {
			const key = userId + ":" + input.sessionId;
			const previous = entries.get(key);
			if (previous && previous.sequence >= input.sequence) return false;
			const {
				expectedUserId: _,
				reportedAt: _reportedAt,
				contextAgeMs,
				...value
			} = input;
			entries.set(key, {
				...structuredClone(value),
				workspaceId: tenantScopeId(scope),
				capturedAt: now() - contextAgeMs,
				lastSeenAt: now(),
				expiresAt: now() + LIVE_CONTEXT_TTL_MS,
			});
			return true;
		},
		async list(scope, userId) {
			return [...entries]
				.filter(
					([key, value]) =>
						key.startsWith(userId + ":") &&
						value.workspaceId === tenantScopeId(scope) &&
						value.expiresAt > now(),
				)
				.map(([, value]) => structuredClone(value));
		},
	};
}

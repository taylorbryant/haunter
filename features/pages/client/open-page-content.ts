"use client";

import type { PageMeta } from "@/features/pages/schemas";

type SubpageLinkAppender = (
	child: Pick<PageMeta, "id" | "workspaceId">,
	parentContentUpdatedAt: string,
) => boolean;

const appenders = new Map<string, SubpageLinkAppender>();

export function registerSubpageLinkAppender(
	pageId: string,
	append: SubpageLinkAppender,
) {
	appenders.set(pageId, append);
	return () => {
		if (appenders.get(pageId) === append) appenders.delete(pageId);
	};
}

export function appendSubpageLinkToOpenPage(
	pageId: string,
	child: Pick<PageMeta, "id" | "workspaceId">,
	parentContentUpdatedAt: string,
): boolean {
	const append = appenders.get(pageId);
	if (!append) return false;
	try {
		return append(child, parentContentUpdatedAt);
	} catch {
		return false;
	}
}

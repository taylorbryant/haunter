"use client";

type SharedTitleWriter = {
	replace(nextTitle: string): string;
	replaceIfCurrent(expectedTitle: string, nextTitle: string): boolean;
};

export type OpenPageTitleSnapshot = {
	previousTitle: string;
};

const writers = new Map<string, SharedTitleWriter>();

export function registerOpenPageTitleWriter(
	pageId: string,
	writer: SharedTitleWriter,
) {
	writers.set(pageId, writer);
	return () => {
		if (writers.get(pageId) === writer) writers.delete(pageId);
	};
}

export function optimisticallySetOpenPageTitle(
	pageId: string,
	nextTitle: string,
): OpenPageTitleSnapshot | null {
	const writer = writers.get(pageId);
	if (!writer) return null;
	try {
		return { previousTitle: writer.replace(nextTitle) };
	} catch {
		return null;
	}
}

export function restoreOpenPageTitle(
	pageId: string,
	optimisticTitle: string,
	snapshot: OpenPageTitleSnapshot,
) {
	const writer = writers.get(pageId);
	if (!writer) return false;
	try {
		return writer.replaceIfCurrent(optimisticTitle, snapshot.previousTitle);
	} catch {
		return false;
	}
}

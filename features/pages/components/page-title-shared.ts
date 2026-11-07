"use client";

export type PageTitleFieldProps = {
	page: {
		id: string;
		workspaceId: string;
		title: string;
		updatedAt: string;
	};
	currentUserId: string | null;
	readOnly: boolean;
	onFocusEditor(): void;
};

export function resizeTitleTextarea(textarea: HTMLTextAreaElement | null) {
	if (!textarea) return;
	textarea.style.height = "0px";
	textarea.style.height = `${textarea.scrollHeight}px`;
}

"use client";

import { createContext, useContext } from "react";

/** A scoped editor can edit its page, but cannot call other feature APIs. */
export const EmbeddedEditorContext = createContext<{
	openInHaunter(): void;
	openCanvas?(canvasId: string): void;
} | null>(null);
export const useEmbeddedEditor = () => useContext(EmbeddedEditorContext);

export function EmbeddedFeatureLink({ label }: { label: string }) {
	const embedded = useEmbeddedEditor();
	return (
		<button
			type="button"
			contentEditable={false}
			className="rounded px-1 py-0.5 text-muted-foreground underline underline-offset-4 hover:text-foreground"
			onClick={() => embedded?.openInHaunter()}
		>
			{label} · Open in Haunter
		</button>
	);
}

"use client";

import type { Mounted } from "pele";
import { useEffect, useRef } from "react";
import { MERMAID_RENDER_OPTIONS } from "@/features/pages/lib/mermaid";

/** One lifecycle for node views and the fullscreen editor. Load on first use. */
export function mountMermaidPreview(container: HTMLElement) {
	const diagram = document.createElement("div");
	diagram.className = "haunter-mermaid-diagram";
	const status = document.createElement("p");
	status.className = "haunter-mermaid-status";
	status.setAttribute("role", "status");
	container.append(status, diagram);
	let mounted: Mounted | undefined;
	let request = 0;
	let previousSource: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function showError(error: unknown) {
		status.hidden = false;
		status.textContent = `Could not render diagram. ${error instanceof Error ? error.message.slice(0, 500) : "Try again or check the source."}`;
		diagram.hidden = true;
	}

	async function render(source: string, current: number) {
		try {
			const pele = await import("pele/lazy");
			await pele.load(pele.detectType(source));
			if (current !== request) return;
			mounted?.destroy();
			diagram.replaceChildren();
			diagram.hidden = false;
			mounted = pele.mount(diagram, source, {
				...MERMAID_RENDER_OPTIONS,
				onError: showError,
				onRender: () => {
					status.hidden = true;
					diagram.hidden = false;
				},
			});
		} catch (error) {
			if (current === request) showError(error);
		}
	}

	return {
		update(source: string) {
			if (source === previousSource) return;
			previousSource = source;
			const current = ++request;
			clearTimeout(timer);
			mounted?.destroy();
			mounted = undefined;
			diagram.replaceChildren();
			status.hidden = false;
			status.textContent = source.trim()
				? "Loading diagram…"
				: "Add Mermaid source to draw a diagram.";
			if (source.trim())
				timer = setTimeout(() => void render(source, current), 150);
		},
		destroy() {
			++request;
			clearTimeout(timer);
			mounted?.destroy();
			container.replaceChildren();
		},
	};
}

export function MermaidPreview({ source }: { source: string }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const previewRef = useRef<ReturnType<typeof mountMermaidPreview> | null>(
		null,
	);
	useEffect(() => {
		if (!containerRef.current) return;
		const preview = mountMermaidPreview(containerRef.current);
		previewRef.current = preview;
		return () => {
			previewRef.current = null;
			preview.destroy();
		};
	}, []);
	useEffect(() => previewRef.current?.update(source), [source]);
	return <div ref={containerRef} className="haunter-mermaid-preview" />;
}

"use client";

import { CodeXmlIcon, WorkflowIcon } from "lucide-react";
import { createRoot } from "react-dom/client";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

export type MermaidView = "diagram" | "source";

const views = [
	{ value: "diagram", label: "Diagram", icon: WorkflowIcon },
	{ value: "source", label: "Source", icon: CodeXmlIcon },
] as const;

export function MermaidViewControls({
	view,
	onViewChange,
}: {
	view: MermaidView;
	onViewChange: (view: MermaidView) => void;
}) {
	return (
		<TooltipProvider>
			<fieldset className="haunter-diagram-views" aria-label="Mermaid view">
				{views.map(({ value, label, icon: Icon }) => (
					<Tooltip key={value}>
						<TooltipTrigger
							className="keyboard-focus-ring"
							aria-label={label}
							aria-pressed={view === value}
							onClick={() => onViewChange(value)}
						>
							<Icon aria-hidden="true" className="size-4" />
						</TooltipTrigger>
						<TooltipContent side="bottom">{label}</TooltipContent>
					</Tooltip>
				))}
			</fieldset>
		</TooltipProvider>
	);
}

/** Reuse the dialog controls without replacing BlockNote's editable DOM. */
export function mountMermaidViewControls(
	container: HTMLElement,
	initialView: MermaidView,
	onViewChange: (view: MermaidView) => void,
) {
	const root = createRoot(container);
	let previousView: MermaidView | undefined;
	function update(view: MermaidView) {
		if (view === previousView) return;
		previousView = view;
		root.render(
			<MermaidViewControls view={view} onViewChange={onViewChange} />,
		);
	}
	update(initialView);
	return {
		update,
		destroy() {
			// A node view can be destroyed during a parent React commit.
			queueMicrotask(() => root.unmount());
		},
	};
}

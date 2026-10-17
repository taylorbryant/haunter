"use client";

import { KeyboardIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
	useCommand,
	useRegisteredCommands,
} from "@/components/command-palette/registry";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";

type Shortcut = {
	label: string;
	keys: string[];
	commandId?: string;
};

// Keep these in sync with SearchCommand, SidebarProvider, CreateDialogProvider,
// and the installed BlockNote/tldraw keymaps. Mod is displayed for both platforms.
const shortcutGroups: {
	title: string;
	description?: string;
	shortcuts: Shortcut[];
}[] = [
	{
		title: "General",
		shortcuts: [
			{ label: "Search", keys: ["Mod", "K"] },
			{ label: "Search (alternative)", keys: ["Mod", "Shift", "K"] },
			{ label: "Toggle sidebar (outside text fields)", keys: ["Mod", "B"] },
		],
	},
	{
		title: "Create",
		shortcuts: [
			{
				label: "Create page",
				keys: ["Mod", "Shift", "C"],
				commandId: "page.create",
			},
			{
				label: "Create task",
				keys: ["Mod", "Shift", "Enter"],
				commandId: "task.create",
			},
		],
	},
	{
		title: "Search and commands",
		description: "While the search palette is open.",
		shortcuts: [
			{ label: "Switch to commands", keys: [">"] },
			{ label: "Previous result", keys: ["↑"] },
			{ label: "Next result", keys: ["↓"] },
			{ label: "Open result or run command", keys: ["Enter"] },
			{ label: "Close", keys: ["Esc"] },
		],
	},
	{
		title: "Page editor",
		description: "While editing a page.",
		shortcuts: [
			{ label: "Insert a block", keys: ["/"] },
			{ label: "Mention a page", keys: ["@"] },
			{ label: "Bold", keys: ["Mod", "B"] },
			{ label: "Italic", keys: ["Mod", "I"] },
			{ label: "Underline", keys: ["Mod", "U"] },
			{ label: "Strikethrough", keys: ["Mod", "Shift", "S"] },
			{ label: "Inline code", keys: ["Mod", "E"] },
			{ label: "Undo", keys: ["Mod", "Z"] },
			{ label: "Redo", keys: ["Mod", "Shift", "Z"] },
			{ label: "Line break", keys: ["Shift", "Enter"] },
			{ label: "Indent block", keys: ["Tab"] },
			{ label: "Unindent block", keys: ["Shift", "Tab"] },
			{ label: "Move block up", keys: ["Mod", "Shift", "↑"] },
			{ label: "Move block down", keys: ["Mod", "Shift", "↓"] },
		],
	},
	{
		title: "Canvases",
		description: "While a canvas is focused and you are not editing text.",
		shortcuts: [
			{ label: "Select", keys: ["V"] },
			{ label: "Hand", keys: ["H"] },
			{ label: "Draw", keys: ["D"] },
			{ label: "Eraser", keys: ["E"] },
			{ label: "Rectangle", keys: ["R"] },
			{ label: "Ellipse", keys: ["O"] },
			{ label: "Arrow", keys: ["A"] },
			{ label: "Text", keys: ["T"] },
		],
	},
	{
		title: "Expanded code editor",
		shortcuts: [
			{ label: "Indent", keys: ["Tab"] },
			{ label: "Unindent", keys: ["Shift", "Tab"] },
			{ label: "Save and close", keys: ["Mod", "Enter"] },
		],
	},
];

/** Mounted outside the sidebar so closing its mobile sheet preserves the dialog. */
export function KeyboardShortcutsCommand() {
	const [open, setOpen] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	const { isMobile, setOpenMobile } = useSidebar();
	const commands = useRegisteredCommands();
	const commandIds = new Set(commands.map((command) => command.id));

	useCommand({
		id: "help.keyboard-shortcuts",
		title: "Keyboard shortcuts",
		group: "Help",
		keywords: "hotkeys keybindings keys reference",
		icon: KeyboardIcon,
		opensDialog: true,
		run: () => {
			if (isMobile) setOpenMobile(false);
			setOpen(true);
		},
	});

	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={setOpen}
			title="Keyboard shortcuts"
			description="Use ⌘ on Mac or Ctrl on Windows and Linux."
			className="max-h-[calc(100dvh-2rem)] sm:max-w-lg"
			initialFocus={contentRef}
		>
			<div
				ref={contentRef}
				tabIndex={-1}
				className="flex min-h-0 flex-col gap-6 overflow-y-auto outline-none md:max-h-[60dvh]"
			>
				{shortcutGroups.map((group) => {
					const shortcuts = group.shortcuts.filter(
						(shortcut) =>
							!shortcut.commandId || commandIds.has(shortcut.commandId),
					);
					if (shortcuts.length === 0) return null;
					return (
						<section key={group.title} className="flex flex-col gap-2">
							<h3 className="text-balance font-medium text-base sm:text-sm">
								{group.title}
							</h3>
							{group.description ? (
								<p className="text-pretty text-muted-foreground text-base sm:text-sm">
									{group.description}
								</p>
							) : null}
							<dl className="divide-y divide-foreground/5">
								{shortcuts.map((shortcut) => (
									<div
										key={shortcut.label}
										className="flex flex-wrap items-center justify-between gap-2 py-2"
									>
										<dt className="min-w-0 font-medium text-base sm:text-sm">
											{shortcut.label}
										</dt>
										<dd className="flex shrink-0 items-center gap-1 text-muted-foreground text-sm">
											{shortcut.keys.map((key) => (
												<kbd
													key={key}
													className="min-w-6 rounded border border-foreground/10 bg-muted px-1.5 py-0.5 text-center font-sans"
												>
													{key === "Mod" ? "⌘ / Ctrl" : key}
												</kbd>
											))}
										</dd>
									</div>
								))}
							</dl>
						</section>
					);
				})}
			</div>
			<ResponsiveDialogFooter>
				<Button type="button" variant="outline" onClick={() => setOpen(false)}>
					Done
				</Button>
			</ResponsiveDialogFooter>
		</ResponsiveDialog>
	);
}

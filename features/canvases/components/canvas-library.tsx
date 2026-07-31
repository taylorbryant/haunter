"use client";

import { Tabs } from "@base-ui/react/tabs";
import {
	BoxIcon,
	BracesIcon,
	CloudIcon,
	Columns3Icon,
	DatabaseIcon,
	GitBranchIcon,
	LayoutGridIcon,
	ListIcon,
	type LucideIcon,
	MonitorIcon,
	PanelBottomIcon,
	PanelLeftIcon,
	PanelTopIcon,
	RectangleHorizontalIcon,
	SearchIcon,
	ServerIcon,
	SettingsIcon,
	Table2Icon,
	XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type TLComponents, useEditor } from "tldraw";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import {
	CANVAS_LIBRARY_PANEL_WIDTH,
	type CanvasLibraryItem,
	type CanvasLibraryKind,
	insertCanvasLibraryItem,
	searchCanvasLibraryItems,
} from "@/features/canvases/lib/library";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const ARCHITECTURE_ICONS: Record<string, LucideIcon> = {
	client: MonitorIcon,
	"api-endpoint": BracesIcon,
	service: ServerIcon,
	database: DatabaseIcon,
	"data-store": Table2Icon,
	queue: ListIcon,
	worker: SettingsIcon,
	"external-system": CloudIcon,
	decision: GitBranchIcon,
	"system-boundary": BoxIcon,
};

function LibraryPreview({ entry }: { entry: CanvasLibraryItem }) {
	if (entry.kind === "template") {
		if (entry.category === "architecture") {
			return (
				<div
					className="flex h-full items-center justify-center gap-1.5 px-2"
					aria-hidden="true"
				>
					{[0, 1, 2].map((index) => (
						<div key={index} className="flex items-center gap-1.5">
							<div className="h-7 w-10 rounded-sm border border-current/40 bg-background/50" />
							{index < 2 ? <div className="h-px w-3 bg-current/40" /> : null}
						</div>
					))}
				</div>
			);
		}
		return (
			<div
				className="relative mx-auto h-16 w-24 overflow-hidden rounded-sm border border-current/40 bg-background/50"
				aria-hidden="true"
			>
				<div className="absolute inset-y-0 left-0 w-6 border-current/30 border-r bg-current/8" />
				<div className="absolute top-2 right-2 left-8 h-2 rounded-sm bg-current/20" />
				<div className="absolute top-7 right-2 left-8 h-6 rounded-sm border border-current/30" />
				<div className="absolute right-2 bottom-2 left-8 h-2 rounded-sm bg-current/10" />
			</div>
		);
	}

	if (entry.category === "architecture") {
		const Icon = ARCHITECTURE_ICONS[entry.id] ?? BoxIcon;
		return (
			<Icon className="size-4 shrink-0 stroke-current" aria-hidden="true" />
		);
	}

	if (entry.id === "phone-frame") {
		return (
			<div
				className="relative h-16 w-9 rounded-sm border border-current/50"
				aria-hidden="true"
			>
				<div className="absolute top-1 right-1 left-1 h-1.5 rounded-sm bg-current/15" />
				<div className="absolute right-2 bottom-1 left-2 h-0.5 rounded-full bg-current/30" />
			</div>
		);
	}

	if (entry.id === "tabs") {
		return (
			<div
				className="flex h-10 w-24 items-end gap-2 border-current/30 border-b px-1"
				aria-hidden="true"
			>
				<div className="h-6 flex-1 border-current/60 border-b-2" />
				<div className="h-6 flex-1" />
				<div className="h-6 flex-1" />
			</div>
		);
	}

	if (entry.id === "button") {
		return (
			<div
				className="h-7 w-20 rounded-sm border border-current/50 bg-current/10"
				aria-hidden="true"
			/>
		);
	}

	if (entry.id === "input-field" || entry.id === "select-field") {
		return (
			<div className="flex w-24 flex-col gap-1.5" aria-hidden="true">
				<div className="h-1.5 w-10 rounded-sm bg-current/30" />
				<div className="h-7 rounded-sm border border-current/40" />
			</div>
		);
	}

	if (entry.id === "table") {
		return (
			<div
				className="grid h-14 w-24 grid-rows-4 overflow-hidden rounded-sm border border-current/40"
				aria-hidden="true"
			>
				{[0, 1, 2, 3].map((index) => (
					<div
						key={index}
						className={cn(
							"border-current/25 border-b last:border-b-0",
							index === 0 && "bg-current/10",
						)}
					/>
				))}
			</div>
		);
	}

	const PreviewIcon =
		entry.id === "browser-frame"
			? MonitorIcon
			: entry.id === "top-navigation"
				? PanelTopIcon
				: entry.id === "sidebar-navigation"
					? PanelLeftIcon
					: entry.id === "bottom-sheet"
						? PanelBottomIcon
						: entry.id === "dialog"
							? RectangleHorizontalIcon
							: Columns3Icon;
	return (
		<PreviewIcon
			className="size-4 shrink-0 stroke-current"
			aria-hidden="true"
		/>
	);
}

function LibraryItemButton({
	entry,
	onInsert,
}: {
	entry: CanvasLibraryItem;
	onInsert: (entry: CanvasLibraryItem) => void;
}) {
	return (
		<button
			type="button"
			className="keyboard-focus-ring group/library-item flex min-h-28 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background text-left hover:bg-accent hover:text-accent-foreground max-sm:min-h-32"
			onClick={() => onInsert(entry)}
		>
			<div className="flex min-h-0 flex-1 items-center justify-center self-stretch overflow-hidden border-border/70 border-b bg-muted/30 p-3 text-muted-foreground group-hover/library-item:text-foreground">
				<LibraryPreview entry={entry} />
			</div>
			<div className="min-w-0 self-stretch truncate px-2.5 py-2 text-base sm:text-sm">
				{entry.name}
			</div>
		</button>
	);
}

function LibraryResults({
	items,
	onInsert,
}: {
	items: CanvasLibraryItem[];
	onInsert: (entry: CanvasLibraryItem) => void;
}) {
	if (items.length === 0) {
		return (
			<div className="flex min-h-32 items-center justify-center px-6 text-center text-base text-muted-foreground sm:text-sm">
				No matching library items.
			</div>
		);
	}

	const groups = (["architecture", "wireframes"] as const)
		.map((category) => ({
			category,
			items: items.filter((entry) => entry.category === category),
		}))
		.filter((group) => group.items.length > 0);

	return (
		<div className="flex flex-col gap-5 pb-2">
			{groups.map((group) => (
				<section key={group.category} className="flex flex-col gap-2.5">
					<h3 className="px-0.5 font-medium text-muted-foreground text-sm">
						{group.category === "architecture" ? "Architecture" : "Wireframes"}
					</h3>
					<div className="grid grid-cols-2 gap-2">
						{group.items.map((entry) => (
							<LibraryItemButton
								key={entry.id}
								entry={entry}
								onInsert={onInsert}
							/>
						))}
					</div>
				</section>
			))}
		</div>
	);
}

function LibraryBody({
	query,
	onQueryChange,
	kind,
	onKindChange,
	onInsert,
}: {
	query: string;
	onQueryChange: (query: string) => void;
	kind: CanvasLibraryKind;
	onKindChange: (kind: CanvasLibraryKind) => void;
	onInsert: (entry: CanvasLibraryItem) => void;
}) {
	const items = useMemo(
		() => searchCanvasLibraryItems(query, kind),
		[kind, query],
	);

	return (
		<Tabs.Root
			value={kind}
			onValueChange={(value) => onKindChange(value as CanvasLibraryKind)}
			className="flex min-h-0 flex-1 flex-col gap-3"
		>
			<div className="relative shrink-0">
				<SearchIcon
					className="pointer-events-none absolute top-1/2 left-2.5 size-4 shrink-0 -translate-y-1/2 stroke-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					autoFocus
					name="canvas-library-search"
					aria-label="Search canvas library"
					placeholder="Search components and templates…"
					value={query}
					onChange={(event) => onQueryChange(event.currentTarget.value)}
					className="pl-8"
				/>
			</div>
			<Tabs.List
				className="flex shrink-0 gap-1 overflow-x-auto rounded-lg bg-muted p-1"
				aria-label="Canvas library sections"
			>
				{(["component", "template"] as const).map((value) => (
					<Tabs.Tab
						key={value}
						value={value}
						className="keyboard-focus-ring min-h-8 flex-1 rounded-md px-3 text-base text-muted-foreground data-active:bg-background data-active:text-foreground sm:text-sm"
					>
						{value === "component" ? "Components" : "Templates"}
					</Tabs.Tab>
				))}
			</Tabs.List>
			<Tabs.Panel
				value={kind}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
			>
				<LibraryResults items={items} onInsert={onInsert} />
			</Tabs.Panel>
		</Tabs.Root>
	);
}

function CanvasLibraryOverlay() {
	const editor = useEditor();
	const isMobile = useIsMobile();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [kind, setKind] = useState<CanvasLibraryKind>("component");
	const cascadeRef = useRef(0);

	useEffect(() => {
		if (!open || isMobile) return;
		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") setOpen(false);
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isMobile, open]);

	function changeOpen(nextOpen: boolean) {
		setOpen(nextOpen);
		if (!nextOpen) {
			setQuery("");
			cascadeRef.current = 0;
		}
	}

	function insert(entry: CanvasLibraryItem) {
		insertCanvasLibraryItem(editor, entry, {
			panelWidth: isMobile ? 0 : CANVAS_LIBRARY_PANEL_WIDTH + 16,
			cascadeOffset: isMobile ? 0 : cascadeRef.current,
		});
		cascadeRef.current += 20;
		if (isMobile) changeOpen(false);
	}

	const body = (
		<LibraryBody
			query={query}
			onQueryChange={setQuery}
			kind={kind}
			onKindChange={setKind}
			onInsert={insert}
		/>
	);

	return (
		<div className="pointer-events-none absolute inset-0">
			<Button
				type="button"
				variant="secondary"
				size="sm"
				aria-expanded={open}
				aria-label="Open canvas library"
				className="pointer-events-auto absolute top-2 left-36 z-20 bg-popover text-popover-foreground shadow-sm dark:shadow-none md:in-data-[canvas-layout=fullscreen]:left-80"
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					changeOpen(!open);
				}}
			>
				<LayoutGridIcon
					data-icon="inline-start"
					className="size-4 shrink-0 stroke-current"
					aria-hidden="true"
				/>
				Library
			</Button>

			{isMobile ? (
				<Drawer showSwipeHandle open={open} onOpenChange={changeOpen}>
					<DrawerContent className="h-[80dvh]">
						<DrawerHeader className="pb-3 text-left">
							<DrawerTitle>Canvas library</DrawerTitle>
							<DrawerDescription>
								Insert editable architecture and wireframe building blocks.
							</DrawerDescription>
						</DrawerHeader>
						<div className="flex min-h-0 flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
							{body}
						</div>
					</DrawerContent>
				</Drawer>
			) : open ? (
				<aside
					aria-label="Canvas library"
					className="pointer-events-auto absolute top-12 bottom-20 left-2 z-20 flex w-80 flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 dark:shadow-none"
					onPointerDown={(event) => event.stopPropagation()}
					onWheel={(event) => event.stopPropagation()}
				>
					<header className="flex shrink-0 items-start justify-between gap-3 border-border/70 border-b px-4 py-3">
						<div className="min-w-0">
							<h2 className="font-medium text-base">Canvas library</h2>
							<p className="text-pretty text-muted-foreground text-sm">
								Insert editable building blocks.
							</p>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Close canvas library"
							onClick={() => changeOpen(false)}
						>
							<span
								aria-hidden="true"
								className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
							/>
							<XIcon
								className="size-4 shrink-0 stroke-current"
								aria-hidden="true"
							/>
						</Button>
					</header>
					<div className="flex min-h-0 flex-1 flex-col p-3">{body}</div>
				</aside>
			) : null}
		</div>
	);
}

export const CANVAS_LIBRARY_COMPONENTS: TLComponents = {
	InFrontOfTheCanvas: CanvasLibraryOverlay,
};

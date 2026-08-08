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
	SearchIcon,
	ServerIcon,
	SettingsIcon,
	Table2Icon,
	XIcon,
} from "lucide-react";
import {
	type ReactNode,
	type SyntheticEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
import {
	ADDITIONAL_WIREFRAME_PREVIEW_IDS,
	AdditionalWireframePreview,
} from "./canvas-library-wireframe-previews";

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

const DETAILED_WIREFRAME_PREVIEW_IDS = new Set([
	"browser-frame",
	"top-navigation",
	"sidebar-navigation",
	"card",
	"dialog",
	"bottom-sheet",
]);

function DetailedWireframePreview({ id }: { id: string }) {
	if (id === "browser-frame") {
		return (
			<div
				className="relative h-16 w-24 overflow-hidden rounded-sm border border-current/45 bg-background/55"
				aria-hidden="true"
			>
				<div className="flex h-3.5 items-center gap-1 border-current/30 border-b bg-current/8 px-1.5">
					<div className="size-1 rounded-full bg-current/35" />
					<div className="size-1 rounded-full bg-current/25" />
					<div className="h-1.5 flex-1 rounded-full border border-current/25 bg-background/70" />
				</div>
				<div className="grid grid-cols-[1.5rem_1fr] gap-1.5 p-1.5">
					<div className="h-10 rounded-sm bg-current/8" />
					<div className="flex flex-col gap-1.5 pt-0.5">
						<div className="h-1.5 w-8 rounded-full bg-current/35" />
						<div className="h-4 rounded-sm border border-current/25" />
						<div className="h-1 w-9 rounded-full bg-current/15" />
					</div>
				</div>
			</div>
		);
	}

	if (id === "top-navigation") {
		return (
			<div
				className="flex h-7 w-28 items-center gap-2 rounded-sm border border-current/45 bg-background/55 px-1.5"
				aria-hidden="true"
			>
				<div className="h-2 w-5 rounded-sm bg-current/40" />
				<div className="flex min-w-0 flex-1 justify-end gap-1.5">
					<div className="h-1 w-3 rounded-full bg-current/20" />
					<div className="h-1 w-3 rounded-full bg-current/20" />
				</div>
				<div className="h-3.5 w-6 rounded-sm border border-current/35 bg-current/10" />
			</div>
		);
	}

	if (id === "sidebar-navigation") {
		return (
			<div
				className="grid h-16 w-12 grid-rows-[0.375rem_0.75rem_0.25rem_0.25rem_1fr] gap-1.5 rounded-sm border border-current/45 bg-background/55 p-1.5"
				aria-hidden="true"
			>
				<div className="h-1.5 w-6 rounded-full bg-current/40" />
				<div className="h-3 rounded-sm border border-current/20 bg-current/12" />
				<div className="flex items-center gap-1 px-0.5">
					<div className="size-1 rounded-sm bg-current/25" />
					<div className="h-1 flex-1 rounded-full bg-current/20" />
				</div>
				<div className="flex items-center gap-1 px-0.5">
					<div className="size-1 rounded-sm bg-current/20" />
					<div className="h-1 w-5 rounded-full bg-current/15" />
				</div>
				<div className="h-1 w-5 self-end rounded-full bg-current/15" />
			</div>
		);
	}

	if (id === "card") {
		return (
			<div
				className="relative h-16 w-24 rounded-md border border-current/45 bg-background/55 p-2"
				aria-hidden="true"
			>
				<div className="h-1.5 w-9 rounded-full bg-current/40" />
				<div className="mt-2 h-1 w-16 rounded-full bg-current/20" />
				<div className="mt-1.5 h-1 w-12 rounded-full bg-current/15" />
				<div className="absolute right-2 bottom-2 h-3.5 w-7 rounded-sm border border-current/35 bg-current/10" />
			</div>
		);
	}

	if (id === "dialog") {
		return (
			<div
				className="relative h-16 w-24 rounded-md border border-current/45 bg-current/8 p-2"
				aria-hidden="true"
			>
				<div className="h-1.5 w-10 rounded-full bg-current/40" />
				<div className="absolute top-2 right-2 size-1.5 rounded-full border border-current/40" />
				<div className="mt-2.5 h-1 w-16 rounded-full bg-current/20" />
				<div className="mt-1.5 h-1 w-12 rounded-full bg-current/15" />
				<div className="absolute right-2 bottom-2 flex gap-1">
					<div className="h-3 w-6 rounded-sm border border-current/30 bg-background/45" />
					<div className="h-3 w-7 rounded-sm border border-current/35 bg-current/15" />
				</div>
			</div>
		);
	}

	if (id === "bottom-sheet") {
		return (
			<div
				className="relative h-16 w-20 overflow-hidden rounded-sm border border-current/35 bg-background/40"
				aria-hidden="true"
			>
				<div className="absolute inset-x-0 bottom-0 h-12 rounded-t-lg border-current/45 border-t bg-background/85 px-2 pt-2.5">
					<div className="absolute top-1 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-current/30" />
					<div className="mx-auto h-1.5 w-8 rounded-full bg-current/40" />
					<div className="mt-2 h-1 w-full rounded-full bg-current/20" />
					<div className="mt-1.5 h-1 w-3/4 rounded-full bg-current/15" />
				</div>
			</div>
		);
	}

	return null;
}

export function LibraryPreview({ entry }: { entry: CanvasLibraryItem }) {
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

	if (DETAILED_WIREFRAME_PREVIEW_IDS.has(entry.id)) {
		return <DetailedWireframePreview id={entry.id} />;
	}

	if (ADDITIONAL_WIREFRAME_PREVIEW_IDS.has(entry.id)) {
		return <AdditionalWireframePreview id={entry.id} />;
	}

	return (
		<Columns3Icon
			className="size-4 shrink-0 stroke-current"
			aria-hidden="true"
		/>
	);
}

export function LibraryItemButton({
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

export function CanvasLibraryInteractionBoundary({
	onInteraction,
	children,
}: {
	onInteraction: (event: SyntheticEvent) => void;
	children: ReactNode;
}) {
	return (
		<div
			className="pointer-events-none absolute inset-0"
			onPointerDown={onInteraction}
			onPointerMove={onInteraction}
			onPointerUp={onInteraction}
			onTouchStart={onInteraction}
			onTouchEnd={onInteraction}
			onWheel={(event) => event.stopPropagation()}
		>
			{children}
		</div>
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
	const panelRef = useRef<HTMLDivElement>(null);
	const items = useMemo(
		() => searchCanvasLibraryItems(query, kind),
		[kind, query],
	);

	function resetPanelScroll() {
		if (panelRef.current) panelRef.current.scrollTop = 0;
	}

	return (
		<Tabs.Root
			value={kind}
			onValueChange={(value) => {
				resetPanelScroll();
				onKindChange(value as CanvasLibraryKind);
			}}
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
					onChange={(event) => {
						resetPanelScroll();
						onQueryChange(event.currentTarget.value);
					}}
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
				ref={panelRef}
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
		<CanvasLibraryInteractionBoundary
			// tldraw prevents unclaimed canvas touch events by default, which also
			// suppresses the synthetic click that iOS sends to the Library button.
			// Claim library interactions without blocking their normal DOM behavior.
			onInteraction={editor.markEventAsHandled}
		>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				aria-expanded={open}
				aria-label="Open canvas library"
				className="pointer-events-auto absolute top-2 left-36 z-20 bg-popover text-popover-foreground shadow-sm dark:shadow-none md:in-data-[canvas-layout=fullscreen]:left-80"
				onClick={() => changeOpen(!open)}
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
		</CanvasLibraryInteractionBoundary>
	);
}

export const CANVAS_LIBRARY_COMPONENTS: TLComponents = {
	InFrontOfTheCanvas: CanvasLibraryOverlay,
};

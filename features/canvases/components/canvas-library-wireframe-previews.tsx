export const ADDITIONAL_WIREFRAME_PREVIEW_IDS = new Set([
	"checkbox",
	"radio-group",
	"toggle-switch",
	"textarea",
	"search-field",
	"dropdown-menu",
	"alert-banner",
	"toast",
	"badge",
	"avatar",
	"task-row",
	"breadcrumbs",
	"toolbar",
	"side-sheet",
	"mobile-bottom-navigation",
	"empty-state",
	"loading-skeleton",
]);

export function AdditionalWireframePreview({ id }: { id: string }) {
	if (id === "checkbox") {
		return (
			<div className="flex items-center gap-2" aria-hidden="true">
				<div className="grid size-5 place-items-center rounded-sm border border-current/50 bg-current/10 text-xs">
					✓
				</div>
				<div className="h-1.5 w-14 rounded-full bg-current/30" />
			</div>
		);
	}

	if (id === "radio-group") {
		return (
			<div className="flex w-24 flex-col gap-2" aria-hidden="true">
				{[0, 1, 2].map((index) => (
					<div key={index} className="flex items-center gap-2">
						<div className="grid size-4 place-items-center rounded-full border border-current/45">
							{index === 0 ? (
								<div className="size-2 rounded-full bg-current/55" />
							) : null}
						</div>
						<div className="h-1.5 flex-1 rounded-full bg-current/20" />
					</div>
				))}
			</div>
		);
	}

	if (id === "toggle-switch") {
		return (
			<div className="flex items-center gap-2.5" aria-hidden="true">
				<div className="flex h-5 w-9 justify-end rounded-full border border-current/40 bg-current/15 p-0.5">
					<div className="aspect-square h-full rounded-full bg-current/60" />
				</div>
				<div className="h-1.5 w-12 rounded-full bg-current/25" />
			</div>
		);
	}

	if (id === "textarea") {
		return (
			<div className="flex w-24 flex-col gap-1.5" aria-hidden="true">
				<div className="h-1.5 w-9 rounded-full bg-current/30" />
				<div className="flex h-12 flex-col gap-1.5 rounded-sm border border-current/40 p-2">
					<div className="h-1 w-16 rounded-full bg-current/18" />
					<div className="h-1 w-11 rounded-full bg-current/12" />
				</div>
			</div>
		);
	}

	if (id === "search-field") {
		return (
			<div
				className="flex h-8 w-24 items-center gap-2 rounded-full border border-current/40 px-2"
				aria-hidden="true"
			>
				<div className="size-3 rounded-full border border-current/45" />
				<div className="h-1.5 flex-1 rounded-full bg-current/20" />
			</div>
		);
	}

	if (id === "dropdown-menu") {
		return (
			<div
				className="flex h-16 w-20 flex-col gap-1 rounded-md border border-current/40 bg-background/55 p-1.5"
				aria-hidden="true"
			>
				<div className="h-2 rounded-sm bg-current/10" />
				<div className="h-3 rounded-sm bg-current/20" />
				<div className="h-2 rounded-sm bg-current/10" />
				<div className="h-2 rounded-sm bg-current/10" />
			</div>
		);
	}

	if (id === "alert-banner") {
		return (
			<div
				className="flex h-12 w-28 items-start gap-2 rounded-sm border border-current/40 bg-current/8 p-2"
				aria-hidden="true"
			>
				<div className="mt-0.5 size-3 shrink-0 rounded-full bg-current/35" />
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<div className="h-1.5 w-12 rounded-full bg-current/40" />
					<div className="h-1 w-full rounded-full bg-current/15" />
				</div>
			</div>
		);
	}

	if (id === "toast") {
		return (
			<div
				className="relative flex h-12 w-24 items-start gap-2 rounded-md border border-current/40 bg-background/60 p-2"
				aria-hidden="true"
			>
				<div className="mt-0.5 size-2.5 shrink-0 rounded-full bg-current/45" />
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<div className="h-1.5 w-10 rounded-full bg-current/35" />
					<div className="h-1 w-full rounded-full bg-current/15" />
				</div>
				<div className="absolute top-1.5 right-1.5 size-1.5 rounded-full border border-current/35" />
			</div>
		);
	}

	if (id === "badge") {
		return (
			<div
				className="h-6 w-16 rounded-full border border-current/40 bg-current/12"
				aria-hidden="true"
			/>
		);
	}

	if (id === "avatar") {
		return (
			<div
				className="flex size-14 flex-col items-center justify-end overflow-hidden rounded-full border border-current/45 bg-current/8"
				aria-hidden="true"
			>
				<div className="size-5 rounded-full bg-current/35" />
				<div className="mt-1 h-5 w-9 rounded-t-full bg-current/25" />
			</div>
		);
	}

	if (id === "task-row") {
		return (
			<div
				className="flex h-12 w-28 items-center gap-2 rounded-sm border border-current/35 px-2"
				aria-hidden="true"
			>
				<div className="size-3.5 shrink-0 rounded-sm border border-current/45" />
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<div className="h-1.5 w-12 rounded-full bg-current/30" />
					<div className="h-1 w-9 rounded-full bg-current/15" />
				</div>
				<div className="h-3 w-6 rounded-full bg-current/12" />
			</div>
		);
	}

	if (id === "breadcrumbs") {
		return (
			<div className="flex w-28 items-center gap-1.5" aria-hidden="true">
				<div className="h-1.5 w-7 rounded-full bg-current/20" />
				<div className="text-xs text-current/35">›</div>
				<div className="h-1.5 w-6 rounded-full bg-current/20" />
				<div className="text-xs text-current/35">›</div>
				<div className="h-1.5 w-8 rounded-full bg-current/45" />
			</div>
		);
	}

	if (id === "toolbar") {
		return (
			<div
				className="flex h-9 w-28 items-center gap-1.5 rounded-md border border-current/40 p-1.5"
				aria-hidden="true"
			>
				{[0, 1, 2, 3, 4].map((index) => (
					<div
						key={index}
						className={`size-4 rounded-sm border border-current/25 ${index === 1 ? "bg-current/18" : ""}`}
					/>
				))}
			</div>
		);
	}

	if (id === "side-sheet") {
		return (
			<div
				className="relative h-16 w-14 rounded-sm border border-current/45 bg-background/55 p-2"
				aria-hidden="true"
			>
				<div className="h-1.5 w-7 rounded-full bg-current/40" />
				<div className="absolute top-2 right-2 size-1.5 rounded-full border border-current/35" />
				<div className="mt-3 h-1 w-full rounded-full bg-current/18" />
				<div className="mt-1.5 h-1 w-3/4 rounded-full bg-current/12" />
				<div className="absolute right-2 bottom-2 h-3 w-5 rounded-sm bg-current/15" />
			</div>
		);
	}

	if (id === "mobile-bottom-navigation") {
		return (
			<div
				className="flex h-10 w-28 items-center justify-around rounded-sm border border-current/40 px-1"
				aria-hidden="true"
			>
				{[0, 1, 2, 3].map((index) => (
					<div key={index} className="flex flex-col items-center gap-1">
						<div
							className={`size-2.5 rounded-sm border border-current/35 ${index === 0 ? "bg-current/20" : ""}`}
						/>
						<div className="h-0.5 w-3 rounded-full bg-current/20" />
					</div>
				))}
			</div>
		);
	}

	if (id === "empty-state") {
		return (
			<div className="flex w-24 flex-col items-center" aria-hidden="true">
				<div className="h-7 w-9 rounded-sm border border-current/35 bg-current/8" />
				<div className="mt-2 h-1.5 w-12 rounded-full bg-current/35" />
				<div className="mt-1.5 h-1 w-16 rounded-full bg-current/15" />
				<div className="mt-2 h-4 w-8 rounded-sm border border-current/35 bg-current/10" />
			</div>
		);
	}

	if (id === "loading-skeleton") {
		return (
			<div className="flex w-24 flex-col gap-2" aria-hidden="true">
				<div className="flex items-center gap-2">
					<div className="size-6 shrink-0 rounded-full bg-current/15" />
					<div className="flex flex-1 flex-col gap-1.5">
						<div className="h-1.5 w-full rounded-full bg-current/20" />
						<div className="h-1 w-2/3 rounded-full bg-current/12" />
					</div>
				</div>
				<div className="h-1.5 w-full rounded-full bg-current/15" />
				<div className="h-1.5 w-4/5 rounded-full bg-current/12" />
			</div>
		);
	}

	return null;
}

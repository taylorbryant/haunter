import {
	type ActiveView,
	type CanvasSelection,
	type PublishContextInput,
	LIVE_CONTEXT_MAX_SHAPES,
} from "../schemas";

export type ContextRoute = {
	workspaceId: string;
	pageId: string | null;
	canvasId: string | null;
};
export function contextRoute(pathname: string): ContextRoute | null {
	const match = pathname.match(/^\/w\/([^/]+)(?:\/(p|c)\/([^/]+))?(?:\/|$)/);
	if (!match) return null;
	return {
		workspaceId: match[1],
		pageId: match[2] === "p" ? match[3] : null,
		canvasId: match[2] === "c" ? match[3] : null,
	};
}

const emptyCanvas = (canvasId: string): CanvasSelection => ({
	canvasId,
	canvasPageId: null,
	selectedShapeIds: [],
	selectionCount: 0,
	textEditing: null,
});

/** One instance per signed-in tab. Never persist its ID in shared localStorage
 * or copied sessionStorage: duplicate tabs must have different identities. */
export class LiveContextTracker {
	readonly sessionId: string;
	private sequence = 0;
	private route: ContextRoute | null = null;
	private view: ActiveView | null = null;
	private changedAt = 0;
	private visible = false;
	private focused = false;
	private pending: PublishContextInput | null = null;
	private pendingAt = 0;
	private flight: Promise<void> | null = null;
	onChange: (() => void) | undefined;
	constructor(
		private readonly userId: string,
		private readonly send: (input: PublishContextInput) => Promise<unknown>,
		private readonly now = Date.now,
		sessionId = crypto.randomUUID(),
	) {
		this.sessionId = sessionId;
	}
	navigate(route: ContextRoute | null) {
		if (JSON.stringify(route) === JSON.stringify(this.route)) return;
		const previous = this.route;
		this.route = route;
		this.view = route?.pageId
			? { pageId: route.pageId, canvas: null }
			: route?.canvasId
				? { pageId: null, canvas: emptyCanvas(route.canvasId) }
				: null;
		this.changedAt = this.now();
		// A tombstone uses the previous workspace when leaving the workspace UI.
		this.queue(route?.workspaceId ?? previous?.workspaceId);
	}
	presence(visible: boolean, focused: boolean) {
		if (this.visible === visible && this.focused === focused) return;
		this.visible = visible;
		this.focused = focused;
		this.queue();
	}
	canvas(
		workspaceId: string,
		pageId: string | null,
		selection: CanvasSelection,
		activate: boolean,
	) {
		if (
			!this.route ||
			this.route.workspaceId !== workspaceId ||
			this.route.pageId !== pageId
		)
			return;
		if (
			this.route.pageId === null &&
			this.route.canvasId !== selection.canvasId
		)
			return;
		if (!activate && this.view?.canvas?.canvasId !== selection.canvasId) return;
		const next: ActiveView = {
			pageId,
			canvas: {
				...selection,
				selectedShapeIds: selection.selectedShapeIds.slice(
					0,
					LIVE_CONTEXT_MAX_SHAPES,
				),
			},
		};
		if (JSON.stringify(next) === JSON.stringify(this.view)) return;
		this.view = next;
		this.changedAt = this.now();
		this.queue();
	}
	clearCanvas(canvasId?: string) {
		if (
			!this.view?.canvas ||
			(canvasId && this.view.canvas.canvasId !== canvasId)
		)
			return;
		this.view = this.route?.pageId
			? { pageId: this.route.pageId, canvas: null }
			: this.route?.canvasId
				? { pageId: null, canvas: emptyCanvas(this.route.canvasId) }
				: null;
		this.changedAt = this.now();
		this.queue();
	}
	withdraw() {
		this.view = null;
		this.changedAt = this.now();
		this.queue();
	}
	heartbeat() {
		this.queue();
	}
	private queue(workspaceId = this.route?.workspaceId) {
		if (!workspaceId) return;
		this.pendingAt = this.now();
		this.pending = {
			workspaceId,
			expectedUserId: this.userId,
			sessionId: this.sessionId,
			sequence: ++this.sequence,
			reportedAt: this.pendingAt,
			visible: this.visible,
			focused: this.focused,
			contextAgeMs: Math.max(0, this.now() - this.changedAt),
			view: this.view ? structuredClone(this.view) : null,
		};
		this.onChange?.();
	}
	/** Serial/coalesced requests bound traffic and cannot publish old selections
	 * after newer ones. Failed heartbeats retry only on a later change/tick. */
	flush(): Promise<void> {
		if (this.flight) return this.flight;
		if (!this.pending) return Promise.resolve();
		const input = {
			...this.pending,
			contextAgeMs:
				this.pending.contextAgeMs + Math.max(0, this.now() - this.pendingAt),
		};
		this.pending = null;
		this.flight = (async () => {
			try {
				await this.send(input);
			} catch {
				/* Context is optional; never block editing. */
			}
		})().finally(() => {
			this.flight = null;
			// Go through the debounce again; a stream of selection updates during
			// slow requests must not turn into an unthrottled request loop.
			if (this.pending) this.onChange?.();
		});
		return this.flight;
	}
}

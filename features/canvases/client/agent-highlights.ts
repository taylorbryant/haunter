import {
	atom,
	type Editor,
	OverlayUtil,
	strokeShapeIndicators,
	type TLOverlay,
	type TLShapeId,
} from "tldraw";

// An editor-local atom is deliberately outside the document and instance stores:
// highlighting cannot change selection, sync to peers, or enter undo history.
const highlights = new WeakMap<Editor, ReturnType<typeof createHighlights>>();
const createHighlights = () =>
	atom<readonly string[]>("Haunter agent changes", []);
function state(editor: Editor) {
	let value = highlights.get(editor);
	if (!value) {
		value = createHighlights();
		highlights.set(editor, value);
	}
	return value;
}
export function setAgentHighlights(
	editor: Editor,
	shapeIds: readonly string[],
) {
	state(editor).set(shapeIds);
}
interface AgentHighlight extends TLOverlay {
	props: { shapeIds: TLShapeId[] };
}
export class AgentHighlightOverlayUtil extends OverlayUtil<AgentHighlight> {
	static override type = "haunter_agent_changes";
	override options = { zIndex: 48 };
	isActive() {
		return state(this.editor).get().length > 0;
	}
	getOverlays(): AgentHighlight[] {
		const requested = new Set(state(this.editor).get());
		const shapeIds = this.editor
			.getRenderingShapes()
			.filter(
				(shape) =>
					requested.has(shape.id) && !this.editor.isShapeHidden(shape.id),
			)
			.map((shape) => shape.id);
		return shapeIds.length
			? [
					{
						id: "haunter_agent_changes",
						type: "haunter_agent_changes",
						props: { shapeIds },
					},
				]
			: [];
	}
	render(ctx: CanvasRenderingContext2D, overlays: AgentHighlight[]) {
		const overlay = overlays[0];
		if (!overlay) return;
		ctx.save();
		ctx.strokeStyle =
			this.editor.getColorMode() === "dark" ? "#c4b5fd" : "#7c3aed";
		ctx.lineWidth = 3 / this.editor.getZoomLevel();
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		strokeShapeIndicators(this.editor, ctx, overlay.props.shapeIds);
		ctx.restore();
	}
}
export const AGENT_HIGHLIGHT_OVERLAYS = [AgentHighlightOverlayUtil];

import * as Y from "yjs";
import { PAGE_BODY_FRAGMENT } from "@/features/documents/model";

export type AssignmentChange = { assignee: unknown; userId: string | null };

/** Track the actor of the assignment transaction, never the last typing socket.
 * Initial/offline sync can contain other people's edits, so its actor is unknown.
 * Text-only transactions do not scan or project the document.
 */
export function trackAssignmentChanges(
	doc: Y.Doc,
	actorForOrigin: (origin: unknown) => string | null,
) {
	const pending = new Map<string, AssignmentChange>();
	doc.getXmlFragment(PAGE_BODY_FRAGMENT).observeDeep((events, transaction) => {
		const record = (node: Y.XmlElement) => {
			if (node.nodeName !== "task") return;
			const parent = node.parent;
			if (!(parent instanceof Y.XmlElement)) return;
			const id = parent.getAttribute("id");
			if (typeof id !== "string") return;
			pending.set(id, {
				assignee: node.getAttribute("assignee"),
				userId: actorForOrigin(transaction.origin),
			});
		};
		const visit = (node: unknown) => {
			if (!(node instanceof Y.XmlElement)) return;
			record(node);
			for (const child of node.toArray()) visit(child);
		};
		for (const event of events) {
			if (!(event instanceof Y.YXmlEvent)) continue;
			if (
				event.target instanceof Y.XmlElement &&
				event.attributesChanged.has("assignee")
			)
				record(event.target);
			for (const change of event.changes.delta) {
				if (Array.isArray(change.insert))
					for (const child of change.insert) visit(child);
			}
		}
	});
	return {
		capture: () => new Map(pending),
		acknowledge(captured: ReadonlyMap<string, AssignmentChange>) {
			for (const [key, value] of captured)
				if (pending.get(key) === value) pending.delete(key);
		},
	};
}

import { z } from "zod";
import { ContextPageSchema, type ContextPage } from "./schemas";

export type CurrentPageContext = {
	workspaceId: string;
	workspaceName: string;
	pageId: string;
	title: string;
	url: string;
	source: string;
	editorStatus: "opening" | "ready" | "unavailable";
	saveStatus: "unknown" | "saved" | "unsaved";
};
export type ContextSnapshot = {
	content: Array<{ type: "text"; text: string }>;
	structuredContent: {
		haunterView: CurrentPageContext | null;
		haunterPage: ContextPage | null;
	};
};
type Attachment = { text: string; page: ContextPage };
const ATTACHMENT_LABEL = "Explicit Haunter attachment (fixed snapshot):\n";
const HostContextSchema = z.object({
	updateId: z.string(),
	content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
	structuredContent: z
		.object({ haunterPage: ContextPageSchema.nullish() })
		.optional(),
});

/** One host context slot contains both the current view and a fixed attachment. */
export function createCompanionContext(options: {
	canUseContext(): boolean;
	setContext(snapshot: ContextSnapshot): Promise<{ updateId: string } | void>;
	changed(): void;
}) {
	let view: CurrentPageContext | undefined;
	let attachment: Attachment | undefined;
	let error = false;
	let disposed = false;
	let lastSent = "";
	let pending = 0;
	let queue = Promise.resolve();
	const ownUpdates = new Set<string>();
	const sentContent = new Set<string>();
	let lastHostUpdate: string | null | undefined;
	let hostRevision = 0;
	function remember(set: Set<string>, value: string) {
		set.add(value);
		if (set.size > 100) set.delete(set.values().next().value as string);
	}
	function snapshot(): ContextSnapshot {
		return {
			content: [
				{
					type: "text",
					text: view
						? [
								"Current Haunter view (automatic metadata; no page body):",
								JSON.stringify(view),
								"Use this page for references such as ‘this page’. Read its source or call read_page for the latest saved content; unsaved edits are not included.",
							].join("\n")
						: "No Haunter page is currently open in this panel.",
				},
				...(attachment
					? [
							{
								type: "text" as const,
								text: ATTACHMENT_LABEL + attachment.text,
							},
						]
					: []),
			],
			structuredContent: {
				haunterView: view ?? null,
				haunterPage: attachment?.page ?? null,
			},
		};
	}
	function publish() {
		if (disposed || !options.canUseContext()) return Promise.resolve();
		pending++;
		// Read the latest state when this write runs. A slow acknowledgement must
		// never let an older navigation overwrite a newer page or attachment.
		const result = queue
			.catch(() => {})
			.then(async () => {
				if (disposed) return;
				const next = snapshot();
				const signature = JSON.stringify(next);
				if (signature === lastSent) return;
				const revision = hostRevision;
				remember(sentContent, JSON.stringify(next.content));
				try {
					const receipt = await options.setContext(next);
					if (receipt) {
						remember(ownUpdates, receipt.updateId);
						if (revision === hostRevision) lastHostUpdate = receipt.updateId;
					}
					lastSent = revision === hostRevision ? signature : "";
					error = false;
				} catch (cause) {
					error = true;
					throw cause;
				} finally {
					options.changed();
				}
			});
		queue = result.finally(() => {
			pending--;
		});
		return queue;
	}
	return {
		get attachment() {
			return attachment?.page;
		},
		get error() {
			return error;
		},
		setView(next?: CurrentPageContext) {
			view = next;
			void publish().catch(() => {});
		},
		async attach(text: string, page: ContextPage) {
			const previous = attachment;
			const next = { text, page };
			attachment = next;
			try {
				await publish();
			} catch (cause) {
				if (attachment === next) attachment = previous;
				throw cause;
			}
		},
		async removeAttachment() {
			const previous = attachment;
			const revision = hostRevision;
			attachment = undefined;
			try {
				await publish();
			} catch (cause) {
				if (revision === hostRevision) attachment = previous;
				throw cause;
			}
		},
		async clearView() {
			view = undefined;
			await publish();
		},
		sync(current: unknown) {
			if (current === undefined) return;
			if (current === null) {
				if (lastHostUpdate === null) return;
				lastHostUpdate = null;
				hostRevision++;
				attachment = undefined;
				lastSent = "";
				// If removal races a pending write, follow it with metadata only.
				if (pending) void publish().catch(() => {});
				options.changed();
				return;
			}
			const parsed = HostContextSchema.safeParse(current);
			if (!parsed.success || parsed.data.updateId === lastHostUpdate) return;
			lastHostUpdate = parsed.data.updateId;
			if (
				ownUpdates.has(parsed.data.updateId) ||
				sentContent.has(JSON.stringify(parsed.data.content))
			)
				return;
			const page = parsed.data.structuredContent?.haunterPage;
			const text = parsed.data.content
				.find((item) => item.text.startsWith(ATTACHMENT_LABEL))
				?.text.slice(ATTACHMENT_LABEL.length);
			hostRevision++;
			attachment = page && text ? { page, text } : undefined;
			options.changed();
		},
		dispose() {
			disposed = true;
		},
	};
}

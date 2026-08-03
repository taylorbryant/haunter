import {
	BlockNoteSchema,
	createBlockSpec,
	createInlineContentSpec,
	defaultBlockSpecs,
	defaultInlineContentSpecs,
} from "@blocknote/core";
import { AUTO_TASK_ASSIGNEE } from "@/features/tasks/lib/task-block-props";

function renderBlock(content: "inline" | "none") {
	const dom = document.createElement("div");
	if (content === "none") return { dom };
	const contentDOM = document.createElement("span");
	dom.append(contentDOM);
	return { dom, contentDOM };
}

// Server-only structural counterparts to Haunter's React block specs. Yjs
// conversion needs matching type/prop/content definitions, not browser UI.
const task = createBlockSpec(
	{
		type: "task",
		propSchema: {
			checked: { default: false },
			due: { default: "" },
			dueTime: { default: "" },
			reminder: { default: "" },
			assignee: { default: AUTO_TASK_ASSIGNEE },
		},
		content: "inline",
	},
	{ render: () => renderBlock("inline") },
)();

const canvas = createBlockSpec(
	{
		type: "canvas",
		propSchema: { canvasId: { default: "" } },
		content: "none",
	},
	{ render: () => renderBlock("none") },
)();

const pageLink = createBlockSpec(
	{
		type: "pageLink",
		propSchema: {
			pageId: { default: "" },
			workspaceId: { default: "" },
		},
		content: "none",
	},
	{ render: () => renderBlock("none") },
)();

const callout = createBlockSpec(
	{
		type: "callout",
		propSchema: {
			emoji: { default: "💡" },
			color: { default: "default" },
		},
		content: "inline",
	},
	{ render: () => renderBlock("inline") },
)();

const divider = createBlockSpec(
	{ type: "divider", propSchema: {}, content: "none" },
	{ render: () => renderBlock("none") },
)();

const mention = createInlineContentSpec(
	{
		type: "mention",
		propSchema: {
			pageId: { default: "" },
			workspaceId: { default: "" },
		},
		content: "none",
	},
	{
		render: () => ({ dom: document.createElement("span") }),
	},
);

export const serverPageSchema = BlockNoteSchema.create({
	blockSpecs: {
		...defaultBlockSpecs,
		task,
		canvas,
		pageLink,
		callout,
		divider,
	},
	inlineContentSpecs: {
		...defaultInlineContentSpecs,
		mention,
	},
});

"use client";

import { createExtension } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { Separator } from "@/components/ui/separator";

export const dividerBlockSpec = createReactBlockSpec(
	{
		type: "divider",
		propSchema: {},
		content: "none",
	},
	{
		render: () => (
			<div contentEditable={false} className="w-full py-1.5">
				<Separator />
			</div>
		),
	},
	// Markdown-style shortcut: "---" (or "***") at the start of a block becomes
	// a divider. Include em/en-dash forms in case smart typography rewrites the
	// hyphens as they are typed.
	[
		createExtension({
			key: "divider-shortcuts",
			inputRules: [
				{
					find: /^(?:---|\*\*\*|—-|–-)$/,
					replace() {
						return { type: "divider" };
					},
				},
			],
		}),
	],
);

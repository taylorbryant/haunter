"use client";

import { Button } from "@/components/ui/button";
import type { useRecoveryCopyActions } from "../client/use-recovery-copy-actions";

export function RecoveryCopyActions({
	generation,
	actions,
	canCreate = true,
}: {
	generation: number;
	actions: ReturnType<typeof useRecoveryCopyActions>;
	canCreate?: boolean;
}) {
	const activeKind =
		actions.activeAction?.generation === generation
			? actions.activeAction.kind
			: null;
	return (
		<div className="space-y-2">
			{actions.error?.generation === generation ? (
				<p role="alert" className="text-destructive text-sm">
					{actions.error.message}
				</p>
			) : null}
			<div className="flex flex-wrap gap-2">
				{canCreate ? (
					<Button
						disabled={actions.working}
						onClick={() => void actions.open(generation)}
					>
						{activeKind === "open" ? "Opening…" : "Open as a new page"}
					</Button>
				) : null}
				<Button
					variant="ghost"
					disabled={actions.working}
					onClick={() => void actions.download(generation)}
				>
					{activeKind === "download" ? "Downloading…" : "Download copy"}
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				Your current page will stay as it is.
			</p>
		</div>
	);
}

"use client";

import { HistoryIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { PageDocumentSession } from "../client/session";
import {
	dismissDocumentRecoveryCopies,
	type LocalRecoveryCopy,
} from "../client/local-store";
import { usePageRecoveries } from "../client/page-recoveries";

const PageHistoryDialog = dynamic(
	() =>
		import("@/features/pages/components/page-history-dialog").then(
			(mod) => mod.PageHistoryDialog,
		),
	{ ssr: false },
);

export function PageRecoveryNotice({
	session,
	onDismissed,
}: {
	session: PageDocumentSession;
	onDismissed: () => void;
}) {
	const { copies, error, retry } = usePageRecoveries(session.options);
	const [reviewing, setReviewing] = useState<number | null>(null);
	const pending = copies.filter(
		(copy) => copy.syncStatus !== "saved" && !copy.dismissed,
	);
	return (
		<>
			<DocumentRecoveryNotice
				copy={pending[0] ?? null}
				readFailure={error ? { message: error, retry } : null}
				onReview={(generation) => setReviewing(generation)}
				onDismiss={async () => {
					await dismissDocumentRecoveryCopies(session.identity.key, pending);
					onDismissed();
					toast.add({ title: "Copy kept in History", type: "success" });
				}}
			/>
			{reviewing !== null ? (
				<PageHistoryDialog
					pageId={session.options.pageId}
					workspaceId={session.options.workspaceId}
					initialRecovery={reviewing}
					onOpenChange={(open) => {
						if (!open) setReviewing(null);
					}}
				/>
			) : null}
		</>
	);
}

export function DocumentRecoveryNotice({
	copy,
	readFailure,
	onReview,
	onDismiss,
}: {
	copy: Pick<
		LocalRecoveryCopy,
		"generation" | "syncStatus" | "dismissed"
	> | null;
	readFailure?: { message: string; retry: () => void } | null;
	onReview: (generation: number) => void;
	onDismiss: () => Promise<void>;
}) {
	const [error, setError] = useState<string | null>(null);
	const [dismissing, setDismissing] = useState(false);
	const inFlight = useRef(false);
	const pendingCopy =
		copy && copy.syncStatus !== "saved" && !copy.dismissed ? copy : null;
	if (!pendingCopy && !readFailure) return null;
	return (
		<div className="mb-4 flex gap-3 rounded-lg bg-muted/50 p-3 text-sm md:mx-[54px]">
			<HistoryIcon
				aria-hidden="true"
				className="mt-0.5 size-4 shrink-0 text-muted-foreground"
			/>
			<div className="min-w-0 flex-1">
				{pendingCopy ? (
					<>
						<p role="status">Earlier edits are saved on this device.</p>
						<div className="-ml-2 mt-1 flex flex-wrap gap-1">
							<Button
								variant="ghost"
								size="sm"
								className="text-primary"
								onClick={() => onReview(pendingCopy.generation)}
							>
								Review copy
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={dismissing}
								onClick={async () => {
									if (inFlight.current) return;
									inFlight.current = true;
									setDismissing(true);
									setError(null);
									try {
										await onDismiss();
									} catch {
										setError(
											"The notice could not be dismissed. Your copies are still available.",
										);
									} finally {
										inFlight.current = false;
										setDismissing(false);
									}
								}}
							>
								Dismiss
							</Button>
						</div>
					</>
				) : null}
				{readFailure ? (
					<div className={pendingCopy ? "mt-2" : undefined}>
						<p role="alert" className="text-destructive">
							{readFailure.message}
						</p>
						<Button
							variant="ghost"
							size="sm"
							className="-ml-2 mt-1"
							onClick={readFailure.retry}
						>
							Try again
						</Button>
					</div>
				) : null}
				{error ? (
					<p role="alert" className="mt-2 text-destructive">
						{error}
					</p>
				) : null}
			</div>
		</div>
	);
}

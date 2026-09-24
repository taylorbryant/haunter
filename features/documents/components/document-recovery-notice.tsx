"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DocumentSnapshot, PageDocumentSession } from "../client/session";

export function DocumentRecoveryNotice({
	snapshot,
	session,
}: {
	snapshot: Pick<
		DocumentSnapshot,
		"recoveries" | "resetReason" | "recoveryNoticeDismissed"
	>;
	session: Pick<
		PageDocumentSession,
		"dismissRecoveryNotice" | "recoveryDownload"
	>;
}) {
	const [expanded, setExpanded] = useState(false);
	const [selected, setSelected] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [dismissing, setDismissing] = useState(false);
	if (!snapshot.recoveries.length) return null;
	if (snapshot.recoveryNoticeDismissed && !expanded)
		return (
			<div className="mb-3 md:mx-[54px]">
				<Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
					Previous copies ({snapshot.recoveries.length})
				</Button>
			</div>
		);
	const generation =
		selected !== null && snapshot.recoveries.includes(selected)
			? selected
			: snapshot.recoveries[0];
	return (
		<div
			role="status"
			className="mb-3 rounded-lg border p-3 text-sm md:mx-[54px]"
		>
			<p>
				{snapshot.resetReason === "replacement"
					? "This page’s content was replaced."
					: snapshot.resetReason === "restore"
						? "This page was restored."
						: "An earlier copy of this page is available."}{" "}
				Previous copies, including any edits that hadn’t synced, are kept in
				this browser. Download a copy, then use Recover drafts in the Pages menu
				to open it as a new page.
			</p>
			{snapshot.recoveries.length > 1 ? (
				<label className="mt-2 flex items-center gap-2">
					Recovery copy
					<select
						className="rounded-md border bg-background p-1"
						value={generation}
						onChange={(event) => setSelected(Number(event.target.value))}
					>
						{snapshot.recoveries.map((item) => (
							<option key={item} value={item}>
								Previous copy {item + 1}
							</option>
						))}
					</select>
				</label>
			) : null}
			<div className="mt-2 flex flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => {
						setError(null);
						void session
							.recoveryDownload(generation)
							.then((file) => {
								const url = URL.createObjectURL(
									new Blob([file], { type: "application/json" }),
								);
								const link = document.createElement("a");
								link.href = url;
								link.download = "haunter-previous-copy.json";
								link.hidden = true;
								document.body.append(link);
								link.click();
								link.remove();
								setTimeout(() => URL.revokeObjectURL(url), 1000);
							})
							.catch(() =>
								setError(
									"The recovery copy could not be downloaded. Keep this tab open and try again.",
								),
							);
					}}
				>
					Download previous copy
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={dismissing}
					onClick={() => {
						setError(null);
						setDismissing(true);
						void session
							.dismissRecoveryNotice()
							.then(() => setExpanded(false))
							.catch(() =>
								setError(
									"The notice could not be dismissed. Your previous copies are still available.",
								),
							)
							.finally(() => setDismissing(false));
					}}
				>
					Dismiss notice
				</Button>
			</div>
			{error ? (
				<p role="alert" className="mt-2 text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}

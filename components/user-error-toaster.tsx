"use client";

import { useEffect, useState } from "react";
import { subscribeUserErrors } from "@/client/error-feedback";

const ERROR_DISPLAY_MS = 8000;

export function UserErrorToaster() {
	const [error, setError] = useState<{ id: number; message: string } | null>(
		null,
	);

	useEffect(
		() =>
			subscribeUserErrors((message) => {
				setError({ id: Date.now(), message });
			}),
		[],
	);

	useEffect(() => {
		if (!error) return;
		const timeout = setTimeout(() => setError(null), ERROR_DISPLAY_MS);
		return () => clearTimeout(timeout);
	}, [error]);

	if (!error) return null;

	return (
		<div
			key={error.id}
			role="alert"
			className="fixed right-4 bottom-4 z-[100] flex max-w-sm items-start gap-3 rounded-lg border border-destructive/30 bg-background px-4 py-3 text-sm shadow-lg"
		>
			<p className="min-w-0 flex-1">{error.message}</p>
			<button
				type="button"
				className="keyboard-focus-ring -mr-1 rounded px-1 text-muted-foreground hover:text-foreground"
				aria-label="Dismiss error"
				onClick={() => setError(null)}
			>
				<span aria-hidden>×</span>
			</button>
		</div>
	);
}

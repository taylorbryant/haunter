"use client";

import { useEffect, useState } from "react";

/** Brief socket renewals should not interrupt editing with an offline warning. */
export function useCanvasConnectionWarning(connected: boolean) {
	const [elapsed, setElapsed] = useState(false);

	useEffect(() => {
		setElapsed(false);
		if (connected) return;
		const timer = setTimeout(() => setElapsed(true), 5000);
		return () => clearTimeout(timer);
	}, [connected]);

	// Keep the transport's real status intact; only delay the explanatory banner.
	return !connected && elapsed;
}

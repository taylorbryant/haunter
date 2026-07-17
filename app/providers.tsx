"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { makeQueryClient } from "@/client";
import { UserErrorToaster } from "@/components/user-error-toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

function useKeyboardFocusModality() {
	useEffect(() => {
		const root = document.documentElement;
		const enableKeyboardFocus = (event: KeyboardEvent) => {
			if (event.key === "Tab") {
				root.dataset.keyboardNav = "true";
			}
		};
		const disableKeyboardFocus = () => {
			delete root.dataset.keyboardNav;
		};

		window.addEventListener("keydown", enableKeyboardFocus, true);
		window.addEventListener("pointerdown", disableKeyboardFocus, true);
		window.addEventListener("mousedown", disableKeyboardFocus, true);
		window.addEventListener("touchstart", disableKeyboardFocus, true);

		return () => {
			window.removeEventListener("keydown", enableKeyboardFocus, true);
			window.removeEventListener("pointerdown", disableKeyboardFocus, true);
			window.removeEventListener("mousedown", disableKeyboardFocus, true);
			window.removeEventListener("touchstart", disableKeyboardFocus, true);
		};
	}, []);
}

export function Providers({ children }: { children: ReactNode }) {
	const [queryClient] = useState(() => makeQueryClient());
	useKeyboardFocusModality();

	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				{children}
				<UserErrorToaster />
			</TooltipProvider>
		</QueryClientProvider>
	);
}

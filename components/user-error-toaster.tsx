"use client";

import { useEffect } from "react";
import { subscribeUserErrors } from "@/client/error-feedback";
import { toast } from "@/components/ui/toast";

const ERROR_DISPLAY_MS = 8000;

export function UserErrorToaster() {
	useEffect(
		() =>
			subscribeUserErrors((message) => {
				toast.add({
					title: message,
					type: "error",
					timeout: ERROR_DISPLAY_MS,
					priority: "high",
				});
			}),
		[],
	);

	return null;
}

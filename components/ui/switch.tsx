"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

function Switch({
	className,
	...props
}: SwitchPrimitive.Root.Props & { className?: string }) {
	return (
		<SwitchPrimitive.Root
			nativeButton
			render={<button type="button" />}
			className={cn(
				"flex h-5 w-9 shrink-0 rounded-full border border-transparent bg-input p-0.5 transition-colors outline-none data-checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb className="size-3.5 rounded-full bg-background shadow-xs transition-transform data-checked:translate-x-4" />
		</SwitchPrimitive.Root>
	);
}

export { Switch };

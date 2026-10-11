import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared layout for workspace destinations in the web and embedded app. */
export function WorkspaceScreen({
	className,
	...props
}: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10",
				className,
			)}
			{...props}
		/>
	);
}

export function WorkspaceScreenHeader({
	title,
	description,
	actions,
}: {
	title: string;
	description?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div className="flex min-w-0 flex-col gap-1">
				<h1 className="text-balance font-heading font-semibold text-xl">
					{title}
				</h1>
				{description ? (
					<div className="text-pretty text-base text-muted-foreground leading-6 sm:text-sm">
						{description}
					</div>
				) : null}
			</div>
			{actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
		</header>
	);
}

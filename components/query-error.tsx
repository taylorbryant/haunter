import { Button } from "@/components/ui/button";

export function QueryError({
	message,
	onRetry,
	retrying = false,
}: {
	message: string;
	onRetry: () => void;
	retrying?: boolean;
}) {
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
			<p role="alert" className="text-base text-muted-foreground sm:text-sm">
				{message}
			</p>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={retrying}
				onClick={onRetry}
			>
				Try again
			</Button>
		</div>
	);
}

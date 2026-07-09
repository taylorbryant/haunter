import { Skeleton } from "@/components/ui/skeleton";

export function EditorBodySkeleton() {
	return (
		<div className="flex flex-col gap-3 px-0 md:px-[54px]" aria-hidden>
			<Skeleton className="h-4 w-11/12" />
			<Skeleton className="h-4 w-4/5" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="mt-5 h-4 w-3/4" />
			<Skeleton className="h-4 w-5/6" />
			<Skeleton className="h-4 w-2/5" />
		</div>
	);
}

export function PageEditorSkeleton() {
	return (
		<div
			className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10"
			aria-hidden
		>
			<div className="mb-3 px-0 md:px-[54px]">
				<Skeleton className="size-10 rounded-lg" />
			</div>
			<div className="mb-6 px-0 md:px-[54px]">
				<Skeleton className="h-9 w-1/2 max-w-xs" />
			</div>
			<EditorBodySkeleton />
		</div>
	);
}

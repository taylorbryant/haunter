"use client";

import {
	lazy,
	Suspense,
	useLayoutEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import {
	type PageTitleFieldProps,
	resizeTitleTextarea,
} from "./page-title-shared";

// The editable field carries the durable-draft layer (state machine and
// IndexedDB). Load it after hydration so the page route's first paint does
// not, and show the title read-only until it arrives.
const EditablePageTitleField = lazy(() =>
	import("./editable-page-title-field").then((module) => ({
		default: module.EditablePageTitleField,
	})),
);

const subscribeToNothing = () => () => {};
function useHydrated() {
	return useSyncExternalStore(
		subscribeToNothing,
		() => true,
		() => false,
	);
}

function ReadOnlyPageTitleField({ title }: { title: string }) {
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	useLayoutEffect(() => resizeTitleTextarea(inputRef.current));
	return (
		<textarea
			ref={inputRef}
			className="block max-h-none min-h-[2.25rem] w-full resize-none overflow-hidden rounded-md border-none bg-transparent font-bold text-3xl leading-tight outline-none placeholder:text-muted-foreground/60"
			value={title}
			placeholder="Untitled"
			readOnly
			rows={1}
			wrap="soft"
			aria-label="Page title"
		/>
	);
}

export function PageTitleField(props: PageTitleFieldProps) {
	const hydrated = useHydrated();
	if (props.readOnly || !props.currentUserId || !hydrated) {
		return <ReadOnlyPageTitleField title={props.page.title} />;
	}
	return (
		<Suspense fallback={<ReadOnlyPageTitleField title={props.page.title} />}>
			<EditablePageTitleField {...props} />
		</Suspense>
	);
}

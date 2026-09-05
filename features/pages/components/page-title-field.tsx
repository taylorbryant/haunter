"use client";

import { ContractError } from "@beignet/core/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	type KeyboardEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useDurableDraftStorage } from "@/client/durable-draft-storage-provider";
import { DurableDraftController } from "@/client/durable-drafts";
import { userErrorMessage } from "@/client/error-feedback";
import { localDraftKey } from "@/client/local-drafts";
import { Button } from "@/components/ui/button";
import {
	consumeTitleFocus,
	releaseTitleKeyboardPrime,
} from "@/features/pages/client/new-page-focus";
import {
	getPageQueryOptions,
	invalidatePage,
	invalidatePages,
	setPageTitleInCache,
	updatePageMutationOptions,
} from "@/features/pages/client/queries";
import { registerPageSaveFlusher } from "@/features/pages/client/save-state";
import {
	PAGE_TITLE_MAX_LENGTH,
	PAGE_TITLE_TOO_LONG_MESSAGE,
} from "@/features/pages/schemas";

const TITLE_SAVE_DELAY_MS = 500;

type PageTitleFieldProps = {
	page: {
		id: string;
		workspaceId: string;
		title: string;
		updatedAt: string;
	};
	currentUserId: string | null;
	readOnly: boolean;
	onFocusEditor(): void;
};

function normalizeTitleInput(value: string) {
	return value.replace(/[\r\n]+/g, " ");
}

function resizeTitleTextarea(textarea: HTMLTextAreaElement | null) {
	if (!textarea) return;
	textarea.style.height = "0px";
	textarea.style.height = `${textarea.scrollHeight}px`;
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
	if (props.readOnly || !props.currentUserId) {
		return <ReadOnlyPageTitleField title={props.page.title} />;
	}
	return <EditablePageTitleField {...props} />;
}

function EditablePageTitleField({
	page,
	currentUserId,
	readOnly,
	onFocusEditor,
}: PageTitleFieldProps) {
	const queryClient = useQueryClient();
	const storage = useDurableDraftStorage<string>();
	const updatePageMutation = useMutation({
		...updatePageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
	const lifecycleGeneration = useRef(0);
	const [controller] = useState(
		() =>
			new DurableDraftController<string, { updatedAt: string }>({
				identity: {
					key: localDraftKey(
						currentUserId ?? "anonymous",
						"page-title",
						page.id,
					),
					userId: currentUserId ?? "anonymous",
					workspaceId: page.workspaceId,
					resourceType: "page-title",
					resourceId: page.id,
				},
				serverValue: page.title,
				// A body save also advances page.updatedAt. The title value itself is
				// therefore the title-specific comparison token.
				serverVersion: page.title,
				storage,
				debounceMs: TITLE_SAVE_DELAY_MS,
				isPayload: (value): value is string => typeof value === "string",
				areValuesEqual: (left, right) => left === right,
				isStoredDraftResumable: (stored, serverTitle) =>
					stored.status === "unsaved" &&
					(stored.baseVersion === serverTitle ||
						stored.payload === serverTitle ||
						// Compatibility with recovery copies written before title-specific
						// versioning was introduced.
						stored.baseVersion === page.updatedAt),
				validate: (value) =>
					value.length > PAGE_TITLE_MAX_LENGTH
						? PAGE_TITLE_TOO_LONG_MESSAGE
						: null,
				isConflictError: (error) =>
					error instanceof ContractError && error.status === 409,
				loadServer: async () => {
					const latest = await queryClient.fetchQuery({
						...getPageQueryOptions(page.id),
						staleTime: 0,
					});
					return { value: latest.title, version: latest.title };
				},
				onServerSaved: (result) => {
					setPageTitleInCache(
						queryClient,
						page.id,
						result.value,
						result.metadata?.updatedAt,
					);
					void Promise.all([
						invalidatePage(queryClient, page.id),
						invalidatePages(queryClient),
					]);
				},
				saveServer: async ({ value, baseVersion }) => {
					const result = await updatePageMutation.mutateAsync({
						path: { id: page.id },
						body: {
							title: value,
							...(baseVersion !== null ? { baseTitle: baseVersion } : {}),
						},
					});
					return {
						value: result.title,
						version: result.title,
						metadata: { updatedAt: result.updatedAt },
					};
				},
			}),
	);
	const draft = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);

	useEffect(() => {
		const generation = ++lifecycleGeneration.current;
		controller.start();
		const unregisterFlusher = registerPageSaveFlusher(page.id, () =>
			controller.flushServer(),
		);
		return () => {
			unregisterFlusher();
			void controller.flushLocal().catch(() => undefined);
			queueMicrotask(() => {
				if (lifecycleGeneration.current !== generation) return;
				void controller.flushServer().finally(() => {
					if (lifecycleGeneration.current === generation) controller.stop();
				});
			});
		};
	}, [controller, page.id]);

	useEffect(() => {
		controller.refreshServer(page.title, page.title);
	}, [controller, page.title]);

	useEffect(() => {
		if (!consumeTitleFocus(page.id)) return;
		const input = titleInputRef.current;
		if (!input) return;
		input.focus({ preventScroll: true });
		input.setSelectionRange(input.value.length, input.value.length);
		releaseTitleKeyboardPrime();
	}, [page.id]);

	useLayoutEffect(() => {
		resizeTitleTextarea(titleInputRef.current);
	});

	function handleTitleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key !== "Enter") return;
		event.preventDefault();
		if (
			event.shiftKey ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			readOnly
		) {
			return;
		}
		onFocusEditor();
	}

	const errorMessage =
		draft.validationError ??
		(draft.status === "storage-error"
			? "The page title could not be saved in this browser. Keep this tab open and try again."
			: draft.status === "sync-error"
				? userErrorMessage(
						draft.error,
						"Your title is saved in this browser and will sync when the connection returns.",
					)
				: null);
	const busy =
		draft.status === "syncing" ||
		draft.status === "saving-local" ||
		draft.status === "resolving";

	return (
		<>
			<textarea
				ref={titleInputRef}
				className="keyboard-focus-ring block max-h-none min-h-[2.25rem] w-full resize-none overflow-hidden rounded-md border-none bg-transparent font-bold text-3xl leading-tight outline-none placeholder:text-muted-foreground/60"
				value={draft.value}
				placeholder="Untitled"
				readOnly={readOnly || draft.status === "loading"}
				maxLength={PAGE_TITLE_MAX_LENGTH}
				rows={1}
				wrap="soft"
				onChange={(event) => {
					controller.edit(normalizeTitleInput(event.target.value));
					resizeTitleTextarea(event.currentTarget);
				}}
				onKeyDown={handleTitleKeyDown}
				aria-label="Page title"
				aria-invalid={errorMessage ? true : undefined}
				aria-describedby={errorMessage ? "page-title-error" : undefined}
			/>
			{draft.status === "conflict" || draft.status === "resolving" ? (
				<div
					role="alert"
					className="mt-2 flex flex-wrap items-center gap-2 text-destructive text-sm"
				>
					<span className="min-w-0 flex-1">
						This title changed elsewhere. Your version is still here; the latest
						title is “{draft.serverValue || "Untitled"}”.
						{draft.error ? (
							<span className="mt-1 block">
								{userErrorMessage(
									draft.error,
									"The latest title could not be selected. Try again.",
								)}
							</span>
						) : null}
					</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => controller.keepMine()}
					>
						Keep my title
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => void controller.useServer()}
					>
						Use latest title
					</Button>
				</div>
			) : errorMessage ? (
				<div
					id="page-title-error"
					role="alert"
					className="mt-2 flex items-center gap-2 text-destructive text-sm"
				>
					<span className="flex-1">{errorMessage}</span>
					{draft.status === "storage-error" || draft.status === "sync-error" ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							onClick={() => controller.retry()}
						>
							Retry
						</Button>
					) : null}
				</div>
			) : null}
		</>
	);
}

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileTextIcon, InboxIcon, ListTodoIcon } from "lucide-react";
import {
	createContext,
	type FormEvent,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { userErrorMessage } from "@/client/error-feedback";
import { useCommand } from "@/components/command-palette/registry";
import { DueDatePicker, type DueDateValue } from "@/components/due-date-picker";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	captureInboxItemMutationOptions,
	invalidateInboxItems,
} from "@/features/inbox/client/queries";
import {
	INBOX_NOTE_DETAILS_MAX_LENGTH,
	type InboxItem,
} from "@/features/inbox/schemas";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	invalidatePageNavigation,
	invalidatePages,
} from "@/features/pages/client/queries";
import { PAGE_TITLE_MAX_LENGTH } from "@/features/pages/schemas";
import { invalidateTasks } from "@/features/tasks/client/queries";
import { parseTaskInput } from "@/features/tasks/lib/parse-task-input";
import { TASK_TITLE_MAX_LENGTH } from "@/features/tasks/schemas";

type CaptureKind = "page" | "task";

type CaptureContextValue = {
	openCapture: (kind?: CaptureKind) => void;
};

const CaptureContext = createContext<CaptureContextValue | null>(null);

export function useCapture() {
	const context = useContext(CaptureContext);
	if (!context) {
		throw new Error("useCapture must be used within CaptureProvider");
	}
	return context;
}

function CaptureDialog({
	open,
	onOpenChange,
	workspaceId,
	initialKind,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string;
	initialKind: CaptureKind;
}) {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		...captureInboxItemMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [kind, setKind] = useState<CaptureKind>(initialKind);
	const [title, setTitle] = useState("");
	const [details, setDetails] = useState("");
	const [manualDue, setManualDue] = useState<DueDateValue | undefined>();
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setKind(initialKind);
		setTitle("");
		setDetails("");
		setManualDue(undefined);
		setError(null);
	}, [initialKind, open]);

	const parsedTask = parseTaskInput(title);
	const taskTitle = parsedTask.match ? parsedTask.title : title.trim();
	const dueDate =
		manualDue !== undefined ? manualDue.date : (parsedTask.dueDate ?? null);
	const dueTime =
		manualDue !== undefined ? manualDue.time : (parsedTask.dueTime ?? null);
	const normalizedTitle = kind === "task" ? taskTitle : title.trim();

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!normalizedTitle || mutation.isPending) return;
		setError(null);

		try {
			let created: InboxItem;
			if (kind === "page") {
				created = await mutation.mutateAsync({
					body: {
						workspaceId,
						kind,
						title: normalizedTitle,
						...(details.trim() ? { details: details.trim() } : {}),
					},
				});
			} else {
				created = await mutation.mutateAsync({
					body: {
						workspaceId,
						kind,
						title: normalizedTitle,
						...(dueDate ? { dueDate } : {}),
						...(dueDate && dueTime ? { dueTime } : {}),
					},
				});
			}

			await Promise.all([
				invalidateInboxItems(queryClient),
				created.kind === "page"
					? invalidatePages(queryClient)
					: invalidateTasks(queryClient),
				created.kind === "page"
					? invalidatePageNavigation(queryClient, workspaceId)
					: Promise.resolve(),
			]);
			onOpenChange(false);
		} catch (captureError) {
			setError(
				userErrorMessage(
					captureError,
					kind === "page"
						? "The note could not be captured."
						: "The task could not be captured.",
				),
			);
		}
	}

	return (
		<ResponsiveDialog
			open={open}
			onOpenChange={(next) => {
				if (!mutation.isPending) onOpenChange(next);
			}}
			title="Quick capture"
			description="Save a note or task to your personal Inbox."
			className="sm:max-w-md"
		>
			<form className="flex flex-col gap-5" onSubmit={submit}>
				<ToggleGroup
					value={[kind]}
					variant="outline"
					className="grid w-full grid-cols-2"
					onValueChange={(value) => {
						const nextKind = value.at(-1);
						if (nextKind === "page" || nextKind === "task") {
							setKind(nextKind);
							setError(null);
						}
					}}
				>
					<ToggleGroupItem value="page" className="w-full">
						<FileTextIcon data-icon="inline-start" />
						Note
					</ToggleGroupItem>
					<ToggleGroupItem value="task" className="w-full">
						<ListTodoIcon data-icon="inline-start" />
						Task
					</ToggleGroupItem>
				</ToggleGroup>

				<FieldGroup>
					<Field data-invalid={Boolean(error)}>
						<FieldLabel htmlFor="capture-title">
							{kind === "page" ? "Title" : "Task"}
						</FieldLabel>
						<Input
							id="capture-title"
							name="title"
							autoFocus
							autoComplete="off"
							maxLength={
								kind === "page" ? PAGE_TITLE_MAX_LENGTH : TASK_TITLE_MAX_LENGTH
							}
							value={title}
							placeholder={
								kind === "page"
									? "What do you want to remember?"
									: "What needs to get done?"
							}
							aria-invalid={Boolean(error)}
							onChange={(event) => {
								setTitle(event.target.value);
								if (error) setError(null);
							}}
						/>
						{kind === "task" ? (
							<FieldDescription>
								You can include a date, such as “tomorrow at 2.”
							</FieldDescription>
						) : null}
						<FieldError>{error}</FieldError>
					</Field>

					{kind === "page" ? (
						<Field>
							<FieldLabel htmlFor="capture-details">
								Details{" "}
								<span className="text-muted-foreground">(optional)</span>
							</FieldLabel>
							<Textarea
								id="capture-details"
								name="details"
								value={details}
								maxLength={INBOX_NOTE_DETAILS_MAX_LENGTH}
								placeholder="Add a little more context…"
								className="min-h-28 resize-none"
								onChange={(event) => setDetails(event.target.value)}
							/>
						</Field>
					) : (
						<Field>
							<FieldLabel>When</FieldLabel>
							<DueDatePicker
								value={dueDate}
								time={dueTime}
								onChange={setManualDue}
								className="flex h-8 w-fit items-center gap-2 rounded-lg border border-input px-2.5 text-base hover:bg-muted sm:text-sm"
							/>
						</Field>
					)}
				</FieldGroup>

				<ResponsiveDialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={mutation.isPending}
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						disabled={!normalizedTitle || mutation.isPending}
					>
						<InboxIcon data-icon="inline-start" />
						{mutation.isPending ? "Capturing…" : "Capture"}
					</Button>
				</ResponsiveDialogFooter>
			</form>
		</ResponsiveDialog>
	);
}

export function CaptureProvider({
	workspaceId,
	children,
}: {
	workspaceId: string | null;
	children: ReactNode;
}) {
	const canEdit = useCanEditWorkspace();
	const [open, setOpen] = useState(false);
	const [initialKind, setInitialKind] = useState<CaptureKind>("page");

	const openCapture = useCallback(
		(kind: CaptureKind = "page") => {
			if (!workspaceId || !canEdit) return;
			setInitialKind(kind);
			setOpen(true);
		},
		[canEdit, workspaceId],
	);

	useCommand(
		workspaceId && canEdit
			? {
					id: "inbox.capture",
					title: "Quick capture",
					group: "Create",
					keywords: "inbox note task new add",
					icon: InboxIcon,
					weight: -10,
					run: () => openCapture(),
				}
			: null,
	);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (
				event.key.toLowerCase() === "c" &&
				event.shiftKey &&
				(event.metaKey || event.ctrlKey) &&
				workspaceId &&
				canEdit
			) {
				event.preventDefault();
				openCapture();
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [canEdit, openCapture, workspaceId]);

	const contextValue = useMemo(() => ({ openCapture }), [openCapture]);

	return (
		<CaptureContext.Provider value={contextValue}>
			{children}
			{workspaceId ? (
				<CaptureDialog
					open={open}
					onOpenChange={setOpen}
					workspaceId={workspaceId}
					initialKind={initialKind}
				/>
			) : null}
		</CaptureContext.Provider>
	);
}

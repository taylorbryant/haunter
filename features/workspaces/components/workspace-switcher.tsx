"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckIcon,
	ChevronDownIcon,
	PencilIcon,
	PlusIcon,
	SmilePlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GhostLogo } from "@/components/ghost-logo";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	EmojiPicker,
	EmojiPickerContent,
	EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
	createWorkspaceMutationOptions,
	deleteWorkspaceMutationOptions,
	invalidateWorkspaces,
	listWorkspacesQueryOptions,
	updateWorkspaceMutationOptions,
} from "@/features/workspaces/client/queries";

export function WorkspaceSwitcher({
	activeWorkspaceId,
}: {
	activeWorkspaceId: string | null;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const workspacesQuery = useQuery(listWorkspacesQueryOptions());
	const createMutation = useMutation(createWorkspaceMutationOptions());
	const updateMutation = useMutation(updateWorkspaceMutationOptions());
	const deleteMutation = useMutation(deleteWorkspaceMutationOptions());

	const [dialogOpen, setDialogOpen] = useState(false);
	const [name, setName] = useState("");
	const [editOpen, setEditOpen] = useState(false);
	const [editName, setEditName] = useState("");
	const [editIcon, setEditIcon] = useState<string | null>(null);
	const [iconPickerOpen, setIconPickerOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	const workspaces = workspacesQuery.data?.items ?? [];
	const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

	function create() {
		const trimmed = name.trim();
		if (!trimmed || createMutation.isPending) return;
		createMutation.mutate(
			{ body: { name: trimmed } },
			{
				onSuccess: async (workspace) => {
					setName("");
					setDialogOpen(false);
					await invalidateWorkspaces(queryClient);
					router.push(`/w/${workspace.id}`);
				},
			},
		);
	}

	function saveEdit() {
		const trimmed = editName.trim();
		if (!active || !trimmed || updateMutation.isPending) return;
		updateMutation.mutate(
			{ path: { id: active.id }, body: { name: trimmed, icon: editIcon } },
			{
				onSuccess: async () => {
					setEditOpen(false);
					await invalidateWorkspaces(queryClient);
				},
			},
		);
	}

	function confirmDelete() {
		if (!active || deleteMutation.isPending) return;
		const deletedId = active.id;
		deleteMutation.mutate(
			{ path: { id: deletedId } },
			{
				onSuccess: async () => {
					setDeleteOpen(false);
					await invalidateWorkspaces(queryClient);
					// Leaving the deleted workspace: go to another one, or to the
					// home route (its empty state) if that was the last workspace.
					const next = workspaces.find((w) => w.id !== deletedId);
					router.push(next ? `/w/${next.id}` : "/");
					router.refresh();
				},
			},
		);
	}

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton className="w-fit px-1.5 font-medium">
							<GhostLogo className="size-4 shrink-0" />
							<span className="truncate">
								{active
									? `${active.icon ? `${active.icon} ` : ""}${active.name}`
									: "Haunter"}
							</span>
							<ChevronDownIcon className="opacity-50" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-56 rounded-lg"
						align="start"
						side="bottom"
						sideOffset={4}
						// Don't return focus to the trigger on close: it would steal
						// focus from the dialogs opened by the items below.
						onCloseAutoFocus={(event) => event.preventDefault()}
					>
						<DropdownMenuLabel className="text-muted-foreground text-xs">
							Workspaces
						</DropdownMenuLabel>
						{workspaces.map((workspace) => (
							<DropdownMenuItem
								key={workspace.id}
								onSelect={() => router.push(`/w/${workspace.id}`)}
							>
								<span className="truncate">
									{workspace.icon ? `${workspace.icon} ` : ""}
									{workspace.name}
								</span>
								{workspace.id === activeWorkspaceId ? (
									<CheckIcon className="ml-auto" />
								) : null}
							</DropdownMenuItem>
						))}
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => setDialogOpen(true)}>
							<PlusIcon />
							<span className="font-medium text-muted-foreground">
								New workspace
							</span>
						</DropdownMenuItem>
						{active ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onSelect={() => {
										setEditName(active.name);
										setEditIcon(active.icon ?? null);
										setEditOpen(true);
									}}
								>
									<PencilIcon />
									Edit workspace
								</DropdownMenuItem>
								<DropdownMenuItem
									className="text-destructive focus:text-destructive"
									onSelect={() => setDeleteOpen(true)}
								>
									<Trash2Icon className="text-destructive" />
									Delete workspace
								</DropdownMenuItem>
							</>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>

				<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
					<DialogContent className="sm:max-w-sm">
						<DialogHeader>
							<DialogTitle>New workspace</DialogTitle>
							<DialogDescription>
								Workspaces keep separate areas of your life apart, like work and
								personal.
							</DialogDescription>
						</DialogHeader>
						<form
							className="flex flex-col gap-4"
							onSubmit={(event) => {
								event.preventDefault();
								create();
							}}
						>
							<div className="flex flex-col gap-2">
								<Label htmlFor="workspace-name">Name</Label>
								<Input
									id="workspace-name"
									autoFocus
									value={name}
									placeholder="e.g. Work"
									onChange={(event) => setName(event.target.value)}
								/>
							</div>
							<DialogFooter>
								<Button
									type="submit"
									disabled={!name.trim() || createMutation.isPending}
								>
									{createMutation.isPending ? "Creating…" : "Create workspace"}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>

				<Dialog open={editOpen} onOpenChange={setEditOpen}>
					<DialogContent className="sm:max-w-sm">
						<DialogHeader>
							<DialogTitle>Edit workspace</DialogTitle>
							<DialogDescription>
								Update this workspace's emoji and name.
							</DialogDescription>
						</DialogHeader>
						<form
							className="flex flex-col gap-4"
							onSubmit={(event) => {
								event.preventDefault();
								saveEdit();
							}}
						>
							<div className="flex items-end gap-3">
								<div className="flex flex-col gap-2">
									<Label htmlFor="edit-workspace-emoji">Emoji</Label>
									<Popover
										open={iconPickerOpen}
										onOpenChange={setIconPickerOpen}
									>
										<PopoverTrigger asChild>
											<Button
												id="edit-workspace-emoji"
												type="button"
												variant="outline"
												className="size-9 p-0 text-lg leading-none"
												aria-label="Choose emoji"
											>
												{editIcon ?? (
													<SmilePlusIcon className="size-4 text-muted-foreground" />
												)}
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-auto p-0" align="start">
											<div className="flex h-[300px] w-[288px] flex-col">
												<EmojiPicker
													className="min-h-0 flex-1"
													onEmojiSelect={({ emoji }) => {
														setEditIcon(emoji);
														setIconPickerOpen(false);
													}}
												>
													<EmojiPickerSearch placeholder="Search emoji…" />
													<EmojiPickerContent />
												</EmojiPicker>
												{editIcon ? (
													<div className="border-t p-1">
														<Button
															type="button"
															variant="ghost"
															size="sm"
															className="w-full justify-start text-muted-foreground"
															onClick={() => {
																setEditIcon(null);
																setIconPickerOpen(false);
															}}
														>
															Remove emoji
														</Button>
													</div>
												) : null}
											</div>
										</PopoverContent>
									</Popover>
								</div>
								<div className="flex flex-1 flex-col gap-2">
									<Label htmlFor="edit-workspace-name">Name</Label>
									<Input
										id="edit-workspace-name"
										value={editName}
										onChange={(event) => setEditName(event.target.value)}
									/>
								</div>
							</div>
							<DialogFooter>
								<Button
									type="submit"
									disabled={!editName.trim() || updateMutation.isPending}
								>
									{updateMutation.isPending ? "Saving…" : "Save"}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>

				<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								Delete {active ? `"${active.name}"` : "workspace"}?
							</AlertDialogTitle>
							<AlertDialogDescription>
								This permanently deletes the workspace and all of its pages,
								tasks, and canvases. This can't be undone.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={(event) => {
									event.preventDefault();
									confirmDelete();
								}}
							>
								{deleteMutation.isPending ? "Deleting…" : "Delete"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

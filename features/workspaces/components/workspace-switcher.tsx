"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckIcon,
	ChevronDownIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
	const [renameOpen, setRenameOpen] = useState(false);
	const [renameName, setRenameName] = useState("");
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

	function rename() {
		const trimmed = renameName.trim();
		if (!active || !trimmed || updateMutation.isPending) return;
		updateMutation.mutate(
			{ path: { id: active.id }, body: { name: trimmed } },
			{
				onSuccess: async () => {
					setRenameOpen(false);
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
										setRenameName(active.name);
										setRenameOpen(true);
									}}
								>
									<PencilIcon />
									Rename workspace
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

				<Dialog open={renameOpen} onOpenChange={setRenameOpen}>
					<DialogContent className="sm:max-w-sm">
						<DialogHeader>
							<DialogTitle>Rename workspace</DialogTitle>
							<DialogDescription>
								Give this workspace a new name.
							</DialogDescription>
						</DialogHeader>
						<form
							className="flex flex-col gap-4"
							onSubmit={(event) => {
								event.preventDefault();
								rename();
							}}
						>
							<div className="flex flex-col gap-2">
								<Label htmlFor="rename-workspace">Name</Label>
								<Input
									id="rename-workspace"
									autoFocus
									value={renameName}
									onChange={(event) => setRenameName(event.target.value)}
								/>
							</div>
							<DialogFooter>
								<Button
									type="submit"
									disabled={!renameName.trim() || updateMutation.isPending}
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
								className="bg-destructive text-white hover:bg-destructive/90"
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

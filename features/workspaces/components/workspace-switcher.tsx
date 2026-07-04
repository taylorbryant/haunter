"use client";

import {
	CheckIcon,
	ChevronDownIcon,
	PencilIcon,
	PlusIcon,
	SmilePlusIcon,
	Trash2Icon,
	UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/client/auth-client";
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
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
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
	useSidebar,
} from "@/components/ui/sidebar";
import { MembersDialog } from "@/features/members/components/members-dialog";
import { canManageMembers } from "@/lib/org-access";

// A "workspace" is a Better Auth organization; its emoji lives in the org's
// `logo` field.
function slugify(name: string) {
	const base =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-|-$)/g, "") || "workspace";
	return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export function WorkspaceSwitcher({
	activeWorkspaceId,
}: {
	activeWorkspaceId: string | null;
}) {
	const { isMobile } = useSidebar();
	const router = useRouter();
	const organizationsQuery = authClient.useListOrganizations();
	const [busy, setBusy] = useState(false);

	const [dialogOpen, setDialogOpen] = useState(false);
	const [name, setName] = useState("");
	const [editOpen, setEditOpen] = useState(false);
	const [editName, setEditName] = useState("");
	const [editIcon, setEditIcon] = useState<string | null>(null);
	const [iconPickerOpen, setIconPickerOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [membersOpen, setMembersOpen] = useState(false);

	const workspaces = organizationsQuery.data ?? [];
	const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

	// Only offer management actions the caller's role allows; the server
	// enforces this regardless (Better Auth AC: update is admin+, delete is
	// owner-only).
	const activeMemberQuery = authClient.useActiveMember();
	const myRole = activeMemberQuery.data?.role ?? null;
	const canEditWorkspace = canManageMembers(myRole);
	const canDeleteWorkspace = myRole === "owner";

	async function switchTo(id: string) {
		if (id === activeWorkspaceId) return;
		await authClient.organization.setActive({ organizationId: id });
		router.push(`/w/${id}`);
	}

	async function create() {
		const trimmed = name.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		const { data, error } = await authClient.organization.create({
			name: trimmed,
			slug: slugify(trimmed),
		});
		if (error || !data) {
			setBusy(false);
			return;
		}
		await authClient.organization.setActive({ organizationId: data.id });
		await organizationsQuery.refetch?.();
		setBusy(false);
		setName("");
		setDialogOpen(false);
		router.push(`/w/${data.id}`);
	}

	async function saveEdit() {
		const trimmed = editName.trim();
		if (!active || !trimmed || busy) return;
		setBusy(true);
		await authClient.organization.update({
			organizationId: active.id,
			data: { name: trimmed, logo: editIcon ?? undefined },
		});
		await organizationsQuery.refetch?.();
		setBusy(false);
		setEditOpen(false);
		router.refresh();
	}

	async function confirmDelete() {
		if (!active || busy) return;
		const deletedId = active.id;
		setBusy(true);
		await authClient.organization.delete({ organizationId: deletedId });
		await organizationsQuery.refetch?.();
		setBusy(false);
		setDeleteOpen(false);
		// Leaving the deleted workspace: switch to another one, or land on the
		// home route (its empty state) if that was the last workspace.
		const next = workspaces.find((w) => w.id !== deletedId);
		if (next) {
			await authClient.organization.setActive({ organizationId: next.id });
			router.push(`/w/${next.id}`);
		} else {
			router.push("/");
		}
		router.refresh();
	}

	const trigger = (
		<SidebarMenuButton className="w-fit px-1.5 font-medium">
			<GhostLogo className="size-4 shrink-0" />
			<span className="truncate">
				{active
					? `${active.logo ? `${active.logo} ` : ""}${active.name}`
					: "Haunter"}
			</span>
			<ChevronDownIcon className="opacity-50" />
		</SidebarMenuButton>
	);

	const workspaceItems = workspaces.map((workspace) => ({
		id: workspace.id,
		label: `${workspace.logo ? `${workspace.logo} ` : ""}${workspace.name}`,
		active: workspace.id === activeWorkspaceId,
	}));

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				{isMobile ? (
					<Drawer>
						<DrawerTrigger asChild>{trigger}</DrawerTrigger>
						<DrawerContent>
							<DrawerHeader className="border-b text-left">
								<DrawerTitle>Workspaces</DrawerTitle>
								<DrawerDescription className="sr-only">
									Switch or manage workspaces
								</DrawerDescription>
							</DrawerHeader>
							<div className="flex flex-col gap-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
								{workspaceItems.map((workspace) => (
									<DrawerClose asChild key={workspace.id}>
										<Button
											variant="ghost"
											className="h-11 justify-start"
											onClick={() => switchTo(workspace.id)}
										>
											<span className="flex-1 truncate text-left">
												{workspace.label}
											</span>
											{workspace.active ? <CheckIcon /> : null}
										</Button>
									</DrawerClose>
								))}
								<div className="my-1 h-px bg-border" />
								<DrawerClose asChild>
									<Button
										variant="ghost"
										className="h-11 justify-start text-muted-foreground"
										onClick={() => setDialogOpen(true)}
									>
										<PlusIcon />
										New workspace
									</Button>
								</DrawerClose>
								{active ? (
									<>
										<DrawerClose asChild>
											<Button
												variant="ghost"
												className="h-11 justify-start"
												onClick={() => setMembersOpen(true)}
											>
												<UsersIcon />
												Members
											</Button>
										</DrawerClose>
										{canEditWorkspace ? (
											<DrawerClose asChild>
												<Button
													variant="ghost"
													className="h-11 justify-start"
													onClick={() => {
														setEditName(active.name);
														setEditIcon(active.logo ?? null);
														setEditOpen(true);
													}}
												>
													<PencilIcon />
													Edit workspace
												</Button>
											</DrawerClose>
										) : null}
										{canDeleteWorkspace ? (
											<DrawerClose asChild>
												<Button
													variant="ghost"
													className="h-11 justify-start text-destructive hover:text-destructive"
													onClick={() => setDeleteOpen(true)}
												>
													<Trash2Icon />
													Delete workspace
												</Button>
											</DrawerClose>
										) : null}
									</>
								) : null}
							</div>
						</DrawerContent>
					</Drawer>
				) : (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
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
									onSelect={() => switchTo(workspace.id)}
								>
									<span className="truncate">
										{workspace.logo ? `${workspace.logo} ` : ""}
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
									<DropdownMenuItem onSelect={() => setMembersOpen(true)}>
										<UsersIcon />
										Members
									</DropdownMenuItem>
									{canEditWorkspace ? (
										<DropdownMenuItem
											onSelect={() => {
												setEditName(active.name);
												setEditIcon(active.logo ?? null);
												setEditOpen(true);
											}}
										>
											<PencilIcon />
											Edit workspace
										</DropdownMenuItem>
									) : null}
									{canDeleteWorkspace ? (
										<DropdownMenuItem
											className="text-destructive focus:text-destructive"
											onSelect={() => setDeleteOpen(true)}
										>
											<Trash2Icon className="text-destructive" />
											Delete workspace
										</DropdownMenuItem>
									) : null}
								</>
							) : null}
						</DropdownMenuContent>
					</DropdownMenu>
				)}

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
								<Button type="submit" disabled={!name.trim() || busy}>
									{busy ? "Creating…" : "Create workspace"}
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
								<Button type="submit" disabled={!editName.trim() || busy}>
									{busy ? "Saving…" : "Save"}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>

				<MembersDialog open={membersOpen} onOpenChange={setMembersOpen} />

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
								{busy ? "Deleting…" : "Delete"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

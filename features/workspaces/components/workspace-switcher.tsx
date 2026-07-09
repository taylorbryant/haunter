"use client";

import {
	CheckIcon,
	ChevronDownIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
	UsersIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/client/auth-client";
import { useAppSession } from "@/components/app-session-provider";
import { useCommand } from "@/components/command-palette/registry";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { GhostLogo } from "@/components/ghost-logo";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
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
	DropdownMenuGroup,
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
	useSidebar,
} from "@/components/ui/sidebar";
import { canManageMembers } from "@/lib/org-access";

const MembersDialog = dynamic(
	() =>
		import("@/features/members/components/members-dialog").then(
			(mod) => mod.MembersDialog,
		),
	{ ssr: false },
);

const WorkspaceIconPicker = dynamic(
	() =>
		import("./workspace-icon-picker").then((mod) => ({
			default: mod.WorkspaceIconPicker,
		})),
	{
		ssr: false,
		loading: () => (
			<Button
				type="button"
				variant="outline"
				className="size-9 p-0"
				disabled
				aria-hidden
			/>
		),
	},
);

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
	const appSession = useAppSession();
	const [busy, setBusy] = useState(false);

	const [dialogOpen, setDialogOpen] = useState(false);
	const [name, setName] = useState("");
	const [editOpen, setEditOpen] = useState(false);
	const [editName, setEditName] = useState("");
	const [editIcon, setEditIcon] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [membersOpen, setMembersOpen] = useState(false);

	const workspaces = appSession?.workspaces ?? [];
	const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

	// Only offer management actions the caller's role allows; the server
	// enforces this regardless (Better Auth AC: update is admin+, delete is
	// owner-only).
	const myRole = appSession?.workspaceRole ?? null;
	const canEditWorkspace = canManageMembers(myRole);
	const canDeleteWorkspace = myRole === "owner";

	function openEdit() {
		if (!active) return;
		setEditName(active.name);
		setEditIcon(active.logo ?? null);
		setEditOpen(true);
	}

	// Palette commands, colocated with the dialogs they open and gated by the
	// same roles as the menu items below.
	useCommand({
		id: "workspace.new",
		title: "New workspace",
		group: "Workspace",
		keywords: "create organization",
		icon: PlusIcon,
		run: () => setDialogOpen(true),
	});
	useCommand(
		active && {
			id: "workspace.members",
			title: "Workspace members",
			group: "Workspace",
			keywords: "people invite team",
			icon: UsersIcon,
			run: () => setMembersOpen(true),
		},
	);
	useCommand(
		active &&
			canEditWorkspace && {
				id: "workspace.edit",
				title: "Edit workspace",
				group: "Workspace",
				keywords: "rename emoji icon",
				icon: PencilIcon,
				run: openEdit,
			},
	);
	useCommand(
		active &&
			canDeleteWorkspace && {
				id: "workspace.delete",
				title: "Delete workspace",
				group: "Workspace",
				keywords: "remove",
				icon: Trash2Icon,
				run: () => setDeleteOpen(true),
			},
	);

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
		setBusy(false);
		setEditOpen(false);
		router.refresh();
	}

	async function confirmDelete() {
		if (!active || busy) return;
		const deletedId = active.id;
		setBusy(true);
		await authClient.organization.delete({ organizationId: deletedId });
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
					<Drawer showSwipeHandle>
						<DrawerTrigger render={trigger} />
						<DrawerContent>
							<DrawerHeader>
								<DrawerTitle>Workspaces</DrawerTitle>
								<DrawerDescription className="sr-only">
									Switch or manage workspaces
								</DrawerDescription>
							</DrawerHeader>
							<div className="flex flex-col gap-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
								{workspaceItems.map((workspace) => (
									<DrawerClose
										key={workspace.id}
										render={
											<Button
												variant="ghost"
												className="h-11 justify-start"
												onClick={() => switchTo(workspace.id)}
											/>
										}
									>
										<span className="flex-1 truncate text-left">
											{workspace.label}
										</span>
										{workspace.active ? <CheckIcon /> : null}
									</DrawerClose>
								))}
								<div className="my-1 h-px bg-border" />
								<DrawerClose
									render={
										<Button
											variant="ghost"
											className="h-11 justify-start text-muted-foreground"
											onClick={() => setDialogOpen(true)}
										/>
									}
								>
									<PlusIcon />
									New workspace
								</DrawerClose>
								{active ? (
									<>
										<DrawerClose
											render={
												<Button
													variant="ghost"
													className="h-11 justify-start"
													onClick={() => setMembersOpen(true)}
												/>
											}
										>
											<UsersIcon />
											Members
										</DrawerClose>
										{canEditWorkspace ? (
											<DrawerClose
												render={
													<Button
														variant="ghost"
														className="h-11 justify-start"
														onClick={openEdit}
													/>
												}
											>
												<PencilIcon />
												Edit workspace
											</DrawerClose>
										) : null}
										{canDeleteWorkspace ? (
											<DrawerClose
												render={
													<Button
														variant="ghost"
														className="h-11 justify-start text-destructive hover:text-destructive"
														onClick={() => setDeleteOpen(true)}
													/>
												}
											>
												<Trash2Icon />
												Delete workspace
											</DrawerClose>
										) : null}
									</>
								) : null}
							</div>
						</DrawerContent>
					</Drawer>
				) : (
					<DropdownMenu>
						<DropdownMenuTrigger render={trigger} />
						<DropdownMenuContent
							className="w-56 rounded-lg"
							align="start"
							side="bottom"
							sideOffset={4}
							// Don't return focus to the trigger on close: it would steal
							// focus from the dialogs opened by the items below.
							finalFocus={() => false}
						>
							{/* Base UI requires GroupLabel to live inside a Group. */}
							<DropdownMenuGroup>
								<DropdownMenuLabel className="text-muted-foreground text-xs">
									Workspaces
								</DropdownMenuLabel>
								{workspaces.map((workspace) => (
									<DropdownMenuItem
										key={workspace.id}
										onClick={() => switchTo(workspace.id)}
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
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => setDialogOpen(true)}>
								<PlusIcon />
								<span className="font-medium text-muted-foreground">
									New workspace
								</span>
							</DropdownMenuItem>
							{active ? (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem onClick={() => setMembersOpen(true)}>
										<UsersIcon />
										Members
									</DropdownMenuItem>
									{canEditWorkspace ? (
										<DropdownMenuItem onClick={openEdit}>
											<PencilIcon />
											Edit workspace
										</DropdownMenuItem>
									) : null}
									{canDeleteWorkspace ? (
										<DropdownMenuItem
											className="text-destructive focus:text-destructive"
											onClick={() => setDeleteOpen(true)}
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

				<ResponsiveDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					title="New workspace"
					description="Workspaces keep separate areas of your life apart, like work and personal."
					className="sm:max-w-sm"
				>
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
						<ResponsiveDialogFooter>
							<Button type="submit" disabled={!name.trim() || busy}>
								{busy ? "Creating…" : "Create workspace"}
							</Button>
						</ResponsiveDialogFooter>
					</form>
				</ResponsiveDialog>

				<ResponsiveDialog
					open={editOpen}
					onOpenChange={setEditOpen}
					title="Edit workspace"
					description="Update this workspace's emoji and name."
					className="sm:max-w-sm"
				>
					{editOpen ? (
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
									<WorkspaceIconPicker
										id="edit-workspace-emoji"
										icon={editIcon}
										onIconChange={setEditIcon}
									/>
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
							<ResponsiveDialogFooter>
								<Button type="submit" disabled={!editName.trim() || busy}>
									{busy ? "Saving..." : "Save"}
								</Button>
							</ResponsiveDialogFooter>
						</form>
					) : null}
				</ResponsiveDialog>

				{membersOpen ? (
					<MembersDialog open={membersOpen} onOpenChange={setMembersOpen} />
				) : null}

				<DestructiveConfirmationDialog
					open={deleteOpen}
					onOpenChange={setDeleteOpen}
					title={`Delete ${active ? `“${active.name}”` : "workspace"}?`}
					description={
						<span className="break-words">
							This permanently deletes the workspace and all of its pages,
							tasks, and canvases. This cannot be undone.
						</span>
					}
					actionLabel="Delete workspace"
					pendingLabel="Deleting…"
					pending={busy}
					onConfirm={confirmDelete}
				/>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

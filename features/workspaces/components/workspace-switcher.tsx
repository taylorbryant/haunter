"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
	invalidateWorkspaces,
	listWorkspacesQueryOptions,
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

	const [dialogOpen, setDialogOpen] = useState(false);
	const [name, setName] = useState("");

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
						// focus from the New-workspace dialog's name field.
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
						{workspaces.length > 0 ? <DropdownMenuSeparator /> : null}
						<DropdownMenuItem onSelect={() => setDialogOpen(true)}>
							<PlusIcon />
							<span className="font-medium text-muted-foreground">
								New workspace
							</span>
						</DropdownMenuItem>
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
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

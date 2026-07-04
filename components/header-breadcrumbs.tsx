"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import {
	Breadcrumb,
	BreadcrumbEllipsis,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listPagesQueryOptions } from "@/features/pages/client/queries";
import type { PageMeta } from "@/features/pages/schemas";
import { listWorkspacesQueryOptions } from "@/features/workspaces/client/queries";
import { useIsMobile } from "@/hooks/use-mobile";

function pageTrail(pages: PageMeta[], pageId: string): PageMeta[] {
	const byId = new Map(pages.map((page) => [page.id, page]));
	const trail: PageMeta[] = [];
	let current = byId.get(pageId);

	while (current) {
		trail.unshift(current);
		current = current.parentPageId ? byId.get(current.parentPageId) : undefined;
	}

	return trail;
}

export function HeaderBreadcrumbs() {
	const isMobile = useIsMobile();
	const pathname = usePathname();
	const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;
	const pageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;

	const workspacesQuery = useQuery({
		...listWorkspacesQueryOptions(),
		enabled: workspaceId !== null,
	});
	const pagesQuery = useQuery({
		...listPagesQueryOptions(workspaceId ?? ""),
		enabled: workspaceId !== null,
	});

	if (!workspaceId) {
		return null;
	}

	const workspace = workspacesQuery.data?.items.find(
		(item) => item.id === workspaceId,
	);
	const section = pathname.endsWith("/tasks")
		? "My Tasks"
		: pathname.endsWith("/trash")
			? "Trash"
			: null;
	const trail = pageId ? pageTrail(pagesQuery.data?.items ?? [], pageId) : [];
	const leafId = section ?? trail[trail.length - 1]?.id ?? null;

	// Deep trails collapse Notion-style, with the hidden ancestors reachable
	// through the ellipsis menu. On mobile the header is too narrow for a
	// multi-page trail, so collapse hard to workspace / … / current; on
	// desktop keep root / … / parent / current.
	const headCount = isMobile ? 0 : 1;
	const tailCount = isMobile ? 1 : 2;
	const collapse = trail.length > headCount + tailCount;
	const visibleTrail = collapse
		? [...trail.slice(0, headCount), ...trail.slice(-tailCount)].filter(
				(page): page is PageMeta => page !== undefined,
			)
		: trail;
	const hiddenTrail = collapse ? trail.slice(headCount, -tailCount) : [];

	return (
		<Breadcrumb className="min-w-0 flex-1">
			<BreadcrumbList className="flex-nowrap">
				<BreadcrumbItem>
					{leafId ? (
						<BreadcrumbLink asChild>
							<Link href={`/w/${workspaceId}`}>
								{workspace?.name ?? "Workspace"}
							</Link>
						</BreadcrumbLink>
					) : (
						<BreadcrumbPage>{workspace?.name ?? "Workspace"}</BreadcrumbPage>
					)}
				</BreadcrumbItem>
				{section ? (
					<>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{section}</BreadcrumbPage>
						</BreadcrumbItem>
					</>
				) : null}
				{visibleTrail.map((page, index) => (
					<Fragment key={page.id}>
						{collapse && index === headCount ? (
							<>
								<BreadcrumbSeparator className="shrink-0" />
								<BreadcrumbItem>
									<DropdownMenu>
										<DropdownMenuTrigger
											className="flex items-center gap-1"
											aria-label="Show hidden pages"
										>
											<BreadcrumbEllipsis className="size-4" />
										</DropdownMenuTrigger>
										<DropdownMenuContent align="start">
											{hiddenTrail.map((hidden) => (
												<DropdownMenuItem key={hidden.id} asChild>
													<Link href={`/w/${workspaceId}/p/${hidden.id}`}>
														{hidden.title || "Untitled"}
													</Link>
												</DropdownMenuItem>
											))}
										</DropdownMenuContent>
									</DropdownMenu>
								</BreadcrumbItem>
							</>
						) : null}
						<BreadcrumbSeparator className="shrink-0" />
						<BreadcrumbItem className="min-w-0">
							{page.id === leafId ? (
								<BreadcrumbPage className="truncate">
									{page.title || "Untitled"}
								</BreadcrumbPage>
							) : (
								<BreadcrumbLink asChild>
									<Link
										href={`/w/${workspaceId}/p/${page.id}`}
										className="truncate"
									>
										{page.title || "Untitled"}
									</Link>
								</BreadcrumbLink>
							)}
						</BreadcrumbItem>
					</Fragment>
				))}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

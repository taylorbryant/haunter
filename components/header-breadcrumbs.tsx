"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ReactElement } from "react";
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

	const pagesQuery = useQuery({
		...listPagesQueryOptions(workspaceId ?? ""),
		enabled: workspaceId !== null,
	});

	if (!workspaceId) {
		return null;
	}

	const section = pathname.endsWith("/tasks")
		? "Tasks"
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

	// Assemble the ordered crumbs (the workspace root is intentionally omitted —
	// it lives in the sidebar switcher). Separators are rendered between crumbs
	// below so the first one never has a leading chevron.
	const crumbs: ReactElement[] = [];
	if (section) {
		crumbs.push(
			<BreadcrumbItem key="section">
				<BreadcrumbPage>{section}</BreadcrumbPage>
			</BreadcrumbItem>,
		);
	} else {
		visibleTrail.forEach((page, index) => {
			if (collapse && index === headCount) {
				crumbs.push(
					<BreadcrumbItem key="ellipsis">
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
					</BreadcrumbItem>,
				);
			}
			crumbs.push(
				<BreadcrumbItem key={page.id} className="min-w-0">
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
				</BreadcrumbItem>,
			);
		});
	}

	return (
		<Breadcrumb className="min-w-0 flex-1">
			<BreadcrumbList className="flex-nowrap">
				{crumbs.map((crumb, index) => (
					<Fragment key={crumb.key}>
						{index > 0 ? <BreadcrumbSeparator className="shrink-0" /> : null}
						{crumb}
					</Fragment>
				))}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

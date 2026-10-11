"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { HELP_GUIDES } from "../guides";
import { cn } from "@/lib/utils";

export function HelpNavigation({ mobile = false }: { mobile?: boolean }) {
	const pathname = usePathname();
	const links = (
		<nav aria-label={mobile ? "Mobile guides" : "Guides"}>
			{/* biome-ignore lint/a11y/noRedundantRoles: Preserve list semantics in Safari when Tailwind removes list markers. */}
			<ul role="list" className="flex flex-col gap-1">
				{[{ slug: "", title: "All guides" }, ...HELP_GUIDES].map((guide) => {
					const href = guide.slug ? `/guides/${guide.slug}` : "/guides";
					const active = pathname === href;
					return (
						<li key={href} className="text-base sm:text-sm">
							<Link
								href={href}
								aria-current={active ? "page" : undefined}
								className={cn(
									"flex min-h-11 items-center rounded-md px-3 py-2 font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9",
									active
										? "bg-accent text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{guide.title}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
	if (!mobile) return links;
	return (
		<details
			key={pathname}
			className="group border-border/70 border-b lg:hidden"
		>
			<summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-sm px-1 py-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
				<MenuIcon aria-hidden className="size-4 shrink-0" />
				Browse guides
			</summary>
			<div className="pb-4">{links}</div>
		</details>
	);
}

"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

export function PublicPageMenu({
	links,
}: {
	links: { href: string; label: string; active: boolean }[];
}) {
	const pathname = usePathname();
	const disclosure = useRef<HTMLDetailsElement>(null);
	return (
		<details key={pathname} ref={disclosure} className="lg:hidden">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: Native summary is keyboard-operable; Escape closes its disclosure. */}
			<summary
				className="flex size-12 cursor-pointer list-none items-center justify-center rounded-lg outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
				onKeyDown={(event) => {
					if (event.key === "Escape" && disclosure.current)
						disclosure.current.open = false;
				}}
			>
				<MenuIcon aria-hidden className="size-6 shrink-0" />
				<span className="sr-only">Navigation menu</span>
			</summary>
			<nav
				aria-label="Mobile"
				className="absolute inset-x-0 top-full flex flex-col gap-1 border-foreground/10 border-b bg-background px-5 py-4"
			>
				{links.map(({ href, label, active }) => (
					<Link
						key={href}
						href={href}
						aria-current={active ? "page" : undefined}
						onClick={() => {
							if (disclosure.current) disclosure.current.open = false;
						}}
						onKeyDown={(event) => {
							if (event.key !== "Escape" || !disclosure.current) return;
							disclosure.current.open = false;
							disclosure.current.querySelector("summary")?.focus();
						}}
						className="flex min-h-12 items-center rounded-lg px-3 font-medium text-muted-foreground outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-foreground/5 aria-[current=page]:text-foreground"
					>
						{label}
					</Link>
				))}
			</nav>
		</details>
	);
}

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { HeaderBreadcrumbs } from "@/components/header-breadcrumbs";
import { HeaderSaveIndicator } from "@/components/header-save-indicator";
import { ShareButton } from "@/features/shares/components/share-button";
import { Separator } from "@/components/ui/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { auth } from "@/lib/better-auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
	const session = await auth.api.getSession({ headers: await headers() });

	if (!session) {
		redirect("/sign-in");
	}

	const cookieStore = await cookies();
	const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

	return (
		<SidebarProvider defaultOpen={defaultOpen}>
			<AppSidebar
				user={{ name: session.user.name, email: session.user.email }}
			/>
			<SidebarInset>
				<header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 bg-background/90 px-3 backdrop-blur-sm">
					<SidebarTrigger />
					<Separator
						orientation="vertical"
						className="mr-2 data-vertical:h-4 data-vertical:self-auto"
					/>
					<HeaderBreadcrumbs />
					<HeaderSaveIndicator />
					<ShareButton />
				</header>
				<div className="min-w-0 flex-1">{children}</div>
			</SidebarInset>
		</SidebarProvider>
	);
}

import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
	applicationName: "Haunter",
	title: "Haunter",
	description: "Personal notes: pages, tasks, code, and canvases.",
	manifest: "/manifest.webmanifest",
	// Standalone launch + home-screen label/status bar on iOS. Next emits the
	// standardized `mobile-web-app-capable` from `capable`; we add the legacy
	// `apple-mobile-web-app-capable` below for older iOS versions.
	appleWebApp: { capable: true, title: "Haunter", statusBarStyle: "default" },
	other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#ffffff" },
		{ media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
	],
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html
			lang="en"
			className={cn("font-sans", inter.variable)}
			suppressHydrationWarning
		>
			<body>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					<Providers>{children}</Providers>
					<ServiceWorkerRegistrar />
				</ThemeProvider>
			</body>
		</html>
	);
}

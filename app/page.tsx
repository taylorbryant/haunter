import type { Metadata } from "next";
import { publicPageViewport } from "@/components/public-page";
import { Homepage } from "@/features/website/components/homepage";

export const viewport = publicPageViewport;

export const metadata: Metadata = {
	title: "Haunter — A home for your ideas",
	description:
		"Pages, tasks, and canvases in one thoughtful workspace. Write, plan, and sketch with your team and your AI agent in Haunter.",
	openGraph: {
		title: "Haunter — A home for your ideas",
		description:
			"Pages, tasks, and canvases. A little space for your next big idea.",
		type: "website",
	},
};

// The public homepage never reads a session or boots the workspace editor.
export const dynamic = "force-static";

export default function Page() {
	return <Homepage />;
}

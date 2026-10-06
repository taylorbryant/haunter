import { notFound } from "next/navigation";
import { EmbeddedWorkspace } from "@/features/agents/components/embedded-workspace";
import { parseWorkspacePath } from "@/features/agents/mcp-app/workspace-bridge";

export const metadata = {
	title: "Haunter",
	robots: { index: false, follow: false },
};
export default async function EmbeddedWorkspacePage({
	searchParams,
}: {
	searchParams: Promise<{ path?: string }>;
}) {
	const { path } = await searchParams;
	try {
		parseWorkspacePath(path ?? "");
	} catch {
		notFound();
	}
	return <EmbeddedWorkspace initialPath={path!} />;
}

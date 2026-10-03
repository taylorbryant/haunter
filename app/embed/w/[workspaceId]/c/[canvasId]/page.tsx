import { notFound } from "next/navigation";
import { EmbeddedEditorBootstrap } from "@/features/agents/components/embedded-editor-bootstrap";
import { CanvasEditorInputSchema } from "@/features/agents/mcp-app/editor-schema";
export const metadata = {
	title: "Haunter canvas",
	robots: { index: false, follow: false },
};
export default async function EmbeddedCanvasPage({
	params,
}: {
	params: Promise<{ workspaceId: string; canvasId: string }>;
}) {
	const parsed = CanvasEditorInputSchema.safeParse(await params);
	if (!parsed.success) notFound();
	return <EmbeddedEditorBootstrap {...parsed.data} />;
}

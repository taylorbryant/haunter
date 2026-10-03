import { notFound } from "next/navigation";
import { EmbeddedEditorBootstrap } from "@/features/agents/components/embedded-editor-bootstrap";
import { EditorInputSchema } from "@/features/agents/mcp-app/editor-schema";
export const metadata = {
	title: "Haunter editor",
	robots: { index: false, follow: false },
};
export default async function EmbeddedEditorPage({
	params,
}: {
	params: Promise<{ workspaceId: string; pageId: string }>;
}) {
	const parsed = EditorInputSchema.safeParse(await params);
	if (!parsed.success) notFound();
	return <EmbeddedEditorBootstrap {...parsed.data} />;
}

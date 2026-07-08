import { PageEditor } from "@/features/pages/components/page-editor";

export default async function PagePage({
	params,
}: {
	params: Promise<{ pageId: string; workspaceId: string }>;
}) {
	const { pageId } = await params;
	return <PageEditor pageId={pageId} />;
}

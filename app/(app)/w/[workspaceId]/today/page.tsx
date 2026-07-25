import { redirect } from "next/navigation";

export default async function TodayPage({
	params,
}: {
	params: Promise<{ workspaceId: string }>;
}) {
	const { workspaceId } = await params;
	redirect(`/w/${workspaceId}/home`);
}

export const pageId = "17c05b44-c652-4d83-92cf-83cbf7056ef2";
export const childId = "181e57bb-d220-4022-b4d6-8cd96f55ba28";
export const canvasId = "22361203-b2ae-4a16-86d6-98d4c01f5d9a";
export const destination = (id = pageId, workspaceId = "workspace-one") => ({
	workspaceId,
	pageId: id,
	title: id === pageId ? "Launch plan" : "Release checklist",
	editorUrl: `https://haunter.test/embed/w/${workspaceId}/p/${id}`,
	webUrl: `https://haunter.test/w/${workspaceId}/p/${id}`,
});
export const canvasDestination = {
	...destination(),
	canvasId,
	title: "Architecture",
	editorUrl: `https://haunter.test/embed/w/workspace-one/c/${canvasId}`,
	webUrl: `https://haunter.test/w/workspace-one/c/${canvasId}`,
};

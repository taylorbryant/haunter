import { AppendSubpageLinkJob } from "./append-subpage-link";
import { EnsureDocumentJob } from "./ensure-document";
import { MaterializeDocumentJob } from "./materialize-document";

export { AppendSubpageLinkJob } from "./append-subpage-link";
export { EnsureDocumentJob } from "./ensure-document";
export { MaterializeDocumentJob } from "./materialize-document";

export const documentJobs = [
	MaterializeDocumentJob,
	EnsureDocumentJob,
	AppendSubpageLinkJob,
] as const;

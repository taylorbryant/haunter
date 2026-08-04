import { AppendSubpageLinkJob } from "./append-subpage-link";
import { DeleteProviderDocumentJob } from "./delete-provider-document";
import { EnsureDocumentJob } from "./ensure-document";
import { MaterializeDocumentJob } from "./materialize-document";

export { AppendSubpageLinkJob } from "./append-subpage-link";
export { DeleteProviderDocumentJob } from "./delete-provider-document";
export { EnsureDocumentJob } from "./ensure-document";
export { MaterializeDocumentJob } from "./materialize-document";

export const documentJobs = [
	MaterializeDocumentJob,
	EnsureDocumentJob,
	AppendSubpageLinkJob,
	DeleteProviderDocumentJob,
] as const;

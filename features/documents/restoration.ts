/** A restore fences old clients; their pending edits belong in recovery copies. */
export class DocumentRestoredError extends Error {
	constructor(readonly generation: number) {
		super(
			"This page was restored. Open its current version to continue editing.",
		);
		this.name = "DocumentRestoredError";
	}
}

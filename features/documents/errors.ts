/** A provider/network failure for which the last materialized SQLite
 * projection may be served read-only. Document corruption and schema/model
 * mismatches intentionally use different errors and must still fail closed. */
export class DocumentStoreUnavailableError extends Error {
	constructor(options?: { cause?: unknown }) {
		super("The collaborative document store is unavailable.", options);
		this.name = "DocumentStoreUnavailableError";
	}
}

export function isDocumentStoreUnavailable(
	error: unknown,
): error is DocumentStoreUnavailableError {
	return error instanceof DocumentStoreUnavailableError;
}

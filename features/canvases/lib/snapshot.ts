import type { TLStoreSnapshot } from "tldraw";

/**
 * A stored canvas snapshot tldraw can actually load. Legacy/empty rows
 * (e.g. the "{}" column default) lack the schema and crash tldraw's
 * migrator, so they are treated as "no snapshot".
 */
export function isLoadableSnapshot(
	value: Record<string, unknown>,
): value is Record<string, unknown> & TLStoreSnapshot {
	return (
		typeof value.schema === "object" &&
		value.schema !== null &&
		typeof value.store === "object" &&
		value.store !== null
	);
}

export function loadableSnapshot(
	value: Record<string, unknown>,
): TLStoreSnapshot | undefined {
	return isLoadableSnapshot(value)
		? (value as unknown as TLStoreSnapshot)
		: undefined;
}

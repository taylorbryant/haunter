/** Compact recovery files without a dependency on Node's Buffer in the browser. */
export function encodeRecoveryUpdate(update: Uint8Array): string {
	let binary = "";
	for (let offset = 0; offset < update.length; offset += 8192)
		binary += String.fromCharCode(...update.subarray(offset, offset + 8192));
	return btoa(binary);
}

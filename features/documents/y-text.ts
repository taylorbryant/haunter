import type * as Y from "yjs";

/** Apply the smallest contiguous edit that turns a shared Y.Text into `next`.
 * Keeping unchanged characters preserves their CRDT identities, so ordinary
 * concurrent typing merges as text instead of repeatedly replacing the whole
 * title with independent insertions. */
export function updateSharedText(text: Y.Text, next: string): void {
	const current = text.toString();
	if (current === next) return;

	const currentCharacters = Array.from(current);
	const nextCharacters = Array.from(next);
	let sharedPrefixCharacters = 0;
	while (
		sharedPrefixCharacters < currentCharacters.length &&
		sharedPrefixCharacters < nextCharacters.length &&
		currentCharacters[sharedPrefixCharacters] ===
			nextCharacters[sharedPrefixCharacters]
	) {
		sharedPrefixCharacters += 1;
	}

	let sharedSuffixCharacters = 0;
	while (
		sharedSuffixCharacters <
			currentCharacters.length - sharedPrefixCharacters &&
		sharedSuffixCharacters < nextCharacters.length - sharedPrefixCharacters &&
		currentCharacters[currentCharacters.length - 1 - sharedSuffixCharacters] ===
			nextCharacters[nextCharacters.length - 1 - sharedSuffixCharacters]
	) {
		sharedSuffixCharacters += 1;
	}

	const sharedPrefix = currentCharacters
		.slice(0, sharedPrefixCharacters)
		.join("").length;
	const sharedSuffix = currentCharacters
		.slice(currentCharacters.length - sharedSuffixCharacters)
		.join("").length;
	const deleteLength = current.length - sharedPrefix - sharedSuffix;
	const nextSuffix = nextCharacters
		.slice(nextCharacters.length - sharedSuffixCharacters)
		.join("").length;
	const insertion = next.slice(sharedPrefix, next.length - nextSuffix);

	if (deleteLength > 0) text.delete(sharedPrefix, deleteLength);
	if (insertion.length > 0) text.insert(sharedPrefix, insertion);
}

import * as Y from "yjs";

type TextDelta = { insert: string; attributes?: Record<string, unknown> };

function updateText(target: Y.XmlText, source?: Y.XmlText) {
	const previous: TextDelta[] = target.toDelta();
	const desired: TextDelta[] = source?.toDelta() ?? [];
	const before = previous.map((part) => part.insert).join("");
	const after = desired.map((part) => part.insert).join("");
	let prefix = 0;
	while (
		prefix < Math.min(before.length, after.length) &&
		before[prefix] === after[prefix]
	)
		prefix++;
	// Yjs uses UTF-16 offsets. Never cut a shared surrogate pair in half.
	if (prefix > 0 && /[\uD800-\uDBFF]/.test(before[prefix - 1]!)) prefix--;
	let suffix = 0;
	while (
		suffix < Math.min(before.length, after.length) - prefix &&
		before[before.length - suffix - 1] === after[after.length - suffix - 1]
	)
		suffix++;
	if (suffix > 0 && /[\uDC00-\uDFFF]/.test(before[before.length - suffix]!))
		suffix--;
	const removed = before.length - prefix - suffix;
	const inserted = after.slice(prefix, after.length - suffix);
	// Anchor new text before the removed range, so typing after that range
	// stays after the replacement when the concurrent updates merge.
	if (inserted) target.insert(prefix, inserted);
	if (removed) target.delete(prefix + inserted.length, removed);
	// Explicitly clear marks missing from the replacement, including link marks.
	const cleared = Object.fromEntries(
		previous.flatMap((part) =>
			Object.keys(part.attributes ?? {}).map((key) => [key, null]),
		),
	);
	target.applyDelta(
		desired.map((part) => ({
			retain: part.insert.length,
			attributes: { ...cleared, ...part.attributes },
		})),
	);
}

/** Preserve every text node, even when removing line breaks or mentions.
 * Deleting a Y.XmlText also deletes remote typing that has not arrived yet.
 * Surplus text nodes stay empty so those concurrent inserts can still merge. */
export function updateInlineContent(
	target: Y.XmlElement,
	source: Y.XmlElement,
) {
	target.doc!.transact(() => {
		const texts = target
			.toArray()
			.filter((node): node is Y.XmlText => node instanceof Y.XmlText);
		for (let index = target.length - 1; index >= 0; index--) {
			if (!(target.get(index) instanceof Y.XmlText)) target.delete(index, 1);
		}
		let position = 0;
		let textIndex = 0;
		for (const node of source.toArray()) {
			if (!(node instanceof Y.XmlText) && !(node instanceof Y.XmlElement))
				throw new Error("Invalid inline node");
			if (node instanceof Y.XmlText && texts[textIndex]) {
				updateText(texts[textIndex++]!, node);
			} else {
				target.insert(position, [node.clone()]);
			}
			position++;
		}
		for (const text of texts.slice(textIndex)) updateText(text);
	});
}

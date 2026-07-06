/**
 * Gravatar URL for an email, using the SHA-256 address hashes Gravatar
 * adopted alongside classic MD5. `d=404` makes the image request fail for
 * addresses with no Gravatar, which lets AvatarImage fall back to the
 * initials placeholder instead of showing Gravatar's generic icon.
 *
 * Async because it hashes with WebCrypto (available in browsers on secure
 * origins — localhost included — and in every server runtime we target).
 */
export async function gravatarUrl(email: string, size = 256): Promise<string> {
	const normalized = email.trim().toLowerCase();
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(normalized),
	);
	const hash = Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `https://gravatar.com/avatar/${hash}?d=404&s=${size}`;
}

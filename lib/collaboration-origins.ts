import { z } from "zod";

const BrowserOrigin = z
	.string()
	.trim()
	.url()
	.refine((value) => {
		if (!URL.canParse(value)) return false;
		const url = new URL(value);
		return (
			["http:", "https:"].includes(url.protocol) &&
			!url.hostname.includes("*") &&
			!url.username &&
			!url.password &&
			url.pathname === "/" &&
			!url.search &&
			!url.hash
		);
	}, "Use an exact HTTP(S) origin without credentials, a path, or wildcards.")
	.transform((value) => new URL(value).origin);

export const CollaborationOrigins = z
	.string()
	.transform((value) => value.split(","))
	.pipe(z.array(BrowserOrigin).min(1));

export type CollaborationOriginOptions = {
	origin: string;
	additionalOrigins?: readonly string[];
};

export function isAllowedCollaborationOrigin(
	origin: string | null,
	options: CollaborationOriginOptions,
): boolean {
	// Native clients omit Origin; document tokens and membership remain required.
	return (
		origin === null ||
		origin === options.origin ||
		options.additionalOrigins?.includes(origin) === true
	);
}

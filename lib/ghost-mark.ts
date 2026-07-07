// The Haunter ghost mark as an inline SVG, shared by the code-generated PWA
// icons (app icon, maskable, Apple touch icon). Kept in sync with app/icon.svg.
const GHOST_PATH =
	"M4 19.5Q6.7 22 9.3 19.5 12 22 14.7 19.5 17.3 22 20 19.5L20 10C20 5.58 16.42 2 12 2 7.58 2 4 5.58 4 10Z M8.3 10.2a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0z M13.5 10.2a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0z";

/** A base64 data URI of the ghost at the given pixel size and fill color. */
export function ghostSvgDataUri(sizePx: number, color = "#000000"): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 24 24"><path fill="${color}" fill-rule="evenodd" d="${GHOST_PATH}"/></svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

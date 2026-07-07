import { ImageResponse } from "next/og";
import { ghostSvgDataUri } from "@/lib/ghost-mark";

// The manifest's PNG icons, rendered from the ghost mark on a white square so
// there are no binary assets to maintain. Maskable uses a tighter safe zone so
// the OS can crop it to a circle/squircle without clipping the ghost.
const SPECS: Record<string, { size: number; maskable?: boolean }> = {
	"icon-192.png": { size: 192 },
	"icon-512.png": { size: 512 },
	"icon-512-maskable.png": { size: 512, maskable: true },
};

export function generateStaticParams() {
	return Object.keys(SPECS).map((icon) => ({ icon }));
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ icon: string }> },
) {
	const { icon } = await params;
	const spec = SPECS[icon];
	if (!spec) return new Response("Not found", { status: 404 });

	const inner = Math.round(spec.size * (spec.maskable ? 0.56 : 0.68));
	return new ImageResponse(
		<div
			style={{
				display: "flex",
				width: "100%",
				height: "100%",
				alignItems: "center",
				justifyContent: "center",
				background: "#ffffff",
			}}
		>
			{/* biome-ignore lint/a11y/useAltText: satori img, not DOM */}
			<img width={inner} height={inner} src={ghostSvgDataUri(inner)} />
		</div>,
		{ width: spec.size, height: spec.size },
	);
}

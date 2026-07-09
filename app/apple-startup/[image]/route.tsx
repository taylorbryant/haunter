import { ImageResponse } from "next/og";
import {
	APPLE_STARTUP_IMAGE_BY_ID,
	APPLE_STARTUP_IMAGE_SPECS,
} from "@/lib/apple-startup-images";
import { ghostSvgDataUri } from "@/lib/ghost-mark";

export const dynamic = "force-static";

export function generateStaticParams() {
	return APPLE_STARTUP_IMAGE_SPECS.map((spec) => ({ image: spec.id }));
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ image: string }> },
) {
	const { image } = await params;
	const spec = APPLE_STARTUP_IMAGE_BY_ID.get(image);
	if (!spec) return new Response("Not found", { status: 404 });

	const markSize = Math.min(
		320,
		Math.max(128, Math.round(Math.min(spec.width, spec.height) * 0.18)),
	);

	return new ImageResponse(
		<div
			style={{
				display: "flex",
				width: "100%",
				height: "100%",
				alignItems: "center",
				justifyContent: "center",
				background: "#0a0a0a",
			}}
		>
			{/* biome-ignore lint/performance/noImgElement: satori image, not DOM */}
			<img
				alt=""
				width={markSize}
				height={markSize}
				src={ghostSvgDataUri(markSize, "#ffffff")}
			/>
		</div>,
		{ width: spec.width, height: spec.height },
	);
}

import { ImageResponse } from "next/og";
import { ghostSvgDataUri } from "@/lib/ghost-mark";

// iOS home-screen icon. The high-luminance mark on an opaque graphite field
// stays legible when iOS derives dark, tinted, and clear Home Screen variants.
// iOS rounds the corners itself; Next injects <link rel="apple-touch-icon">.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
	const inner = 120;
	return new ImageResponse(
		<div
			style={{
				display: "flex",
				width: "100%",
				height: "100%",
				alignItems: "center",
				justifyContent: "center",
				background: "#171717",
			}}
		>
			{/* biome-ignore lint/a11y/useAltText lint/performance/noImgElement: satori image markup, not browser DOM */}
			<img
				width={inner}
				height={inner}
				src={ghostSvgDataUri(inner, "#ffffff")}
			/>
		</div>,
		{ ...size },
	);
}

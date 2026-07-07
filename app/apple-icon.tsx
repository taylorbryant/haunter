import { ImageResponse } from "next/og";
import { ghostSvgDataUri } from "@/lib/ghost-mark";

// iOS home-screen icon. 180x180, opaque white (iOS ignores transparency and
// rounds the corners itself). Next injects <link rel="apple-touch-icon">.
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
				background: "#ffffff",
			}}
		>
			{/* biome-ignore lint/a11y/useAltText: satori img, not DOM */}
			<img width={inner} height={inner} src={ghostSvgDataUri(inner)} />
		</div>,
		{ ...size },
	);
}

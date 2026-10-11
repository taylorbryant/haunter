import {
	getSharedPagePreview,
	truncatePreviewText,
} from "@/features/shares/lib/page-preview";
import type { SharedPage } from "@/features/shares/schemas";
import { ghostSvgDataUri } from "@/lib/ghost-mark";

/** Satori markup for a public link card, rendered by next/og. */
export function SharedPagePreviewImage({ page }: { page: SharedPage }) {
	const { title } = getSharedPagePreview(page);
	const displayTitle = truncatePreviewText(title, 140);
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				padding: "56px 64px",
				background: "#282a36",
				color: "#f8f8f2",
				fontFamily: "geist",
			}}
		>
			<div
				style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28 }}
			>
				{/* biome-ignore lint/performance/noImgElement: next/og image markup */}
				<img
					src={ghostSvgDataUri(32, "#f8f8f2")}
					width={32}
					height={32}
					alt=""
				/>
				Haunter
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					flex: 1,
					gap: 24,
				}}
			>
				{page.icon ? (
					<div style={{ display: "flex", fontSize: 68 }}>{page.icon}</div>
				) : null}
				<div
					style={{
						display: "block",
						fontSize: displayTitle.length > 80 ? 56 : 72,
						fontWeight: 700,
						lineHeight: 1.12,
						letterSpacing: "-2px",
						lineClamp: 3,
						wordBreak: "break-word",
					}}
				>
					{displayTitle}
				</div>
			</div>
		</div>
	);
}

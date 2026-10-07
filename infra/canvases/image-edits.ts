import { getIndexAbove, type IndexKey } from "@tldraw/utils";
import type { TLRecord, TLStoreSnapshot, TLShapeId } from "@tldraw/tlschema";
import type { CanvasCommand } from "@/features/canvases/editing";
import { normalizeCanvasSnapshot } from "@/features/canvases/lib/document";
import { safeAttachmentName } from "@/features/pages/attachments";
import { appError } from "@/features/shared/errors";
import { decodeFileBase64, normalizeAgentImage } from "../agents/file-input";

const invalid = (message: string): never => {
	throw appError("InvalidCanvasEdit", { message });
};
export async function prepareCanvasImageInsertion(
	snapshot: TLStoreSnapshot,
	command: Extract<CanvasCommand, { action: "insert-image" }>,
) {
	const pages = Object.values(snapshot.store).filter(
		(r) => r.typeName === "page",
	);
	const parentId =
		command.parentId ??
		command.pageId ??
		(pages.length === 1 ? pages[0]!.id : undefined);
	let parent = parentId
		? snapshot.store[parentId as TLRecord["id"]]
		: undefined;
	const seen = new Set<string>();
	while (parent?.typeName === "shape") {
		if (
			seen.has(parent.id) ||
			seen.size > 100 ||
			parent.isLocked ||
			!["group", "frame"].includes(parent.type)
		)
			invalid("Choose an unlocked group, frame or canvas page.");
		seen.add(parent.id);
		parent = snapshot.store[parent.parentId];
	}
	if (
		!parentId ||
		parent?.typeName !== "page" ||
		(command.pageId && command.pageId !== parent.id)
	)
		return invalid(
			"Specify a valid pageId, or a parentId on that canvas page.",
		);
	const image = await normalizeAgentImage(decodeFileBase64(command.image.data));
	const assetId = `asset:${crypto.randomUUID()}`;
	const shapeId = `shape:${crypto.randomUUID()}`;
	const width = command.width ?? Math.min(image.width, 800);
	const height = (width * image.height) / image.width;
	if (height > 10_000 || height < 1)
		return invalid(
			"Choose an image width that keeps height between 1 and 10,000.",
		);
	const indices = Object.values(snapshot.store)
		.filter((r) => r.typeName === "shape" && r.parentId === parentId)
		.map((r) => (r as { index: IndexKey }).index)
		.sort();
	const asset = {
		id: assetId,
		typeName: "asset",
		type: "image",
		meta: {},
		props: {
			name: command.image.name,
			src: `data:image/png;base64,${image.bytes.toString("base64")}`,
			w: image.width,
			h: image.height,
			fileSize: image.bytes.length,
			mimeType: "image/png",
			isAnimated: false,
		},
	};
	const shape = {
		id: shapeId,
		typeName: "shape",
		type: "image",
		x: command.x,
		y: command.y,
		rotation: 0,
		index: getIndexAbove(indices.at(-1)),
		parentId,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: {
			w: width,
			h: height,
			assetId,
			playing: true,
			url: "",
			crop: null,
			flipX: false,
			flipY: false,
			altText: "",
		},
	};
	try {
		const next = normalizeCanvasSnapshot({
			schema: snapshot.schema,
			store: { ...snapshot.store, [assetId]: asset, [shapeId]: shape },
		});
		return {
			next,
			changed: [
				next.store[assetId as TLRecord["id"]]!,
				next.store[shapeId as TLRecord["id"]]!,
			],
			deleted: [] as TLRecord["id"][],
			createdShapes: { image: shapeId },
		};
	} catch {
		return invalid(
			"The image would exceed the canvas storage limit or produce an invalid record.",
		);
	}
}

/** Images already uploaded in the web editor use the same inline asset store. Never fetch an asset URL. */
export async function readCanvasImage(
	snapshot: TLStoreSnapshot,
	shapeId: string,
) {
	const shape = snapshot.store[shapeId as TLShapeId];
	if (
		shape?.typeName !== "shape" ||
		shape.type !== "image" ||
		!shape.props.assetId
	)
		return invalid("This image shape is unavailable.");
	const asset = snapshot.store[shape.props.assetId];
	if (asset?.typeName !== "asset" || asset.type !== "image")
		return invalid("This image asset is unavailable.");
	const match =
		/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
			asset.props.src ?? "",
		);
	if (!match)
		return invalid(
			"Only uploaded PNG, JPEG, GIF and WebP image assets can be read or previewed. External images are not fetched.",
		);
	try {
		const image = await normalizeAgentImage(
			decodeFileBase64(match[2]!, 4 * 1024 * 1024),
		);
		return {
			shapeId,
			name: safeAttachmentName(asset.props.name),
			mimeType: image.mimeType,
			width: image.width,
			height: image.height,
			data: image.bytes.toString("base64"),
		};
	} catch {
		return invalid("The image is invalid or exceeds the image size limits.");
	}
}

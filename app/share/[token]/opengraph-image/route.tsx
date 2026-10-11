import { ImageResponse } from "next/og";
import { SharedPagePreviewImage } from "@/features/shares/components/shared-page-preview-image";
import { SHARED_PAGE_IMAGE_SIZE } from "@/features/shares/lib/page-preview";
import { getSharedPageOrNotFound } from "../_data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ token: string }> },
) {
	const { token } = await params;
	const page = await getSharedPageOrNotFound(token);
	return new ImageResponse(<SharedPagePreviewImage page={page} />, {
		...SHARED_PAGE_IMAGE_SIZE,
		// Check the live share on every request, including old versioned URLs.
		headers: { "Cache-Control": "private, no-store" },
	});
}

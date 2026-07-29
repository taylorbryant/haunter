"use client";

import { type ComponentProps, useEffect, useState } from "react";
import { Tldraw } from "tldraw";
import {
	preloadTldrawFonts,
	requiredTldrawFontFaces,
	tldrawFontFaceKey,
} from "@/features/canvases/client/tldraw-fonts";

type Props = ComponentProps<typeof Tldraw> & {
	documentSnapshot?: {
		store?: Record<string, unknown>;
	};
};

export function TldrawWithFonts({ documentSnapshot, ...props }: Props) {
	// The gate is only for the editor's first measurement pass. Later snapshot
	// updates come from this mounted editor; reacting to them here would
	// temporarily unmount tldraw in the middle of an autosave.
	const [faces] = useState(() => requiredTldrawFontFaces(documentSnapshot));
	const fontKey = faces.map(tldrawFontFaceKey).join("|");
	const [loadedFontKey, setLoadedFontKey] = useState<string | null>(
		faces.length === 0 ? fontKey : null,
	);

	useEffect(() => {
		if (faces.length === 0) {
			setLoadedFontKey(fontKey);
			return;
		}
		let cancelled = false;
		void preloadTldrawFonts(document, faces).then(() => {
			if (!cancelled) setLoadedFontKey(fontKey);
		});
		return () => {
			cancelled = true;
		};
	}, [faces, fontKey]);

	if (loadedFontKey !== fontKey) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
				Loading canvas…
			</div>
		);
	}

	return <Tldraw {...props} />;
}

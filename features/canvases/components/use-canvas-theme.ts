"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "tldraw";
import { createCanvasTheme } from "@/features/canvases/lib/canvas-themes";
import { getResolvedThemeColorScheme } from "@/lib/themes";

/** Keep tldraw's internal controls in step with Haunter's named app themes. */
export function useCanvasTheme(resolvedTheme: string | undefined) {
	const editorRef = useRef<Editor | null>(null);
	const colorScheme = getResolvedThemeColorScheme(resolvedTheme);

	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return;
		editor.updateTheme(createCanvasTheme(resolvedTheme));
		editor.user.updateUserPreferences({ colorScheme });
	}, [colorScheme, resolvedTheme]);

	return useCallback(
		(editor: Editor) => {
			editorRef.current = editor;
			editor.updateTheme(createCanvasTheme(resolvedTheme));
			editor.user.updateUserPreferences({ colorScheme });
		},
		[colorScheme, resolvedTheme],
	);
}

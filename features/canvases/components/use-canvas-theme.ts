"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "tldraw";
import { getResolvedThemeColorScheme } from "@/lib/themes";

/** Keep tldraw's internal controls in step with Haunter's named app themes. */
export function useCanvasTheme(resolvedTheme: string | undefined) {
	const editorRef = useRef<Editor | null>(null);
	const colorScheme = getResolvedThemeColorScheme(resolvedTheme);

	useEffect(() => {
		editorRef.current?.user.updateUserPreferences({ colorScheme });
	}, [colorScheme]);

	return useCallback(
		(editor: Editor) => {
			editorRef.current = editor;
			editor.user.updateUserPreferences({ colorScheme });
		},
		[colorScheme],
	);
}

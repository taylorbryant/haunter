import type { ExtensionFactoryInstance } from "@blocknote/core";
import {
	type CollaborationOptions,
	withCollaboration,
} from "@blocknote/core/yjs";

/**
 * Installs BlockNote's Yjs extensions for a shared document.
 *
 * A plain `collaboration` property is not an editor option in BlockNote 0.52+;
 * without this wrapper the editor silently renders its default empty paragraph.
 */
export function withHaunterCollaboration<Options extends object>(
	options: Options,
	collaboration: CollaborationOptions,
) {
	return withCollaboration({
		...options,
		collaboration,
	} as never) as unknown as Options & {
		collaboration: CollaborationOptions;
		disableExtensions: string[];
		extensions: ExtensionFactoryInstance[];
		initialContent: Array<{ type: "paragraph"; id: "initialBlockId" }>;
	};
}

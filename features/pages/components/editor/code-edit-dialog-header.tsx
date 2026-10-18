import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { DialogClose } from "@/components/ui/dialog";
import { CODE_BLOCK_LANGUAGES } from "@/features/pages/lib/code-block-language";

export function CodeEditDialogHeader({
	language,
	editable,
	onLanguageChange,
	children,
}: {
	language: string;
	editable: boolean;
	onLanguageChange: (language: string) => void;
	children?: ReactNode;
}) {
	return (
		<div className="haunter-code-block-header">
			<select
				aria-label="Code language"
				value={language}
				disabled={!editable}
				onChange={(event) => onLanguageChange(event.target.value)}
			>
				{CODE_BLOCK_LANGUAGES.map((option) => (
					<option key={option.id} value={option.id}>
						{option.label}
					</option>
				))}
			</select>
			{children}
			<DialogClose
				render={
					<button
						type="button"
						aria-label="Close code editor"
						className="haunter-code-block-expand keyboard-focus-ring relative"
					/>
				}
			>
				<span
					aria-hidden="true"
					className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
				/>
				<XIcon aria-hidden="true" className="size-4" />
			</DialogClose>
		</div>
	);
}

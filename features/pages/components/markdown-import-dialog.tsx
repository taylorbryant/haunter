"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { userErrorMessage } from "@/client/error-feedback";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSidebar } from "@/components/ui/sidebar";
import {
	isMarkdownFilename,
	MAX_MARKDOWN_IMPORT_BYTES,
	MAX_MARKDOWN_IMPORT_FILES,
	MarkdownImportError,
	pageTitleFromMarkdownFilename,
	parseMarkdownPage,
} from "@/features/pages/client/markdown-files";
import {
	createPageMutationOptions,
	invalidatePages,
} from "@/features/pages/client/queries";
import { invalidateTasksWhenIdle } from "@/features/tasks/client/queries";

function formatFileSize(bytes: number): string {
	if (bytes < 1_000) return `${bytes} B`;
	if (bytes < 1_000_000) return `${Math.ceil(bytes / 1_000)} KB`;
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function MarkdownImportDialog({
	workspaceId,
	onOpenChange,
}: {
	workspaceId: string;
	onOpenChange: (open: boolean) => void;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { isMobile, setOpenMobile, setSuppressMobileFinalFocus } = useSidebar();
	const createMutation = useMutation({
		...createPageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [files, setFiles] = useState<File[]>([]);
	const [progress, setProgress] = useState(0);
	const [importing, setImporting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	function chooseFiles(selected: FileList | null) {
		setError(null);
		setProgress(0);
		const next = Array.from(selected ?? []);
		if (next.length > MAX_MARKDOWN_IMPORT_FILES) {
			setFiles([]);
			setError(
				`Choose no more than ${MAX_MARKDOWN_IMPORT_FILES} files at once.`,
			);
			return;
		}
		const unsupported = next.find((file) => !isMarkdownFilename(file.name));
		if (unsupported) {
			setFiles([]);
			setError(`${unsupported.name} is not a Markdown file.`);
			return;
		}
		const oversized = next.find(
			(file) => file.size > MAX_MARKDOWN_IMPORT_BYTES,
		);
		if (oversized) {
			setFiles([]);
			setError(`${oversized.name} is larger than the 1 MB import limit.`);
			return;
		}
		setFiles(next);
	}

	async function importFiles() {
		if (files.length === 0 || importing) return;
		setImporting(true);
		setError(null);
		setProgress(0);
		let imported = 0;
		let lastPageId: string | null = null;

		try {
			for (const file of files) {
				const markdown = await file.text();
				const page = await createMutation.mutateAsync({
					body: {
						workspaceId,
						title: pageTitleFromMarkdownFilename(file.name),
						initialContent: parseMarkdownPage(markdown),
					},
				});
				imported += 1;
				lastPageId = page.id;
				setProgress(imported);
			}

			await Promise.all([
				invalidatePages(queryClient),
				invalidateTasksWhenIdle(queryClient),
			]);
			onOpenChange(false);
			if (lastPageId) {
				if (isMobile) {
					setSuppressMobileFinalFocus(true);
					setOpenMobile(false);
				}
				router.push(`/w/${workspaceId}/p/${lastPageId}`);
			}
		} catch (importError) {
			if (imported > 0) {
				setFiles((current) => current.slice(imported));
				await Promise.all([
					invalidatePages(queryClient),
					invalidateTasksWhenIdle(queryClient),
				]);
			}
			const message =
				importError instanceof MarkdownImportError
					? importError.message
					: userErrorMessage(
							importError,
							"The Markdown file could not be imported.",
						);
			setError(
				imported > 0
					? `${imported} ${imported === 1 ? "page was" : "pages were"} imported. ${message}`
					: message,
			);
		} finally {
			setImporting(false);
		}
	}

	return (
		<ResponsiveDialog
			open
			onOpenChange={(open) => {
				if (!importing) onOpenChange(open);
			}}
			title="Import Markdown"
			description="Each Markdown file becomes a new page in this workspace. Headings, lists, tasks, code blocks, quotes, dividers, and links are supported. Images stay linked; bundled assets are not uploaded."
			className="sm:max-w-md"
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="markdown-files">Markdown files</Label>
					<Input
						id="markdown-files"
						type="file"
						accept=".md,.markdown,text/markdown"
						multiple
						disabled={importing}
						onChange={(event) => chooseFiles(event.target.files)}
					/>
					<p className="text-muted-foreground text-xs">
						Up to {MAX_MARKDOWN_IMPORT_FILES} files, 1 MB each.
					</p>
				</div>

				{files.length > 0 ? (
					<ul className="max-h-40 divide-y overflow-y-auto rounded-lg border px-3">
						{files.map((file) => (
							<li
								key={`${file.name}:${file.lastModified}`}
								className="flex items-center gap-2 py-2 text-sm"
							>
								<FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">{file.name}</span>
								<span className="shrink-0 text-muted-foreground text-xs">
									{formatFileSize(file.size)}
								</span>
							</li>
						))}
					</ul>
				) : null}

				{importing ? (
					<p aria-live="polite" className="text-muted-foreground text-sm">
						Importing {Math.min(progress + 1, files.length)} of {files.length}…
					</p>
				) : null}
				{error ? (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				) : null}
			</div>

			<ResponsiveDialogFooter>
				<Button
					type="button"
					variant="outline"
					disabled={importing}
					onClick={() => onOpenChange(false)}
				>
					Cancel
				</Button>
				<Button
					type="button"
					disabled={files.length === 0 || importing}
					onClick={() => void importFiles()}
				>
					{importing
						? "Importing…"
						: `Import${files.length > 1 ? ` ${files.length} pages` : ""}`}
				</Button>
			</ResponsiveDialogFooter>
		</ResponsiveDialog>
	);
}

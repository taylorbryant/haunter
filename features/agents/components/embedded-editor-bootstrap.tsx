"use client";
import { useEffect, useState, type ReactNode } from "react";
import { installSessionCredential } from "@/client/session-recovery";
import { AppSessionProvider } from "@/components/app-session-provider";
import { ActiveWorkspaceHintProvider } from "@/components/active-workspace-provider";
import { DeviceTimeProvider } from "@/components/device-time-provider";
import { pendingDeviceTime } from "@/lib/device-timezone";
import { Button } from "@/components/ui/button";
import { GhostLogo } from "@/components/ghost-logo";
import { createEmbeddedEditorAuth } from "../client/embedded-editor-auth";
import type { EmbeddedEditorIdentity } from "../embedded-editor-session";
import { readBridge, send } from "./embedded-editor-frame";
import dynamic from "next/dynamic";
import { EmbeddedPageEditor } from "./embedded-page-editor";
const EmbeddedCanvasEditor = dynamic(
	() =>
		import("./embedded-canvas-editor").then(
			(module) => module.EmbeddedCanvasEditor,
		),
	{ ssr: false },
);

export function EmbeddedEditorBootstrap({
	workspaceId,
	pageId,
	canvasId,
	workspace = false,
	children,
}: {
	workspaceId: string;
	pageId?: string;
	canvasId?: string;
	workspace?: boolean;
	children?: ReactNode;
}) {
	const [auth] = useState(() =>
		createEmbeddedEditorAuth(workspace ? workspaceId : undefined),
	);
	const [identity, setIdentity] = useState<EmbeddedEditorIdentity>();
	const [error, setError] = useState("");
	const [attempt, setAttempt] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: an explicit retry starts another authorization exchange
	useEffect(() => {
		let active = true;
		let uninstall: (() => void) | undefined;
		setError("");
		void auth
			.renew()
			.then((next) => {
				if (!active) return;
				if (
					next.workspaceId !== workspaceId ||
					(workspace
						? next.scope !== "workspace" ||
							next.pageId !== null ||
							next.canvasId !== undefined
						: canvasId
							? next.canvasId !== canvasId || next.pageId !== null
							: next.pageId !== pageId || next.canvasId !== undefined)
				)
					throw new Error("Haunter authorized a different document.");
				uninstall = installSessionCredential(() => auth.token());
				setIdentity(next);
			})
			.catch((cause: unknown) => {
				if (active) {
					send(readBridge(), {
						type: "haunter/editor/status",
						status: "access-denied",
					});
					setError(
						cause instanceof Error
							? cause.message
							: "Haunter could not open the editor.",
					);
				}
			});
		return () => {
			active = false;
			uninstall?.();
		};
	}, [auth, workspaceId, pageId, canvasId, workspace, attempt]);
	if (!identity)
		return (
			<main className="grid min-h-svh place-content-center place-items-center gap-4 bg-background p-6 text-center text-foreground">
				<GhostLogo className="size-8" />
				<p className="max-w-md" role={error ? "alert" : "status"}>
					{error || "Connecting to Haunter…"}
				</p>
				{error ? (
					<Button onClick={() => setAttempt((value) => value + 1)}>
						Retry
					</Button>
				) : null}
			</main>
		);
	return (
		<DeviceTimeProvider
			initialValue={pendingDeviceTime(Date.now())}
			persistCookie={false}
		>
			<AppSessionProvider
				value={{
					user: identity.user,
					activeWorkspaceId: identity.workspaceId,
					workspaceRole: identity.role,
					isAdmin: false,
				}}
				embedded
				verifySession={(signal, recover) => auth.verify(signal, recover)}
			>
				<ActiveWorkspaceHintProvider value={identity.workspaceId}>
					{children ??
						(canvasId ? (
							<EmbeddedCanvasEditor
								workspaceId={workspaceId}
								canvasId={canvasId}
							/>
						) : pageId ? (
							<EmbeddedPageEditor
								workspaceId={workspaceId}
								pageId={pageId}
								scoped
							/>
						) : null)}
				</ActiveWorkspaceHintProvider>
			</AppSessionProvider>
		</DeviceTimeProvider>
	);
}

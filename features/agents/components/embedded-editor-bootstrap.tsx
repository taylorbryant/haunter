"use client";
import { useEffect, useState } from "react";
import { installSessionCredential } from "@/client/session-recovery";
import { AppSessionProvider } from "@/components/app-session-provider";
import { ActiveWorkspaceHintProvider } from "@/components/active-workspace-provider";
import { DeviceTimeProvider } from "@/components/device-time-provider";
import { pendingDeviceTime } from "@/lib/device-timezone";
import { Button } from "@/components/ui/button";
import { GhostLogo } from "@/components/ghost-logo";
import { createEmbeddedEditorAuth } from "../client/embedded-editor-auth";
import type { EmbeddedEditorIdentity } from "../embedded-editor-session";
import { EmbeddedPageEditor } from "./embedded-page-editor";

export function EmbeddedEditorBootstrap({
	workspaceId,
	pageId,
}: {
	workspaceId: string;
	pageId: string;
}) {
	const [auth] = useState(createEmbeddedEditorAuth);
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
				if (next.workspaceId !== workspaceId || next.pageId !== pageId)
					throw new Error("Haunter authorized a different page.");
				uninstall = installSessionCredential(() => auth.token());
				setIdentity(next);
			})
			.catch((cause: unknown) => {
				if (active)
					setError(
						cause instanceof Error
							? cause.message
							: "Haunter could not open the editor.",
					);
			});
		return () => {
			active = false;
			uninstall?.();
		};
	}, [auth, workspaceId, pageId, attempt]);
	if (!identity)
		return (
			<main className="grid min-h-svh place-content-center gap-4 bg-background p-6 text-foreground">
				<GhostLogo className="size-8" />
				<p role={error ? "alert" : undefined}>
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
		<DeviceTimeProvider initialValue={pendingDeviceTime(Date.now())}>
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
					<EmbeddedPageEditor
						workspaceId={workspaceId}
						pageId={pageId}
						scoped
					/>
				</ActiveWorkspaceHintProvider>
			</AppSessionProvider>
		</DeviceTimeProvider>
	);
}

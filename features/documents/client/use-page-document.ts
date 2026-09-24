"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
	acquirePageDocument,
	type PageDocumentSession,
	type DocumentSnapshot,
} from "./session";

const empty: DocumentSnapshot = {
	generation: 0,
	restoring: false,
	recoveries: [],
	resetReason: null,
	recoveryNoticeDismissed: false,
	ready: false,
	connected: false,
	saved: false,
	locallySaved: true,
	paused: false,
	error: null,
	storageError: false,
	readySource: null,
	readyMs: null,
	revision: 0,
	tasksRevision: 0,
	linksRevision: 0,
};
const subscribeEmpty = () => () => {};
const getEmpty = () => empty;

export function usePageDocument(options: PageDocumentSession["options"]) {
	const [session, setSession] = useState<PageDocumentSession | null>(null);
	const { userId, workspaceId, pageId, url } = options;
	useEffect(() => {
		const acquired = acquirePageDocument({
			userId,
			workspaceId,
			pageId,
			url,
		});
		setSession(acquired.session);
		return acquired.release;
	}, [userId, workspaceId, pageId, url]);
	const snapshot = useSyncExternalStore(
		session?.subscribe ?? subscribeEmpty,
		session?.getSnapshot ?? getEmpty,
		getEmpty,
	);
	return { session, snapshot };
}

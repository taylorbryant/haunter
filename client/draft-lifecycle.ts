import { draftRegistry } from "./draft-registry";

export function installDraftLifecycle(userId: string) {
	const flush = () => {
		void draftRegistry.flushLocal(userId);
	};
	const visibility = () => {
		if (document.visibilityState === "hidden") flush();
	};
	const beforeUnload = (event: BeforeUnloadEvent) => {
		if (!draftRegistry.hasVolatileChanges(userId)) return;
		flush();
		event.preventDefault();
		event.returnValue = "";
	};
	let guarded = false;
	const synchronizeGuard = () => {
		const next = draftRegistry.hasVolatileChanges(userId);
		if (next === guarded) return;
		guarded = next;
		if (guarded) window.addEventListener("beforeunload", beforeUnload);
		else window.removeEventListener("beforeunload", beforeUnload);
	};
	const approved = new WeakSet<HTMLAnchorElement>();
	const navigate = (event: MouseEvent) => {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		)
			return;
		const target =
			event.target instanceof Element ? event.target.closest("a[href]") : null;
		if (
			!(target instanceof HTMLAnchorElement) ||
			target.target === "_blank" ||
			target.hasAttribute("download")
		)
			return;
		if (approved.delete(target) || !draftRegistry.hasVolatileChanges(userId))
			return;
		event.preventDefault();
		event.stopPropagation();
		void draftRegistry.flushLocal(userId).then((saved) => {
			if (saved && target.isConnected) {
				approved.add(target);
				target.click();
			}
		});
	};
	const unsubscribe = draftRegistry.subscribe(synchronizeGuard);
	synchronizeGuard();
	window.addEventListener("pagehide", flush);
	document.addEventListener("visibilitychange", visibility);
	document.addEventListener("click", navigate, true);
	return () => {
		flush();
		unsubscribe();
		window.removeEventListener("beforeunload", beforeUnload);
		window.removeEventListener("pagehide", flush);
		document.removeEventListener("visibilitychange", visibility);
		document.removeEventListener("click", navigate, true);
	};
}

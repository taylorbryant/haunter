const STATE_KEY = "haunterWorkspaceScroll";
const STORAGE_KEY = `${STATE_KEY}Positions`;
const positions = new Map<string, { left: number; top: number }>();

type Entry = {
	id: string;
	href: string;
	left: number;
	top: number;
};

function readEntry(): Entry | null {
	const value = window.history.state?.[STATE_KEY];
	return value &&
		typeof value.id === "string" &&
		value.href === window.location.href &&
		Number.isFinite(value.left) &&
		Number.isFinite(value.top)
		? value
		: null;
}

/** Restore the workspace scroller while preserving the router's history state. */
export function installWorkspaceScrollRestoration(area: HTMLElement) {
	try {
		const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
		for (const [id, position] of saved) {
			if (
				typeof id === "string" &&
				Number.isFinite(position?.left) &&
				Number.isFinite(position?.top) &&
				!positions.has(id)
			)
				positions.set(id, position);
		}
	} catch {
		// History state still works when session storage is unavailable.
	}
	const previousRestoration = window.history.scrollRestoration;
	window.history.scrollRestoration = "manual";
	let entry: Entry;
	let historyState = window.history.state;
	let pending: (() => boolean) | undefined;
	let frame = 0;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	const observer = new MutationObserver(() => schedule());
	const resize = new ResizeObserver(() => schedule());

	function write() {
		clearTimeout(saveTimer);
		if (!entry || entry.href !== window.location.href || pending) return;
		const position = positions.get(entry.id) ?? entry;
		historyState = {
			...(window.history.state ?? historyState),
			[STATE_KEY]: { ...entry, ...position },
		};
		window.history.replaceState(historyState, "");
		try {
			// Reload may snapshot history.state before pagehide. Keep the final
			// position by entry id so it survives that document transition too.
			sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...positions]));
		} catch {
			// Retain in-memory restoration if storage is disabled or full.
		}
	}

	function remember() {
		if (!entry || entry.href !== window.location.href || pending) return;
		positions.set(entry.id, { left: area.scrollLeft, top: area.scrollTop });
		// Keep rapid scrolling in memory; persist after it settles or before leaving.
		clearTimeout(saveTimer);
		saveTimer = setTimeout(write, 150);
	}

	function flush() {
		// Navigation can happen before the last scroll event has been delivered.
		remember();
		write();
	}

	function stop() {
		pending = undefined;
		cancelAnimationFrame(frame);
		clearTimeout(deadline);
		observer.disconnect();
		resize.disconnect();
	}

	function schedule() {
		if (!pending) return;
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			const url = new URL(entry.href);
			const search = url.searchParams.toString();
			if (
				area.dataset.scrollRoute !==
				url.pathname + (search ? `?${search}` : "")
			)
				return;
			// Editor bodies and images can arrive after the route's loading shell.
			for (const child of area.children) resize.observe(child);
			if (pending?.()) {
				stop();
				remember();
				write();
			}
		});
	}

	function restore(saved: Entry | null) {
		stop();
		const position = saved && (positions.get(saved.id) ?? saved);
		if (position) {
			pending = () => {
				area.scrollTo({ ...position, behavior: "instant" });
				return (
					Math.abs(area.scrollTop - position.top) < 1 &&
					Math.abs(area.scrollLeft - position.left) < 1
				);
			};
		} else if (window.location.hash || window.location.href.endsWith("#")) {
			let hash = window.location.hash.slice(1);
			try {
				hash = decodeURIComponent(hash);
			} catch {
				// A malformed escape is still a valid literal element id.
			}
			pending = () => {
				if (!hash || hash === "top") {
					area.scrollTo({ top: 0, left: 0, behavior: "instant" });
					return true;
				}
				const target =
					document.getElementById(hash) ?? document.getElementsByName(hash)[0];
				if (!target || !area.contains(target)) return false;
				area.scrollTo({
					top:
						area.scrollTop +
						target.getBoundingClientRect().top -
						area.getBoundingClientRect().top,
					behavior: "instant",
				});
				return true;
			};
		}
		if (!pending) return;
		observer.observe(area, {
			childList: true,
			subtree: true,
			attributes: true,
		});
		resize.observe(area);
		// Missing anchors or content that was shortened must not hold a scroll lock.
		deadline = setTimeout(() => {
			stop();
			remember();
			write();
		}, 10_000);
		schedule();
	}

	function activate(restorePosition: boolean) {
		stop();
		const saved = readEntry();
		const previousUrl = entry && new URL(entry.href);
		// Native fragment navigation starts with null state. Preserve the router's
		// existing state for that same document instead of turning it into an
		// unrecognized history entry that Next would reload on traversal.
		if (
			window.history.state !== null ||
			previousUrl?.pathname !== window.location.pathname ||
			previousUrl?.search !== window.location.search
		) {
			historyState = window.history.state;
		}
		entry = saved ?? {
			id: crypto.randomUUID(),
			href: window.location.href,
			left: area.scrollLeft,
			top: area.scrollTop,
		};
		if (!positions.has(entry.id)) positions.set(entry.id, entry);
		if (positions.size > 100) {
			const oldest = positions.keys().next().value;
			if (oldest) positions.delete(oldest);
		}
		const onlySearchChanged =
			previousUrl?.pathname === window.location.pathname &&
			previousUrl.hash === window.location.hash &&
			previousUrl.href.endsWith("#") === window.location.href.endsWith("#");
		if (restorePosition || !onlySearchChanged)
			restore(restorePosition ? saved : null);
		write();
	}

	function sync() {
		if (entry.href !== window.location.href) activate(false);
		else schedule();
	}
	const traverse = () => activate(true);
	const interrupt = () => {
		stop();
		remember();
		// If an anchor was still pending, establish this history entry before
		// a quick Back/Forward can leave it; subsequent scroll events update it.
		write();
	};
	const keydown = (event: KeyboardEvent) => {
		if (
			[
				"ArrowUp",
				"ArrowDown",
				"PageUp",
				"PageDown",
				"Home",
				"End",
				" ",
			].includes(event.key)
		)
			interrupt();
	};
	const visibility = () => {
		if (document.visibilityState === "hidden") flush();
	};
	activate(true);
	area.addEventListener("scroll", remember, { passive: true });
	area.addEventListener("wheel", interrupt, { passive: true });
	area.addEventListener("touchstart", interrupt, { passive: true });
	area.addEventListener("pointerdown", interrupt);
	area.addEventListener("keydown", keydown);
	document.addEventListener("click", flush, true);
	document.addEventListener("visibilitychange", visibility);
	window.addEventListener("pagehide", flush);
	window.addEventListener("popstate", traverse);
	window.addEventListener("hashchange", sync);
	return {
		sync,
		dispose() {
			write();
			stop();
			clearTimeout(saveTimer);
			window.history.scrollRestoration = previousRestoration;
			area.removeEventListener("scroll", remember);
			area.removeEventListener("wheel", interrupt);
			area.removeEventListener("touchstart", interrupt);
			area.removeEventListener("pointerdown", interrupt);
			area.removeEventListener("keydown", keydown);
			document.removeEventListener("click", flush, true);
			document.removeEventListener("visibilitychange", visibility);
			window.removeEventListener("pagehide", flush);
			window.removeEventListener("popstate", traverse);
			window.removeEventListener("hashchange", sync);
		},
	};
}

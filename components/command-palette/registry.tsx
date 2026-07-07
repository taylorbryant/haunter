"use client";

import {
	type ComponentType,
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";

/**
 * A single action the ⌘K palette can run. Contributed from anywhere in the app
 * via `useCommand`, so a feature owns its own commands next to the UI that
 * implements them (VS Code's contribution model) rather than a central list.
 */
export type Command = {
	/** Stable, unique id, namespaced by area, e.g. "workspace.edit". */
	id: string;
	title: string;
	/** Heading the command is grouped under, e.g. "Workspace". */
	group: string;
	/** Extra space-separated search terms beyond the title. */
	keywords?: string;
	icon?: ComponentType<{ className?: string }>;
	/**
	 * Lower sorts first within a group; commands with the same weight keep
	 * registration order. Defaults to 0.
	 */
	weight?: number;
	run: () => void;
};

type Store = {
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => Command[];
	set: (command: Command) => void;
	remove: (id: string) => void;
};

function createStore(): Store {
	const commands = new Map<string, Command>();
	const listeners = new Set<() => void>();
	// Cached so getSnapshot returns a stable reference between changes, which
	// useSyncExternalStore requires to avoid an infinite render loop.
	let snapshot: Command[] = [];

	function publish() {
		snapshot = Array.from(commands.values());
		for (const listener of listeners) listener();
	}

	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSnapshot() {
			return snapshot;
		},
		set(command) {
			commands.set(command.id, command);
			publish();
		},
		remove(id) {
			if (commands.delete(id)) publish();
		},
	};
}

const CommandRegistryContext = createContext<Store | null>(null);

export function CommandRegistryProvider({ children }: { children: ReactNode }) {
	// One store per provider instance, created once.
	const storeRef = useRef<Store | null>(null);
	if (!storeRef.current) storeRef.current = createStore();

	return (
		<CommandRegistryContext.Provider value={storeRef.current}>
			{children}
		</CommandRegistryContext.Provider>
	);
}

function useStore(): Store {
	const store = useContext(CommandRegistryContext);
	if (!store) {
		throw new Error("useCommand must be used within a CommandRegistryProvider");
	}
	return store;
}

const EMPTY: Command[] = [];

/** The current set of registered commands, live. */
export function useRegisteredCommands(): Command[] {
	const store = useStore();
	return useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY);
}

/**
 * Contribute one command while the calling component is mounted. Pass a falsy
 * value to contribute nothing (e.g. a permission-gated command the caller may
 * not offer) — the number of hook calls stays constant, so this is safe to use
 * conditionally by value.
 *
 * `run` is read through a ref, so it always sees fresh state without
 * re-registering; only the visible metadata re-registers when it changes.
 */
export function useCommand(command: Command | null | false): void {
	const store = useStore();
	const runRef = useRef<(() => void) | undefined>(undefined);
	runRef.current = command ? command.run : undefined;

	const id = command ? command.id : null;
	const title = command ? command.title : null;
	const group = command ? command.group : null;
	const keywords = command ? command.keywords : undefined;
	const icon = command ? command.icon : undefined;
	const weight = command ? command.weight : undefined;

	useEffect(() => {
		if (!id || title == null || group == null) return;
		store.set({
			id,
			title,
			group,
			keywords,
			icon,
			weight,
			run: () => runRef.current?.(),
		});
		return () => store.remove(id);
	}, [store, id, title, group, keywords, icon, weight]);
}

/**
 * Registers a single command and renders nothing. Use this to contribute
 * commands from a dynamic list (map over items to instances), where calling
 * `useCommand` in a loop would break the rules of hooks.
 */
export function CommandRegistration({
	command,
}: {
	command: Command | null | false;
}): null {
	useCommand(command);
	return null;
}

/** Groups commands in a stable order for display, filtered by a query. */
export function useFilteredCommandGroups(
	query: string,
): { group: string; commands: Command[] }[] {
	const commands = useRegisteredCommands();
	return useMemo(() => {
		const needle = query.trim().toLowerCase();
		const matched = commands.filter((command) => {
			if (!needle) return true;
			const haystack =
				`${command.title} ${command.keywords ?? ""}`.toLowerCase();
			return haystack.includes(needle);
		});

		const byGroup = new Map<string, Command[]>();
		for (const command of matched) {
			const list = byGroup.get(command.group) ?? [];
			list.push(command);
			byGroup.set(command.group, list);
		}
		for (const list of byGroup.values()) {
			list.sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));
		}
		return Array.from(byGroup, ([group, groupCommands]) => ({
			group,
			commands: groupCommands,
		}));
	}, [commands, query]);
}

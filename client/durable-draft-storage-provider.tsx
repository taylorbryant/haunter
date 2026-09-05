"use client";

import { createContext, type ReactNode, useContext } from "react";
import {
	browserDurableDraftStorage,
	type DurableDraftStorage,
} from "@/client/durable-drafts";

const DurableDraftStorageContext = createContext<DurableDraftStorage<unknown>>(
	browserDurableDraftStorage,
);

export function DurableDraftStorageProvider({
	storage,
	children,
}: {
	storage: DurableDraftStorage<unknown>;
	children: ReactNode;
}) {
	return (
		<DurableDraftStorageContext.Provider value={storage}>
			{children}
		</DurableDraftStorageContext.Provider>
	);
}

export function useDurableDraftStorage<T>() {
	return useContext(DurableDraftStorageContext) as DurableDraftStorage<T>;
}

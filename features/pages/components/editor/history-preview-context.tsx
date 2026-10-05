"use client";

import { createContext } from "react";

/** Page checkpoints contain canvas references, not historical drawing snapshots. */
export const HistoryPreviewContext = createContext(false);

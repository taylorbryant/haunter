import "@beignet/core/server-only";
import { createUseCase } from "@beignet/core/application";
import type { AppContext } from "@/app-context";

export const useCase = createUseCase<AppContext>();

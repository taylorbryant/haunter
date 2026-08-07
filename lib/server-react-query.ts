import "server-only";

import type { QueryKey } from "@tanstack/react-query";
import { cache } from "react";
import type { AppContext } from "@/app-context";
import { getServer } from "@/server";

type UseCase<TInput, TOutput> = {
	run(args: { ctx: AppContext; input: TInput }): Promise<TOutput>;
};

type QueryOptionsLike = {
	queryKey: QueryKey;
};

export const getAppRequestContext = cache(async () => {
	const server = await getServer();
	return server.createContextFromNext();
});

export function serverUseCaseQueryOptions<
	TInput,
	TOutput,
	TOptions extends QueryOptionsLike,
>(
	options: TOptions,
	useCase: UseCase<TInput, TOutput>,
	ctx: AppContext,
	input: TInput,
): TOptions & { queryFn: () => Promise<TOutput> } {
	return {
		...options,
		queryFn: () => useCase.run({ ctx, input }),
	};
}

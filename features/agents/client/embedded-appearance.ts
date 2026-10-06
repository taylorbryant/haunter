import {
	useMutation,
	useQuery,
	useQueryClient,
	type QueryClient,
} from "@tanstack/react-query";
import { rq } from "@/client";
import { getEmbeddedAppearance, updateEmbeddedAppearance } from "../contracts";
import type { EmbeddedAppearance } from "../schemas";

export const EMBEDDED_APPEARANCE_WRITE_KEY = ["embedded-appearance-write"];

/** Let an in-flight preference save finish before the host releases its session. */
export function waitForEmbeddedAppearanceWrites(queryClient: QueryClient) {
	const cache = queryClient.getMutationCache();
	const pending = cache.findAll({
		mutationKey: EMBEDDED_APPEARANCE_WRITE_KEY,
		status: "pending",
	});
	if (!pending.length) return Promise.resolve(true);
	return new Promise<boolean>((resolve) => {
		const finish = (saved: boolean) => {
			clearTimeout(timer);
			unsubscribe();
			resolve(saved);
		};
		const check = () => {
			if (pending.some((write) => write.state.status === "pending")) return;
			finish(pending.every((write) => write.state.status === "success"));
		};
		const unsubscribe = cache.subscribe(check);
		const timer = setTimeout(() => finish(false), 4500);
		check();
	});
}

export function useEmbeddedAppearance() {
	const queryClient = useQueryClient();
	const options = rq(getEmbeddedAppearance).queryOptions({
		staleTime: Infinity,
		meta: { errorMode: "inline" },
	});
	const query = useQuery(options);
	const mutation = useMutation({
		...rq(updateEmbeddedAppearance).mutationOptions({
			meta: { errorMode: "inline" },
			onMutate: () => queryClient.cancelQueries({ queryKey: options.queryKey }),
			onSuccess: (data) => queryClient.setQueryData(options.queryKey, data),
		}),
		mutationKey: EMBEDDED_APPEARANCE_WRITE_KEY,
	});
	// Apply immediately, but disclose a failed save and retain the choice for retry.
	const pending = mutation.isPending || mutation.isError;
	const theme =
		(pending ? mutation.variables?.body.theme : undefined) ??
		query.data?.theme ??
		"host";
	return {
		theme,
		loading: query.isPending && !query.isError,
		saving: mutation.isPending,
		error: mutation.isError
			? "Couldn’t save your theme."
			: query.isError
				? "Couldn’t load your theme."
				: null,
		change: (next: EmbeddedAppearance["theme"]) =>
			mutation.mutate({ body: { theme: next } }),
		retry: () => {
			if (mutation.isError && mutation.variables)
				mutation.mutate(mutation.variables);
			else void query.refetch();
		},
	};
}

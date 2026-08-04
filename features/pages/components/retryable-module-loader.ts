export function createRetryableModuleLoader<T>(loadModule: () => Promise<T>) {
	let loaded: T | null = null;
	let pending: Promise<T> | null = null;

	return {
		get loaded() {
			return loaded;
		},
		load(): Promise<T> {
			if (loaded) return Promise.resolve(loaded);
			if (!pending) {
				pending = loadModule()
					.then((module) => {
						loaded = module;
						return module;
					})
					.catch((error) => {
						// Chunk downloads can fail transiently or point at a deployment that
						// has just been replaced. A rejected promise must not poison retries.
						pending = null;
						throw error;
					});
			}
			return pending;
		},
	};
}

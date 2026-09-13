export type WorkspaceEventStreamLeasePort = {
	isConfigured(): boolean;
	acquire(input: {
		userId: string;
		maxConnections: number;
		ttlMs: number;
	}): Promise<{ release(): Promise<void> } | null>;
};

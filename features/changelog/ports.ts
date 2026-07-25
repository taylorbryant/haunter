export interface ChangelogStateRepository {
	getLastSeenVersion(userId: string): Promise<string | null>;
	markSeen(userId: string, version: string): Promise<void>;
}

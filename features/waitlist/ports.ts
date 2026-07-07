export type WaitlistEntry = {
	id: string;
	email: string;
	createdAt: string;
	updatedAt: string;
	lastRequestedAt: string;
};

export type NewWaitlistEntry = {
	email: string;
};

export interface WaitlistRepository {
	hasAccount(email: string): Promise<boolean>;
	join(input: NewWaitlistEntry): Promise<WaitlistEntry>;
}


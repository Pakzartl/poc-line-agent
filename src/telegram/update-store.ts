export type TelegramUpdateStore = {
	has(updateId: string): Promise<boolean>;
	mark(updateId: string): Promise<void>;
};

type KvUpdateNamespace = {
	get(key: string): Promise<string | null>;
	put(
		key: string,
		value: string,
		options: { expirationTtl: number },
	): Promise<void>;
};

const processedUpdateTtlSeconds = 86_400;

export function createKvTelegramUpdateStore(
	namespace: KvUpdateNamespace,
): TelegramUpdateStore {
	return {
		async has(updateId) {
			return (await namespace.get(updateKey(updateId))) !== null;
		},
		async mark(updateId) {
			await namespace.put(updateKey(updateId), "processed", {
				expirationTtl: processedUpdateTtlSeconds,
			});
		},
	};
}

export function createPassThroughTelegramUpdateStore(): TelegramUpdateStore {
	return {
		has: async () => false,
		mark: async () => undefined,
	};
}

function updateKey(updateId: string): string {
	return `telegram:update:${updateId}`;
}

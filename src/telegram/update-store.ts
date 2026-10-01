export type TelegramUpdateStore = {
	claim(updateId: string): Promise<boolean>;
	complete(updateId: string): Promise<void>;
	release(updateId: string): Promise<void>;
};

type KvUpdateNamespace = {
	get(key: string): Promise<string | null>;
	put(
		key: string,
		value: string,
		options: { expirationTtl: number },
	): Promise<void>;
	delete(key: string): Promise<void>;
};

const processingUpdateTtlSeconds = 600;
const processedUpdateTtlSeconds = 86_400;

export function createKvTelegramUpdateStore(
	namespace: KvUpdateNamespace,
): TelegramUpdateStore {
	return {
		async claim(updateId) {
			const key = updateKey(updateId);
			if ((await namespace.get(key)) !== null) {
				return false;
			}
			await namespace.put(key, "processing", {
				expirationTtl: processingUpdateTtlSeconds,
			});
			return true;
		},
		async complete(updateId) {
			await namespace.put(updateKey(updateId), "processed", {
				expirationTtl: processedUpdateTtlSeconds,
			});
		},
		async release(updateId) {
			await namespace.delete(updateKey(updateId));
		},
	};
}

export function createPassThroughTelegramUpdateStore(): TelegramUpdateStore {
	return {
		claim: async () => true,
		complete: async () => undefined,
		release: async () => undefined,
	};
}

function updateKey(updateId: string): string {
	return `telegram:update:${updateId}`;
}

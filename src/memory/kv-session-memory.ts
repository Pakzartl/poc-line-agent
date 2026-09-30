import type { ConversationMessage, SessionMemoryStore } from "./types";

type KvSessionNamespace = {
	get<ExpectedValue = unknown>(
		key: string,
		type: "json",
	): Promise<ExpectedValue | null>;
	put(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
};

type StoredMemory = {
	version: 1;
	updatedAt: string;
	messages: ConversationMessage[];
};

export function createKvSessionMemoryStore(
	namespace: KvSessionNamespace,
	maxMessages: number,
): SessionMemoryStore {
	return {
		async read(sessionId) {
			return readMessages(namespace, await sessionKey(sessionId));
		},
		async append(sessionId, messages) {
			const key = await sessionKey(sessionId);
			const existing = await readMessages(namespace, key);
			const storedMessages = [...existing, ...messages].slice(-maxMessages);
			const memory: StoredMemory = {
				version: 1,
				updatedAt: new Date().toISOString(),
				messages: storedMessages,
			};

			await namespace.put(key, JSON.stringify(memory));
			return storedMessages;
		},
		async clear(sessionId) {
			await namespace.delete(await sessionKey(sessionId));
		},
	};
}

async function readMessages(
	namespace: KvSessionNamespace,
	key: string,
): Promise<ConversationMessage[]> {
	const stored = await namespace.get(key, "json");
	if (!isStoredMemory(stored)) {
		return [];
	}

	return stored.messages.filter(isConversationMessage);
}

async function sessionKey(sessionId: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(sessionId),
	);
	const hash = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");

	return `session:${hash.slice(0, 32)}`;
}

function isStoredMemory(value: unknown): value is StoredMemory {
	return (
		typeof value === "object" &&
		value !== null &&
		"version" in value &&
		value.version === 1 &&
		"messages" in value &&
		Array.isArray(value.messages)
	);
}

function isConversationMessage(value: unknown): value is ConversationMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		"role" in value &&
		(value.role === "user" || value.role === "assistant") &&
		"content" in value &&
		typeof value.content === "string"
	);
}

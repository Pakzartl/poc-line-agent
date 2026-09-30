import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ConversationMessage, SessionMemoryStore } from "./types";

export type SessionMemoryOptions = {
	directory: string;
	maxMessages: number;
};

type StoredMemory = {
	version: 1;
	updatedAt: string;
	messages: ConversationMessage[];
};

export function createSessionMemoryStore(
	options: SessionMemoryOptions,
): SessionMemoryStore {
	const rootDirectory = resolve(options.directory);
	const pendingWrites = new Map<string, Promise<void>>();

	return {
		async read(sessionId) {
			await pendingWrites.get(sessionId);
			return readStoredMessages(memoryFilePath(rootDirectory, sessionId));
		},
		async append(sessionId, messages) {
			let storedMessages: ConversationMessage[] = [];
			await enqueue(sessionId, async () => {
				const filePath = memoryFilePath(rootDirectory, sessionId);
				const existing = await readStoredMessages(filePath);
				storedMessages = [...existing, ...messages].slice(-options.maxMessages);
				await writeMemory(filePath, storedMessages);
			});
			return storedMessages;
		},
		async clear(sessionId) {
			await enqueue(sessionId, async () => {
				await rm(dirname(memoryFilePath(rootDirectory, sessionId)), {
					recursive: true,
					force: true,
				});
			});
		},
	};

	async function enqueue(
		sessionId: string,
		operation: () => Promise<void>,
	): Promise<void> {
		const previous = pendingWrites.get(sessionId) ?? Promise.resolve();
		const current = previous.catch(() => undefined).then(operation);
		pendingWrites.set(sessionId, current);
		try {
			await current;
		} finally {
			if (pendingWrites.get(sessionId) === current) {
				pendingWrites.delete(sessionId);
			}
		}
	}
}

function memoryFilePath(rootDirectory: string, sessionId: string): string {
	const directoryName = createHash("sha256")
		.update(sessionId)
		.digest("hex")
		.slice(0, 32);
	return join(rootDirectory, directoryName, "memory.json");
}

async function readStoredMessages(
	filePath: string,
): Promise<ConversationMessage[]> {
	try {
		const stored = JSON.parse(await readFile(filePath, "utf8")) as StoredMemory;
		if (stored.version !== 1 || !Array.isArray(stored.messages)) {
			return [];
		}
		return stored.messages.filter(isConversationMessage);
	} catch (error) {
		if (isMissingFileError(error) || error instanceof SyntaxError) {
			return [];
		}
		throw error;
	}
}

async function writeMemory(
	filePath: string,
	messages: ConversationMessage[],
): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	const memory: StoredMemory = {
		version: 1,
		updatedAt: new Date().toISOString(),
		messages,
	};

	try {
		await writeFile(temporaryPath, JSON.stringify(memory, null, 2), {
			encoding: "utf8",
			mode: 0o600,
		});
		await rename(temporaryPath, filePath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
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

function isMissingFileError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

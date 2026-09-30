import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionMemoryStore } from "./session-memory";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe("session memory store", () => {
	test("persists bounded history under a hashed session directory", async () => {
		const directory = await mkdtemp(join(tmpdir(), "line-agent-memory-"));
		temporaryDirectories.push(directory);
		const sessionId = "user:U123/../../private";
		const store = createSessionMemoryStore({ directory, maxMessages: 4 });

		await store.append(sessionId, [
			{ role: "user", content: "one" },
			{ role: "assistant", content: "two" },
			{ role: "user", content: "three" },
			{ role: "assistant", content: "four" },
			{ role: "user", content: "five" },
			{ role: "assistant", content: "six" },
		]);

		const reloaded = createSessionMemoryStore({ directory, maxMessages: 4 });
		expect(await reloaded.read(sessionId)).toEqual([
			{ role: "user", content: "three" },
			{ role: "assistant", content: "four" },
			{ role: "user", content: "five" },
			{ role: "assistant", content: "six" },
		]);
		const sessionDirectories = await readdir(directory);
		expect(sessionDirectories).toHaveLength(1);
		expect(sessionDirectories[0]).toMatch(/^[a-f0-9]{32}$/);

		await reloaded.clear(sessionId);
		expect(await reloaded.read(sessionId)).toEqual([]);
	});
});

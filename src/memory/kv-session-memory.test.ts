import { describe, expect, test } from "bun:test";
import { createKvSessionMemoryStore } from "./kv-session-memory";

describe("KV session memory store", () => {
	test("stores bounded history under a hashed provider-qualified key", async () => {
		const values = new Map<string, string>();
		const store = createKvSessionMemoryStore(
			{
				async get<ExpectedValue>(key: string) {
					const value = values.get(key);
					return value ? (JSON.parse(value) as ExpectedValue) : null;
				},
				async put(key, value) {
					values.set(key, value);
				},
				async delete(key) {
					values.delete(key);
				},
			},
			2,
		);

		await store.append("telegram:chat:123", [
			{ role: "user", content: "first" },
		]);
		const messages = await store.append("telegram:chat:123", [
			{ role: "assistant", content: "second" },
			{ role: "user", content: "third" },
		]);

		expect(messages).toEqual([
			{ role: "assistant", content: "second" },
			{ role: "user", content: "third" },
		]);
		expect([...values.keys()]).toHaveLength(1);
		expect([...values.keys()][0]).toMatch(/^session:[a-f0-9]{32}$/);
		expect([...values.keys()][0]).not.toContain("telegram:chat:123");
		expect(await store.read("telegram:chat:123")).toEqual(messages);

		await store.clear("telegram:chat:123");
		expect(await store.read("telegram:chat:123")).toEqual([]);
	});
});

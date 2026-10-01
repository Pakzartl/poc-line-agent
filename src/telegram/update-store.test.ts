import { describe, expect, test } from "bun:test";
import { createKvTelegramUpdateStore } from "./update-store";

describe("Telegram update store", () => {
	test("marks processed updates with a 24 hour TTL", async () => {
		const values = new Map<string, string>();
		const writes: { key: string; expirationTtl: number }[] = [];
		const store = createKvTelegramUpdateStore({
			get: async (key) => values.get(key) ?? null,
			put: async (key, value, options) => {
				values.set(key, value);
				writes.push({ key, expirationTtl: options.expirationTtl });
			},
		});

		expect(await store.has("12345")).toBe(false);
		await store.mark("12345");
		expect(await store.has("12345")).toBe(true);
		expect(writes).toEqual([
			{ key: "telegram:update:12345", expirationTtl: 86_400 },
		]);
	});
});

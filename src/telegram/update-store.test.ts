import { describe, expect, test } from "bun:test";
import { createKvTelegramUpdateStore } from "./update-store";

describe("Telegram update store", () => {
	test("claims, completes, and releases updates with bounded TTLs", async () => {
		const values = new Map<string, string>();
		const writes: { key: string; value: string; expirationTtl: number }[] = [];
		const deletes: string[] = [];
		const store = createKvTelegramUpdateStore({
			get: async (key) => values.get(key) ?? null,
			put: async (key, value, options) => {
				values.set(key, value);
				writes.push({ key, value, expirationTtl: options.expirationTtl });
			},
			delete: async (key) => {
				values.delete(key);
				deletes.push(key);
			},
		});

		expect(await store.claim("12345")).toBe(true);
		expect(await store.claim("12345")).toBe(false);
		await store.complete("12345");
		await store.release("12345");
		expect(await store.claim("12345")).toBe(true);
		expect(writes).toEqual([
			{
				key: "telegram:update:12345",
				value: "processing",
				expirationTtl: 3_600,
			},
			{
				key: "telegram:update:12345",
				value: "processed",
				expirationTtl: 86_400,
			},
			{
				key: "telegram:update:12345",
				value: "processing",
				expirationTtl: 3_600,
			},
		]);
		expect(deletes).toEqual(["telegram:update:12345"]);
	});
});

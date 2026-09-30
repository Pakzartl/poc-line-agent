import { describe, expect, test } from "bun:test";
import { createLineSignature, verifyLineSignature } from "./signature";

describe("LINE signature verification", () => {
	test("validates the exact raw request body", () => {
		const rawBody = '{"events":[{"message":{"text":"hello"}}]}';
		const secret = "line-secret";
		const signature = createLineSignature(rawBody, secret);

		expect(verifyLineSignature(rawBody, secret, signature)).toBe(true);
		expect(verifyLineSignature(`${rawBody}\n`, secret, signature)).toBe(false);
	});

	test("rejects missing or malformed signatures", () => {
		expect(verifyLineSignature("{}", "secret", null)).toBe(false);
		expect(verifyLineSignature("{}", "secret", "not-base64")).toBe(false);
	});
});

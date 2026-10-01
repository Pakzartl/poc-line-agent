import { describe, expect, test } from "bun:test";
import { type AppDeps, createAppHandler } from "./app";
import { loadConfig } from "./config";

describe("app routes", () => {
	test("serves a secure status page at the custom-domain root", async () => {
		const response = await createAppHandler(testDeps())(
			new Request("https://agent.pakzartl.xyz/"),
		);
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("content-security-policy")).toContain(
			"default-src 'none'",
		);
		expect(body).toContain("Messaging Agent");
		expect(body).toContain("/health");
	});

	test("keeps unknown routes closed", async () => {
		const response = await createAppHandler(testDeps())(
			new Request("https://agent.pakzartl.xyz/private"),
		);

		expect(response.status).toBe(404);
	});
});

function testDeps(): AppDeps {
	return {
		config: loadConfig({}),
		orchestrator: { answer: async () => "unused" },
		lineReplyClient: { reply: async () => undefined },
		telegramReplyClient: { reply: async () => undefined },
		telegramJobQueue: { send: async () => undefined },
		telegramUpdateStore: {
			claim: async () => true,
			complete: async () => undefined,
			release: async () => undefined,
		},
		whatsAppReplyClient: { reply: async () => undefined },
		memoryStore: {
			read: async () => [],
			append: async (_sessionId, messages) => messages,
			clear: async () => undefined,
		},
	};
}

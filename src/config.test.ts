import { describe, expect, test } from "bun:test";
import { loadConfig, validateConfig } from "./config";

const validEnv = {
	LINE_CHANNEL_SECRET: "line-secret",
	LINE_CHANNEL_ACCESS_TOKEN: "line-token",
	OPENAI_API_KEY: "openai-key",
	GITHUB_OWNER: "superset",
	GITHUB_REPO: "superset",
	GITHUB_TOKEN: "github-token",
};

describe("config validation", () => {
	test("accepts the documented defaults", () => {
		const config = loadConfig(validEnv);
		expect(config.llm.maxToolRounds).toBe(50);
		expect(config.llm.maxToolCalls).toBe(100);
		expect(() => validateConfig(config)).not.toThrow();
	});

	test("accepts up to fifty tool rounds and rejects larger budgets", () => {
		expect(() =>
			validateConfig(loadConfig({ ...validEnv, OPENAI_MAX_TOOL_ROUNDS: "50" })),
		).not.toThrow();
		expect(() =>
			validateConfig(loadConfig({ ...validEnv, OPENAI_MAX_TOOL_ROUNDS: "51" })),
		).toThrow("OPENAI_MAX_TOOL_ROUNDS must be an integer between 0 and 50");
	});

	test("accepts a bounded total tool-call budget", () => {
		expect(() =>
			validateConfig(loadConfig({ ...validEnv, OPENAI_MAX_TOOL_CALLS: "100" })),
		).not.toThrow();
		expect(() =>
			validateConfig(loadConfig({ ...validEnv, OPENAI_MAX_TOOL_CALLS: "201" })),
		).toThrow("OPENAI_MAX_TOOL_CALLS must be an integer between 1 and 200");
	});

	test("accepts Telegram or WhatsApp without LINE credentials", () => {
		const shared = {
			OPENAI_API_KEY: "openai-key",
			GITHUB_OWNER: "superset",
			GITHUB_REPO: "superset",
			GITHUB_TOKEN: "github-token",
		};
		expect(() =>
			validateConfig(
				loadConfig({
					...shared,
					TELEGRAM_BOT_TOKEN: "bot-token",
					TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
					TELEGRAM_ALLOWED_USER_IDS: "123, 456",
				}),
			),
		).not.toThrow();
		expect(
			loadConfig({ TELEGRAM_ALLOWED_USER_IDS: "123, 456" }).telegram
				.allowedUserIds,
		).toEqual(["123", "456"]);
		expect(() =>
			validateConfig(
				loadConfig({
					...shared,
					WHATSAPP_ACCESS_TOKEN: "access-token",
					WHATSAPP_PHONE_NUMBER_ID: "phone-id",
					WHATSAPP_VERIFY_TOKEN: "verify-token",
					WHATSAPP_APP_SECRET: "app-secret",
				}),
			),
		).not.toThrow();
	});

	test("rejects partial provider configuration", () => {
		expect(() =>
			validateConfig(
				loadConfig({
					...validEnv,
					TELEGRAM_BOT_TOKEN: "bot-token",
				}),
			),
		).toThrow("Incomplete Telegram configuration: TELEGRAM_WEBHOOK_SECRET");
	});

	test("rejects missing credentials and invalid numeric values", () => {
		expect(() => validateConfig(loadConfig({}))).toThrow(
			"Missing required environment variables",
		);
		expect(() =>
			validateConfig(loadConfig({ ...validEnv, PORT: "invalid" })),
		).toThrow("PORT must be an integer between 1 and 65535");
		expect(() =>
			validateConfig(
				loadConfig({ ...validEnv, SESSION_MEMORY_MAX_MESSAGES: "1" }),
			),
		).toThrow(
			"SESSION_MEMORY_MAX_MESSAGES must be an integer between 2 and 100",
		);
		expect(() =>
			validateConfig(
				loadConfig({ ...validEnv, TELEGRAM_ALLOWED_USER_IDS: "123, nope" }),
			),
		).toThrow(
			"TELEGRAM_ALLOWED_USER_IDS must contain comma-separated positive integers",
		);
	});
});

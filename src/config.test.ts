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
		expect(() => validateConfig(loadConfig(validEnv))).not.toThrow();
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
	});
});

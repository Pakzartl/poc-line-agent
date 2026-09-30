import architectureSkill from "./skills/architecture.md";
import codeReviewSkill from "./skills/code-review.md";
import debuggingSkill from "./skills/debugging.md";
import { createSkillManager, type SkillName } from "./agent/skill-manager";
import { createAppDeps, createAppHandler } from "./app";
import { loadConfig, validateConfig } from "./config";
import { createKvSessionMemoryStore } from "./memory/kv-session-memory";

const skillDocuments: Readonly<Record<SkillName, string>> = {
	architecture: architectureSkill,
	"code-review": codeReviewSkill,
	debugging: debuggingSkill,
};

export default {
	async fetch(request, env): Promise<Response> {
		try {
			const config = loadConfig(createConfigEnvironment(env));
			validateConfig(config);
			const handler = createAppHandler(
				createAppDeps(config, {
					memoryStore: createKvSessionMemoryStore(
						env.SESSION_MEMORY,
						config.memory.maxMessages,
					),
					skillManager: createSkillManager(
						async (name) => skillDocuments[name],
					),
				}),
			);

			return await handler(request);
		} catch (error) {
			console.error(
				JSON.stringify({
					message: "worker request failed",
					path: new URL(request.url).pathname,
					error: error instanceof Error ? error.message : "Unknown error",
				}),
			);
			return Response.json({ error: "Internal server error" }, { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;

function createConfigEnvironment(env: Env): Record<string, string | undefined> {
	return {
		LINE_CHANNEL_SECRET: env.LINE_CHANNEL_SECRET,
		LINE_CHANNEL_ACCESS_TOKEN: env.LINE_CHANNEL_ACCESS_TOKEN,
		LINE_API_BASE_URL: env.LINE_API_BASE_URL,
		TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
		TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,
		TELEGRAM_ALLOWED_USER_IDS: env.TELEGRAM_ALLOWED_USER_IDS,
		TELEGRAM_API_BASE_URL: env.TELEGRAM_API_BASE_URL,
		WHATSAPP_ACCESS_TOKEN: env.WHATSAPP_ACCESS_TOKEN,
		WHATSAPP_PHONE_NUMBER_ID: env.WHATSAPP_PHONE_NUMBER_ID,
		WHATSAPP_VERIFY_TOKEN: env.WHATSAPP_VERIFY_TOKEN,
		WHATSAPP_APP_SECRET: env.WHATSAPP_APP_SECRET,
		WHATSAPP_API_BASE_URL: env.WHATSAPP_API_BASE_URL,
		OPENAI_API_KEY: env.OPENAI_API_KEY,
		OPENAI_BASE_URL: env.OPENAI_BASE_URL,
		OPENAI_MODEL: env.OPENAI_MODEL,
		OPENAI_MAX_TOOL_ROUNDS: env.OPENAI_MAX_TOOL_ROUNDS,
		GITHUB_TOKEN: env.GITHUB_TOKEN,
		GITHUB_API_BASE_URL: env.GITHUB_API_BASE_URL,
		SESSION_MEMORY_MAX_MESSAGES: env.SESSION_MEMORY_MAX_MESSAGES,
	};
}

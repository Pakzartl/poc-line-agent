import { describe, expect, test } from "bun:test";
import type { AgentOrchestrator } from "../agent/orchestrator";
import { loadConfig } from "../config";
import type {
	ConversationMessage,
	SessionMemoryStore,
} from "../memory/session-memory";
import { createTelegramReplyClient } from "./reply";
import { handleTelegramWebhook } from "./webhook";

describe("Telegram webhook", () => {
	test("verifies the webhook secret, uses session memory, and replies", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
		});
		const history: ConversationMessage[] = [
			{ role: "user", content: "find login" },
			{ role: "assistant", content: "found it" },
		];
		const sessionIds: string[] = [];
		const memoryStore: SessionMemoryStore = {
			read: async (sessionId) => {
				sessionIds.push(sessionId);
				return history;
			},
			append: async (sessionId, messages) => {
				sessionIds.push(sessionId);
				return [...history, ...messages];
			},
			clear: async () => undefined,
		};
		const seenHistory: ConversationMessage[][] = [];
		const orchestrator: AgentOrchestrator = {
			answer: async (_question, previous = []) => {
				seenHistory.push(previous);
				return "commit abc123";
			},
		};
		const replies: unknown[][] = [];

		const response = await handleTelegramWebhook(
			new Request("http://localhost/telegram/webhook", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Telegram-Bot-Api-Secret-Token": "webhook-secret",
				},
				body: JSON.stringify({
					message: {
						message_id: 42,
						text: "what was its commit?",
						chat: { id: -1001 },
					},
				}),
			}),
			{
				config,
				orchestrator,
				memoryStore,
				telegramReplyClient: {
					reply: async (...args) => {
						replies.push(args);
					},
				},
			},
		);

		expect(response.status).toBe(200);
		expect(seenHistory).toEqual([history]);
		expect(sessionIds).toEqual(["telegram:chat:-1001", "telegram:chat:-1001"]);
		expect(replies).toEqual([[-1001, "commit abc123", 42]]);
	});

	test("rejects a missing or invalid webhook secret", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
		});
		const response = await handleTelegramWebhook(
			new Request("http://localhost/telegram/webhook", {
				method: "POST",
				body: "{}",
			}),
			{
				config,
				orchestrator: { answer: async () => "unused" },
				memoryStore: emptyMemoryStore(),
				telegramReplyClient: { reply: async () => undefined },
			},
		);

		expect(response.status).toBe(401);
	});

	test("sends messages through the Telegram Bot API", async () => {
		let request: Request | undefined;
		const client = createTelegramReplyClient({
			botToken: "secret-bot-token",
			apiBaseUrl: "https://telegram.example",
			fetch: Object.assign(
				async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
					request = new Request(input, init);
					return Response.json({ ok: true });
				},
				{ preconnect: fetch.preconnect },
			),
		});

		await client.reply("chat-1", "hello", 7);

		expect(request?.url).toBe(
			"https://telegram.example/botsecret-bot-token/sendMessage",
		);
		expect(await request?.json()).toEqual({
			chat_id: "chat-1",
			text: "hello",
			reply_parameters: { message_id: 7 },
		});
	});
});

function emptyMemoryStore(): SessionMemoryStore {
	return {
		read: async () => [],
		append: async (_sessionId, messages) => messages,
		clear: async () => undefined,
	};
}

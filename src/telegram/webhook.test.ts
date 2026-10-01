import { describe, expect, test } from "bun:test";
import { ResponsesApiError } from "../agent/llm-client";
import type { AgentOrchestrator } from "../agent/orchestrator";
import { loadConfig } from "../config";
import type { ConversationMessage, SessionMemoryStore } from "../memory/types";
import { createTelegramReplyClient } from "./reply";
import { handleTelegramWebhook } from "./webhook";

describe("Telegram webhook", () => {
	test("verifies the webhook secret, uses session memory, and replies", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
			TELEGRAM_ALLOWED_USER_IDS: "9001",
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
						from: { id: 9001 },
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
				telegramUpdateStore: emptyUpdateStore(),
			},
		);

		expect(response.status).toBe(200);
		expect(seenHistory).toEqual([history]);
		expect(sessionIds).toEqual(["telegram:chat:-1001", "telegram:chat:-1001"]);
		expect(replies).toEqual([[-1001, "commit abc123", 42]]);
	});

	test("denies users outside the allowlist before memory or the agent", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
			TELEGRAM_ALLOWED_USER_IDS: "9001",
		});
		let agentCalls = 0;
		let memoryCalls = 0;
		const replies: unknown[][] = [];

		const response = await handleTelegramWebhook(
			telegramRequest({ text: "list repositories", userId: 777, chatId: 777 }),
			{
				config,
				orchestrator: {
					answer: async () => {
						agentCalls += 1;
						return "unused";
					},
				},
				memoryStore: trackingMemoryStore(() => {
					memoryCalls += 1;
				}),
				telegramReplyClient: {
					reply: async (...args) => {
						replies.push(args);
					},
				},
				telegramUpdateStore: emptyUpdateStore(),
			},
		);

		expect(response.status).toBe(200);
		expect(agentCalls).toBe(0);
		expect(memoryCalls).toBe(0);
		expect(replies).toEqual([
			[777, "Access denied. Your Telegram user ID is: 777", 42],
		]);
	});

	test("returns the sender ID for /whoami without using memory or the agent", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
		});
		let agentCalls = 0;
		let memoryCalls = 0;
		const replies: unknown[][] = [];

		await handleTelegramWebhook(
			telegramRequest({ text: "/whoami", userId: 8123, chatId: 8123 }),
			{
				config,
				orchestrator: {
					answer: async () => {
						agentCalls += 1;
						return "unused";
					},
				},
				memoryStore: trackingMemoryStore(() => {
					memoryCalls += 1;
				}),
				telegramReplyClient: {
					reply: async (...args) => {
						replies.push(args);
					},
				},
				telegramUpdateStore: emptyUpdateStore(),
			},
		);

		expect(agentCalls).toBe(0);
		expect(memoryCalls).toBe(0);
		expect(replies).toEqual([[8123, "Your Telegram user ID is: 8123", 42]]);
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
				telegramUpdateStore: emptyUpdateStore(),
			},
		);

		expect(response.status).toBe(401);
	});

	test("acknowledges duplicate updates without calling the agent or replying", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
			TELEGRAM_ALLOWED_USER_IDS: "9001",
		});
		let agentCalls = 0;
		let replyCalls = 0;

		const response = await handleTelegramWebhook(
			telegramRequest({
				text: "list repositories",
				userId: 9001,
				chatId: 9001,
				updateId: 123,
			}),
			{
				config,
				orchestrator: {
					answer: async () => {
						agentCalls += 1;
						return "unused";
					},
				},
				memoryStore: emptyMemoryStore(),
				telegramReplyClient: {
					reply: async () => {
						replyCalls += 1;
					},
				},
				telegramUpdateStore: {
					claim: async (updateId) => updateId !== "123",
					complete: async () => undefined,
					release: async () => undefined,
				},
			},
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, duplicate: true });
		expect(agentCalls).toBe(0);
		expect(replyCalls).toBe(0);
	});

	test("claims an update before starting the agent so webhook retries are deduplicated", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
			TELEGRAM_ALLOWED_USER_IDS: "9001",
		});
		const claimed = new Set<string>();
		let releaseAgent: (() => void) | undefined;
		const agentGate = new Promise<void>((resolve) => {
			releaseAgent = resolve;
		});
		let agentCalls = 0;
		let replyCalls = 0;
		const deps = {
			config,
			orchestrator: {
				answer: async () => {
					agentCalls += 1;
					await agentGate;
					return "done";
				},
			},
			memoryStore: emptyMemoryStore(),
			telegramReplyClient: {
				reply: async () => {
					replyCalls += 1;
				},
			},
			telegramUpdateStore: {
				claim: async (updateId: string) => {
					if (claimed.has(updateId)) {
						return false;
					}
					claimed.add(updateId);
					return true;
				},
				complete: async () => undefined,
				release: async (updateId: string) => {
					claimed.delete(updateId);
				},
			},
		};
		const requestInput = {
			text: "explain the repository",
			userId: 9001,
			chatId: 9001,
			updateId: 789,
		};

		const firstResponse = handleTelegramWebhook(
			telegramRequest(requestInput),
			deps,
		);
		await Promise.resolve();
		const duplicateResponse = await handleTelegramWebhook(
			telegramRequest(requestInput),
			deps,
		);

		expect(await duplicateResponse.json()).toEqual({
			ok: true,
			duplicate: true,
		});
		expect(agentCalls).toBe(1);
		releaseAgent?.();
		expect((await firstResponse).status).toBe(200);
		expect(replyCalls).toBe(1);
	});

	test("acknowledges exhausted OpenAI retries after notifying the user", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
			TELEGRAM_ALLOWED_USER_IDS: "9001",
		});
		const replies: unknown[][] = [];
		const lifecycle: string[] = [];

		const response = await handleTelegramWebhook(
			telegramRequest({
				text: "explain the repository",
				userId: 9001,
				chatId: 9001,
				updateId: 456,
			}),
			{
				config,
				orchestrator: {
					answer: async () => {
						throw new ResponsesApiError({
							status: 429,
							code: "slow_down",
							requestId: "req_exhausted",
							attempts: 3,
							retryable: true,
						});
					},
				},
				memoryStore: emptyMemoryStore(),
				telegramReplyClient: {
					reply: async (...args) => {
						replies.push(args);
					},
				},
				telegramUpdateStore: {
					claim: async (updateId) => {
						lifecycle.push(`claim:${updateId}`);
						return true;
					},
					complete: async (updateId) => {
						lifecycle.push(`complete:${updateId}`);
					},
					release: async () => undefined,
				},
			},
		);

		expect(response.status).toBe(200);
		expect(replies).toHaveLength(1);
		expect(replies[0]?.[1]).toContain("ระบบ AI มีคำขอหนาแน่น");
		expect(lifecycle).toEqual(["claim:456", "complete:456"]);
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
			parse_mode: "HTML",
			reply_parameters: { message_id: 7 },
		});
	});

	test("falls back to readable plain text when Telegram rejects formatting", async () => {
		const bodies: Record<string, unknown>[] = [];
		const client = createTelegramReplyClient({
			botToken: "secret-bot-token",
			apiBaseUrl: "https://telegram.example",
			fetch: Object.assign(
				async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
					const request = new Request(input, init);
					bodies.push((await request.json()) as Record<string, unknown>);
					return bodies.length === 1
						? Response.json({ ok: false }, { status: 400 })
						: Response.json({ ok: true });
				},
				{ preconnect: fetch.preconnect },
			),
		});

		await client.reply("chat-1", "# Title\n**Bold** and `code`", 7);

		expect(bodies).toEqual([
			{
				chat_id: "chat-1",
				text: "<b>Title</b>\n<b>Bold</b> and <code>code</code>",
				parse_mode: "HTML",
				reply_parameters: { message_id: 7 },
			},
			{
				chat_id: "chat-1",
				text: "Title\nBold and code",
				reply_parameters: { message_id: 7 },
			},
		]);
	});
});

function emptyMemoryStore(): SessionMemoryStore {
	return {
		read: async () => [],
		append: async (_sessionId, messages) => messages,
		clear: async () => undefined,
	};
}

function telegramRequest(input: {
	text: string;
	userId: number;
	chatId: number;
	updateId?: number;
}): Request {
	return new Request("http://localhost/telegram/webhook", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Telegram-Bot-Api-Secret-Token": "webhook-secret",
		},
		body: JSON.stringify({
			update_id: input.updateId,
			message: {
				message_id: 42,
				text: input.text,
				from: { id: input.userId },
				chat: { id: input.chatId },
			},
		}),
	});
}

function emptyUpdateStore() {
	return {
		claim: async () => true,
		complete: async () => undefined,
		release: async () => undefined,
	};
}

function trackingMemoryStore(onCall: () => void): SessionMemoryStore {
	return {
		read: async () => {
			onCall();
			return [];
		},
		append: async (_sessionId, messages) => {
			onCall();
			return messages;
		},
		clear: async () => {
			onCall();
		},
	};
}

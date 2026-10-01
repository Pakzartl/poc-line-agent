import { describe, expect, test } from "bun:test";
import { loadConfig } from "../config";
import type { SessionMemoryStore } from "../memory/types";
import type { TelegramJob } from "./job";
import { createTelegramReplyClient } from "./reply";
import { handleTelegramWebhook } from "./webhook";

describe("Telegram webhook", () => {
	test("verifies the webhook secret and enqueues an allowed message", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
			TELEGRAM_ALLOWED_USER_IDS: "9001",
		});
		const jobs: TelegramJob[] = [];

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
				memoryStore: emptyMemoryStore(),
				telegramJobQueue: {
					send: async (job) => {
						jobs.push(job);
					},
				},
				telegramReplyClient: { reply: async () => undefined },
				telegramUpdateStore: emptyUpdateStore(),
			},
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, accepted: true });
		expect(jobs).toEqual([
			{
				chatId: -1001,
				messageId: 42,
				text: "what was its commit?",
				updateId: "message:-1001:42",
			},
		]);
	});

	test("denies users outside the allowlist before memory or the agent", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
			TELEGRAM_ALLOWED_USER_IDS: "9001",
		});
		let queueCalls = 0;
		let clearCalls = 0;
		const replies: unknown[][] = [];

		const response = await handleTelegramWebhook(
			telegramRequest({ text: "/clear-session", userId: 777, chatId: 777 }),
			{
				config,
				memoryStore: {
					...emptyMemoryStore(),
					clear: async () => {
						clearCalls += 1;
					},
				},
				telegramJobQueue: {
					send: async () => {
						queueCalls += 1;
					},
				},
				telegramReplyClient: {
					reply: async (...args) => {
						replies.push(args);
					},
				},
				telegramUpdateStore: emptyUpdateStore(),
			},
		);

		expect(response.status).toBe(200);
		expect(queueCalls).toBe(0);
		expect(clearCalls).toBe(0);
		expect(replies).toEqual([
			[777, "Access denied. Your Telegram user ID is: 777", 42],
		]);
	});

	test("returns the sender ID for /whoami without using memory or the agent", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
		});
		let queueCalls = 0;
		const replies: unknown[][] = [];

		await handleTelegramWebhook(
			telegramRequest({ text: "/whoami", userId: 8123, chatId: 8123 }),
			{
				config,
				memoryStore: emptyMemoryStore(),
				telegramJobQueue: {
					send: async () => {
						queueCalls += 1;
					},
				},
				telegramReplyClient: {
					reply: async (...args) => {
						replies.push(args);
					},
				},
				telegramUpdateStore: emptyUpdateStore(),
			},
		);

		expect(queueCalls).toBe(0);
		expect(replies).toEqual([[8123, "Your Telegram user ID is: 8123", 42]]);
	});

	test("clears the current chat conversation without enqueueing the agent", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
			TELEGRAM_ALLOWED_USER_IDS: "9001",
		});
		const clearedSessions: string[] = [];
		const replies: unknown[][] = [];
		let queueCalls = 0;

		const response = await handleTelegramWebhook(
			telegramRequest({
				text: "/clear-session@megalodon_agent_bot",
				userId: 9001,
				chatId: -1001,
				updateId: 122,
			}),
			{
				config,
				memoryStore: {
					read: async () => [],
					append: async (_sessionId, messages) => messages,
					clear: async (sessionId) => {
						clearedSessions.push(sessionId);
					},
				},
				telegramJobQueue: {
					send: async () => {
						queueCalls += 1;
					},
				},
				telegramReplyClient: {
					reply: async (...args) => {
						replies.push(args);
					},
				},
				telegramUpdateStore: emptyUpdateStore(),
			},
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(clearedSessions).toEqual(["telegram:chat:-1001"]);
		expect(queueCalls).toBe(0);
		expect(replies).toEqual([
			[
				-1001,
				"Conversation cleared. Your next message will start a new session.",
				42,
			],
		]);
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
				memoryStore: emptyMemoryStore(),
				telegramJobQueue: { send: async () => undefined },
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
		let queueCalls = 0;
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
				memoryStore: emptyMemoryStore(),
				telegramJobQueue: {
					send: async () => {
						queueCalls += 1;
					},
				},
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
		expect(queueCalls).toBe(0);
		expect(replyCalls).toBe(0);
	});

	test("claims an update before enqueueing so webhook retries are deduplicated", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
			TELEGRAM_ALLOWED_USER_IDS: "9001",
		});
		const claimed = new Set<string>();
		let releaseQueue: (() => void) | undefined;
		const queueGate = new Promise<void>((resolve) => {
			releaseQueue = resolve;
		});
		let queueCalls = 0;
		let replyCalls = 0;
		const deps = {
			config,
			memoryStore: emptyMemoryStore(),
			telegramJobQueue: {
				send: async () => {
					queueCalls += 1;
					await queueGate;
				},
			},
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
		expect(queueCalls).toBe(1);
		releaseQueue?.();
		expect((await firstResponse).status).toBe(200);
		expect(replyCalls).toBe(0);
	});

	test("acknowledges a long-running update as soon as the queue accepts it", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
			TELEGRAM_ALLOWED_USER_IDS: "9001",
		});
		const jobs: TelegramJob[] = [];

		const response = await handleTelegramWebhook(
			telegramRequest({
				text: "list every custom rate limit",
				userId: 9001,
				chatId: 9001,
				updateId: 790,
			}),
			{
				config,
				memoryStore: emptyMemoryStore(),
				telegramJobQueue: {
					send: async (job) => {
						jobs.push(job);
					},
				},
				telegramReplyClient: { reply: async () => undefined },
				telegramUpdateStore: emptyUpdateStore(),
			},
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, accepted: true });
		expect(jobs).toHaveLength(1);
	});

	test("releases the update claim when enqueueing fails", async () => {
		const config = loadConfig({
			TELEGRAM_BOT_TOKEN: "bot-token",
			TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
			TELEGRAM_ALLOWED_USER_IDS: "9001",
		});
		const released: string[] = [];

		const error = await handleTelegramWebhook(
			telegramRequest({
				text: "list every custom rate limit",
				userId: 9001,
				chatId: 9001,
				updateId: 791,
			}),
			{
				config,
				memoryStore: emptyMemoryStore(),
				telegramJobQueue: {
					send: async () => {
						throw new Error("queue unavailable");
					},
				},
				telegramReplyClient: { reply: async () => undefined },
				telegramUpdateStore: {
					claim: async () => true,
					complete: async () => undefined,
					release: async (updateId) => {
						released.push(updateId);
					},
				},
			},
		).catch((caught) => caught);

		expect(error).toEqual(new Error("queue unavailable"));
		expect(released).toEqual(["791"]);
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

function emptyMemoryStore(): SessionMemoryStore {
	return {
		read: async () => [],
		append: async (_sessionId, messages) => messages,
		clear: async () => undefined,
	};
}

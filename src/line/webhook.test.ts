import { describe, expect, test } from "bun:test";
import type { AgentOrchestrator } from "../agent/orchestrator";
import { loadConfig } from "../config";
import type {
	ConversationMessage,
	SessionMemoryStore,
} from "../memory/session-memory";
import type { LineReplyClient } from "./reply";
import { createLineSignature } from "./signature";
import { extractTextEvents, handleLineWebhook } from "./webhook";

describe("LINE webhook", () => {
	test("extracts LINE text message events", () => {
		expect(
			extractTextEvents({
				events: [
					{
						type: "message",
						replyToken: "reply-1",
						message: { type: "text", text: "why 500?" },
					},
					{ type: "message", replyToken: "reply-2", message: { type: "text" } },
				],
			}),
		).toEqual([{ replyToken: "reply-1", text: "why 500?" }]);
	});

	test("verifies raw body before replying", async () => {
		const rawBody = JSON.stringify({
			events: [
				{
					type: "message",
					replyToken: "reply-token",
					message: { type: "text", text: "why login fails?" },
				},
			],
		});
		const config = loadConfig({
			LINE_CHANNEL_SECRET: "secret",
			LINE_CHANNEL_ACCESS_TOKEN: "line-token",
		});
		const replies: string[] = [];
		const orchestrator: AgentOrchestrator = {
			answer: async (question) => `answer: ${question}`,
		};
		const lineReplyClient: LineReplyClient = {
			reply: async (_replyToken, text) => {
				replies.push(text);
			},
		};
		const memoryStore = createMemoryStore();

		const response = await handleLineWebhook(
			new Request("http://localhost/line/webhook", {
				method: "POST",
				headers: { "x-line-signature": createLineSignature(rawBody, "secret") },
				body: rawBody,
			}),
			{ config, orchestrator, lineReplyClient, memoryStore },
		);

		expect(response.status).toBe(200);
		expect(replies).toEqual(["answer: why login fails?"]);
	});

	test("loads and saves history for the same LINE session", async () => {
		const rawBody = JSON.stringify({
			events: [
				{
					type: "message",
					replyToken: "reply-token",
					source: { type: "user", userId: "U123" },
					message: { type: "text", text: "what was its commit?" },
				},
			],
		});
		const config = loadConfig({
			LINE_CHANNEL_SECRET: "secret",
			LINE_CHANNEL_ACCESS_TOKEN: "line-token",
		});
		const previous: ConversationMessage[] = [
			{ role: "user", content: "find the latest change" },
			{ role: "assistant", content: "I found the latest change." },
		];
		const appended: ConversationMessage[][] = [];
		const memoryStore = createMemoryStore(previous, appended);
		const seenHistory: ConversationMessage[][] = [];
		const orchestrator: AgentOrchestrator = {
			answer: async (_question, history = []) => {
				seenHistory.push(history);
				return "commit abc123";
			},
		};

		const response = await handleLineWebhook(
			new Request("http://localhost/line/webhook", {
				method: "POST",
				headers: { "x-line-signature": createLineSignature(rawBody, "secret") },
				body: rawBody,
			}),
			{
				config,
				orchestrator,
				lineReplyClient: { reply: async () => undefined },
				memoryStore,
			},
		);

		expect(response.status).toBe(200);
		expect(seenHistory).toEqual([previous]);
		expect(appended).toEqual([
			[
				{ role: "user", content: "what was its commit?" },
				{ role: "assistant", content: "commit abc123" },
			],
		]);
	});

	test("does not load or save history when memory is disabled", async () => {
		const rawBody = JSON.stringify({
			events: [
				{
					type: "message",
					replyToken: "reply-token",
					source: { type: "user", userId: "U123" },
					memoryEnabled: false,
					message: { type: "text", text: "one-shot task" },
				},
			],
		});
		const config = loadConfig({
			LINE_CHANNEL_SECRET: "secret",
			LINE_CHANNEL_ACCESS_TOKEN: "line-token",
		});
		let reads = 0;
		let appends = 0;
		const memoryStore: SessionMemoryStore = {
			read: async () => {
				reads += 1;
				return [];
			},
			append: async () => {
				appends += 1;
				return [];
			},
			clear: async () => undefined,
		};

		await handleLineWebhook(
			new Request("http://localhost/line/webhook", {
				method: "POST",
				headers: { "x-line-signature": createLineSignature(rawBody, "secret") },
				body: rawBody,
			}),
			{
				config,
				orchestrator: { answer: async () => "done" },
				lineReplyClient: { reply: async () => undefined },
				memoryStore,
			},
		);

		expect(reads).toBe(0);
		expect(appends).toBe(0);
	});

	test("rejects invalid signatures", async () => {
		const config = loadConfig({ LINE_CHANNEL_SECRET: "secret" });
		const response = await handleLineWebhook(
			new Request("http://localhost/line/webhook", {
				method: "POST",
				headers: { "x-line-signature": "invalid" },
				body: "{}",
			}),
			{
				config,
				orchestrator: { answer: async () => "unused" },
				lineReplyClient: { reply: async () => undefined },
				memoryStore: createMemoryStore(),
			},
		);

		expect(response.status).toBe(401);
	});
});

function createMemoryStore(
	history: ConversationMessage[] = [],
	appended: ConversationMessage[][] = [],
): SessionMemoryStore {
	return {
		read: async () => history,
		append: async (_sessionId, messages) => {
			appended.push(messages);
			return [...history, ...messages];
		},
		clear: async () => undefined,
	};
}

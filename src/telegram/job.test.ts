import { describe, expect, test } from "bun:test";
import { ResponsesApiError } from "../agent/llm-client";
import type { ConversationMessage } from "../memory/types";
import {
	processTelegramQueueMessage,
	type TelegramJob,
	type TelegramJobProcessorDeps,
} from "./job";

describe("Telegram queued jobs", () => {
	test("runs the agent outside the webhook and completes the update after replying", async () => {
		const history: ConversationMessage[] = [
			{ role: "user", content: "find login" },
			{ role: "assistant", content: "found it" },
		];
		const seenHistory: ConversationMessage[][] = [];
		const appended: ConversationMessage[][] = [];
		const replies: unknown[][] = [];
		const completed: string[] = [];
		let acked = false;
		const deps = processorDeps({
			orchestrator: {
				answer: async (_question, previous = []) => {
					seenHistory.push(previous);
					return "commit abc123";
				},
			},
			memoryStore: {
				read: async () => history,
				append: async (_sessionId, messages) => {
					appended.push(messages);
					return [...history, ...messages];
				},
				clear: async () => undefined,
			},
			telegramReplyClient: {
				reply: async (...args) => {
					replies.push(args);
				},
			},
			telegramUpdateStore: {
				claim: async () => true,
				complete: async (updateId) => {
					completed.push(updateId);
				},
				release: async () => undefined,
			},
		});

		await processTelegramQueueMessage(
			{
				body: telegramJob(),
				attempts: 1,
				ack: () => {
					acked = true;
				},
				retry: () => undefined,
			},
			deps,
		);

		expect(seenHistory).toEqual([history]);
		expect(appended).toEqual([
			[
				{ role: "user", content: "list every custom rate limit" },
				{ role: "assistant", content: "commit abc123" },
			],
		]);
		expect(replies).toEqual([[9001, "commit abc123", 42]]);
		expect(completed).toEqual(["790"]);
		expect(acked).toBe(true);
	});

	test("retries a transient OpenAI failure without acknowledging the job", async () => {
		const retries: { delaySeconds?: number }[] = [];
		let acked = false;
		let replyCalls = 0;
		const deps = processorDeps({
			orchestrator: {
				answer: async () => {
					throw responsesError(true);
				},
			},
			telegramReplyClient: {
				reply: async () => {
					replyCalls += 1;
				},
			},
		});

		await processTelegramQueueMessage(
			{
				body: telegramJob(),
				attempts: 1,
				ack: () => {
					acked = true;
				},
				retry: (options) => retries.push(options ?? {}),
			},
			deps,
		);

		expect(retries).toEqual([{ delaySeconds: 30 }]);
		expect(replyCalls).toBe(0);
		expect(acked).toBe(false);
	});

	test("does not persist an answer that Telegram failed to deliver", async () => {
		let appendCalls = 0;
		const retries: { delaySeconds?: number }[] = [];
		const deps = processorDeps({
			memoryStore: {
				read: async () => [],
				append: async (_sessionId, messages) => {
					appendCalls += 1;
					return messages;
				},
				clear: async () => undefined,
			},
			telegramReplyClient: {
				reply: async () => {
					throw new Error("Telegram reply failed with status 429");
				},
			},
		});

		await processTelegramQueueMessage(
			{
				body: telegramJob(),
				attempts: 1,
				ack: () => undefined,
				retry: (options) => retries.push(options ?? {}),
			},
			deps,
		);

		expect(appendCalls).toBe(0);
		expect(retries).toEqual([{ delaySeconds: 30 }]);
	});

	test("notifies the user after transient failures exhaust queue retries", async () => {
		const replies: unknown[][] = [];
		const completed: string[] = [];
		let acked = false;
		const deps = processorDeps({
			orchestrator: {
				answer: async () => {
					throw responsesError(true);
				},
			},
			telegramReplyClient: {
				reply: async (...args) => {
					replies.push(args);
				},
			},
			telegramUpdateStore: {
				claim: async () => true,
				complete: async (updateId) => {
					completed.push(updateId);
				},
				release: async () => undefined,
			},
		});

		await processTelegramQueueMessage(
			{
				body: telegramJob(),
				attempts: 3,
				ack: () => {
					acked = true;
				},
				retry: () => undefined,
			},
			deps,
		);

		expect(replies).toHaveLength(1);
		expect(replies[0]?.[1]).toContain("ระบบ AI มีคำขอหนาแน่น");
		expect(completed).toEqual(["790"]);
		expect(acked).toBe(true);
	});

	test("does not retry permanent OpenAI quota failures", async () => {
		const replies: unknown[][] = [];
		let retryCalls = 0;
		let acked = false;
		const deps = processorDeps({
			orchestrator: {
				answer: async () => {
					throw responsesError(false);
				},
			},
			telegramReplyClient: {
				reply: async (...args) => {
					replies.push(args);
				},
			},
		});

		await processTelegramQueueMessage(
			{
				body: telegramJob(),
				attempts: 1,
				ack: () => {
					acked = true;
				},
				retry: () => {
					retryCalls += 1;
				},
			},
			deps,
		);

		expect(retryCalls).toBe(0);
		expect(replies[0]?.[1]).toContain("ระบบ AI ไม่พร้อมใช้งาน");
		expect(acked).toBe(true);
	});
});

function telegramJob(): TelegramJob {
	return {
		updateId: "790",
		chatId: 9001,
		messageId: 42,
		text: "list every custom rate limit",
	};
}

function responsesError(retryable: boolean): ResponsesApiError {
	return new ResponsesApiError({
		status: 429,
		code: retryable ? "slow_down" : "credit_balance_exhausted",
		requestId: "req_test",
		attempts: retryable ? 3 : 1,
		retryable,
	});
}

function processorDeps(
	overrides: Partial<TelegramJobProcessorDeps>,
): TelegramJobProcessorDeps {
	return {
		orchestrator: { answer: async () => "done" },
		memoryStore: {
			read: async () => [],
			append: async (_sessionId, messages) => messages,
			clear: async () => undefined,
		},
		telegramReplyClient: { reply: async () => undefined },
		telegramUpdateStore: {
			claim: async () => true,
			complete: async () => undefined,
			release: async () => undefined,
		},
		...overrides,
	};
}

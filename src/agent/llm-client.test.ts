import { describe, expect, test } from "bun:test";
import { loadConfig } from "../config";
import { createResponsesClient, ResponsesApiError } from "./llm-client";

const requestInput = {
	instructions: "Answer briefly.",
	items: [{ role: "user" as const, content: "hello" }],
	tools: [],
};

describe("Responses API client", () => {
	test("retries temporary 429 responses using Retry-After", async () => {
		let calls = 0;
		const delays: number[] = [];
		const client = createResponsesClient(
			loadConfig({ OPENAI_API_KEY: "openai-key" }),
			asFetch(async () => {
				calls += 1;
				if (calls === 1) {
					return Response.json(
						{ error: { type: "rate_limit_error", code: "slow_down" } },
						{
							status: 429,
							headers: { "Retry-After": "0", "x-request-id": "req_retry" },
						},
					);
				}
				return Response.json({ output_text: "OK" });
			}),
			{
				sleep: async (delayMs) => {
					delays.push(delayMs);
				},
				random: () => 0,
			},
		);

		await expect(client.create(requestInput)).resolves.toEqual({
			output_text: "OK",
		});
		expect(calls).toBe(2);
		expect(delays).toEqual([0]);
	});

	test("waits for the longest OpenAI rate-limit reset window", async () => {
		let calls = 0;
		const delays: number[] = [];
		const client = createResponsesClient(
			loadConfig({ OPENAI_API_KEY: "openai-key" }),
			asFetch(async () => {
				calls += 1;
				if (calls === 1) {
					return Response.json(
						{ error: { type: "rate_limit_error", code: "slow_down" } },
						{
							status: 429,
							headers: {
								"x-ratelimit-reset-requests": "250ms",
								"x-ratelimit-reset-tokens": "1m2.5s",
							},
						},
					);
				}
				return Response.json({ output_text: "OK" });
			}),
			{
				sleep: async (delayMs) => {
					delays.push(delayMs);
				},
				random: () => 0,
			},
		);

		await expect(client.create(requestInput)).resolves.toEqual({
			output_text: "OK",
		});
		expect(delays).toEqual([62_500]);
	});

	test("does not retry billing or quota 429 responses", async () => {
		let calls = 0;
		const client = createResponsesClient(
			loadConfig({ OPENAI_API_KEY: "openai-key" }),
			asFetch(async () => {
				calls += 1;
				return Response.json(
					{
						error: {
							type: "insufficient_quota",
							code: "credit_balance_exhausted",
						},
					},
					{ status: 429, headers: { "x-request-id": "req_quota" } },
				);
			}),
			{ sleep: async () => undefined },
		);

		const error = await client.create(requestInput).catch((caught) => caught);
		expect(error).toBeInstanceOf(ResponsesApiError);
		expect(error).toMatchObject({
			status: 429,
			code: "credit_balance_exhausted",
			requestId: "req_quota",
			attempts: 1,
			retryable: false,
		});
		expect(calls).toBe(1);
	});

	test("does not retry legacy insufficient_quota responses without a code", async () => {
		let calls = 0;
		const client = createResponsesClient(
			loadConfig({ OPENAI_API_KEY: "openai-key" }),
			asFetch(async () => {
				calls += 1;
				return Response.json(
					{ error: { type: "insufficient_quota" } },
					{ status: 429 },
				);
			}),
			{ sleep: async () => undefined },
		);

		const error = await client.create(requestInput).catch((caught) => caught);
		expect(error).toMatchObject({
			status: 429,
			errorType: "insufficient_quota",
			attempts: 1,
			retryable: false,
		});
		expect(calls).toBe(1);
	});

	test("limits repeated transient failures to three attempts", async () => {
		let calls = 0;
		const delays: number[] = [];
		const client = createResponsesClient(
			loadConfig({ OPENAI_API_KEY: "openai-key" }),
			asFetch(async () => {
				calls += 1;
				return Response.json(
					{ error: { type: "rate_limit_error", code: "slow_down" } },
					{ status: 429 },
				);
			}),
			{
				sleep: async (delayMs) => {
					delays.push(delayMs);
				},
				random: () => 0,
			},
		);

		const error = await client.create(requestInput).catch((caught) => caught);
		expect(error).toBeInstanceOf(ResponsesApiError);
		expect(error).toMatchObject({
			status: 429,
			code: "slow_down",
			attempts: 3,
			retryable: true,
		});
		expect(calls).toBe(3);
		expect(delays).toEqual([1_000, 2_000]);
	});
});

function asFetch(
	implementation: (
		input: Parameters<typeof fetch>[0],
		init?: RequestInit,
	) => Promise<Response>,
): typeof fetch {
	return Object.assign(implementation, { preconnect: fetch.preconnect });
}

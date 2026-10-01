import type { AppConfig } from "../config";

export type ResponsesInputItem =
	| { role: "user" | "assistant"; content: string; type?: "message" }
	| ResponseOutputItem
	| { type: "function_call_output"; call_id: string; output: string };

export type FunctionTool = {
	type: "function";
	name: string;
	description: string;
	strict: true;
	parameters: {
		type: "object";
		properties: Record<string, unknown>;
		required: string[];
		additionalProperties: false;
	};
};

export type FunctionCallItem = {
	type: "function_call";
	call_id: string;
	name: string;
	arguments: string;
};

type MessageOutputItem = {
	type: "message";
	content?: { type?: string; text?: string }[];
};

export type ResponseOutputItem =
	| FunctionCallItem
	| MessageOutputItem
	| {
			type: Exclude<string, "function_call" | "message">;
			[key: string]: unknown;
	  };

export type ResponsesApiResponse = {
	id?: string;
	output?: ResponseOutputItem[];
	output_text?: string;
};

export type ResponsesClient = {
	create(input: {
		instructions: string;
		items: ResponsesInputItem[];
		tools: FunctionTool[];
	}): Promise<ResponsesApiResponse>;
};

type ResponsesClientRuntime = {
	sleep?: (delayMs: number) => Promise<void>;
	random?: () => number;
	now?: () => number;
};

type ResponsesApiErrorBody = {
	error?: {
		code?: string | null;
		type?: string | null;
	};
};

const maxAttempts = 3;
const maxRetryDelayMs = 65_000;
const maxRetryBudgetMs = 125_000;
const maxErrorBodyBytes = 16_384;
const nonRetryable429Codes = new Set([
	"credit_balance_exhausted",
	"organization_spend_limit_exceeded",
	"organization_usage_limit_exceeded",
	"project_spend_limit_exceeded",
]);

export class ResponsesApiError extends Error {
	readonly status: number;
	readonly code?: string;
	readonly errorType?: string;
	readonly requestId?: string;
	readonly attempts: number;
	readonly retryable: boolean;

	constructor(input: {
		status: number;
		code?: string;
		errorType?: string;
		requestId?: string;
		attempts: number;
		retryable: boolean;
	}) {
		const codeSuffix = input.code ? ` (${input.code})` : "";
		super(`Responses API failed with status ${input.status}${codeSuffix}`);
		this.name = "ResponsesApiError";
		this.status = input.status;
		this.code = input.code;
		this.errorType = input.errorType;
		this.requestId = input.requestId;
		this.attempts = input.attempts;
		this.retryable = input.retryable;
	}
}

export function createResponsesClient(
	config: AppConfig,
	fetchImpl: typeof fetch = fetch,
	runtime: ResponsesClientRuntime = {},
): ResponsesClient {
	const sleep = runtime.sleep ?? wait;
	const random = runtime.random ?? Math.random;
	const now = runtime.now ?? Date.now;

	return {
		async create(input) {
			if (!config.llm.apiKey) {
				throw new Error("OPENAI_API_KEY is required");
			}

			let totalRetryDelayMs = 0;
			for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
				const response = await fetchImpl(`${config.llm.baseUrl}/responses`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${config.llm.apiKey}`,
						"Content-Type": "application/json",
						"HTTP-Referer": "https://superset.sh",
						"X-Title": "Superset LINE Agent POC",
					},
					body: JSON.stringify({
						model: config.llm.model,
						instructions: input.instructions,
						input: input.items,
						tools: input.tools,
						tool_choice: "auto",
						parallel_tool_calls: false,
						max_output_tokens: 1200,
						store: false,
					}),
				});

				if (response.ok) {
					return (await response.json()) as ResponsesApiResponse;
				}

				const errorBody = await readErrorBody(response);
				const code = normalizeErrorField(errorBody?.error?.code);
				const errorType = normalizeErrorField(errorBody?.error?.type);
				const retryable = isRetryableResponse(response.status, code, errorType);
				const requestId = response.headers.get("x-request-id") ?? undefined;
				const apiError = new ResponsesApiError({
					status: response.status,
					code,
					errorType,
					requestId,
					attempts: attempt,
					retryable,
				});

				if (!retryable || attempt === maxAttempts) {
					throw apiError;
				}

				const retryDelayMs = getRetryDelayMs(
					response.headers.get("retry-after"),
					[
						response.headers.get("x-ratelimit-reset-tokens"),
						response.headers.get("x-ratelimit-reset-requests"),
					],
					attempt,
					now(),
					random(),
				);
				if (
					retryDelayMs > maxRetryDelayMs ||
					totalRetryDelayMs + retryDelayMs > maxRetryBudgetMs
				) {
					throw apiError;
				}

				console.warn(
					JSON.stringify({
						message: "openai request retry",
						status: response.status,
						code: code ?? "unknown",
						requestId: requestId ?? "unknown",
						attempt,
						delayMs: retryDelayMs,
					}),
				);
				totalRetryDelayMs += retryDelayMs;
				await sleep(retryDelayMs);
			}

			throw new Error("Responses API retry loop ended unexpectedly");
		},
	};
}

function isRetryableResponse(
	status: number,
	code?: string,
	errorType?: string,
): boolean {
	if (status === 429) {
		return (
			errorType !== "insufficient_quota" &&
			(!code || !nonRetryable429Codes.has(code))
		);
	}

	return status === 500 || status === 502 || status === 503 || status === 504;
}

function getRetryDelayMs(
	retryAfter: string | null,
	rateLimitResets: (string | null)[],
	attempt: number,
	nowMs: number,
	randomValue: number,
): number {
	const jitterMs = Math.floor(Math.max(0, Math.min(1, randomValue)) * 250);
	const serverDelayMs = parseRetryAfterMs(retryAfter, nowMs);
	if (serverDelayMs !== undefined) {
		return serverDelayMs + jitterMs;
	}
	const rateLimitDelayMs = rateLimitResets.reduce<number | undefined>(
		(longestDelay, value) => {
			const delay = parseRateLimitResetMs(value);
			return delay === undefined
				? longestDelay
				: Math.max(longestDelay ?? 0, delay);
		},
		undefined,
	);
	if (rateLimitDelayMs !== undefined) {
		return rateLimitDelayMs + jitterMs;
	}

	return 1_000 * 2 ** (attempt - 1) + jitterMs;
}

function parseRetryAfterMs(
	retryAfter: string | null,
	nowMs: number,
): number | undefined {
	if (!retryAfter) {
		return undefined;
	}

	const seconds = Number(retryAfter);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return seconds * 1_000;
	}

	const retryAt = Date.parse(retryAfter);
	return Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs) : undefined;
}

function parseRateLimitResetMs(value: string | null): number | undefined {
	if (!value) {
		return undefined;
	}

	const duration = value.trim();
	const partPattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
	const multipliers = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 } as const;
	let totalMs = 0;
	let consumed = 0;
	for (const match of duration.matchAll(partPattern)) {
		if (match.index !== consumed) {
			return undefined;
		}
		const amount = Number(match[1]);
		const unit = match[2] as keyof typeof multipliers;
		totalMs += amount * multipliers[unit];
		consumed += match[0].length;
	}

	return consumed === duration.length && consumed > 0 ? totalMs : undefined;
}

async function readErrorBody(
	response: Response,
): Promise<ResponsesApiErrorBody | undefined> {
	if (!response.body) {
		return undefined;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let body = "";
	let remainingBytes = maxErrorBodyBytes;
	try {
		while (remainingBytes > 0) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			const chunk = value.subarray(0, remainingBytes);
			body += decoder.decode(chunk, { stream: true });
			remainingBytes -= chunk.byteLength;
			if (chunk.byteLength < value.byteLength) {
				break;
			}
		}
		body += decoder.decode();
	} finally {
		await reader.cancel().catch(() => undefined);
	}

	try {
		return JSON.parse(body) as ResponsesApiErrorBody;
	} catch {
		return undefined;
	}
}

function normalizeErrorField(
	value: string | null | undefined,
): string | undefined {
	return value || undefined;
}

function wait(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function extractFunctionCalls(
	response: ResponsesApiResponse,
): FunctionCallItem[] {
	return (response.output ?? []).filter(
		(item): item is FunctionCallItem => item.type === "function_call",
	);
}

export function extractOutputText(response: ResponsesApiResponse): string {
	if (response.output_text) {
		return response.output_text;
	}

	return (response.output ?? [])
		.flatMap((item) => (isMessageOutputItem(item) ? (item.content ?? []) : []))
		.map((content) => content.text)
		.filter((text): text is string => Boolean(text))
		.join("\n")
		.trim();
}

function isMessageOutputItem(
	item: ResponseOutputItem,
): item is MessageOutputItem {
	return item.type === "message";
}

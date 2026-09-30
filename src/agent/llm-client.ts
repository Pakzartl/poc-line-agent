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

export function createResponsesClient(
	config: AppConfig,
	fetchImpl: typeof fetch = fetch,
): ResponsesClient {
	return {
		async create(input) {
			if (!config.llm.apiKey) {
				throw new Error("OPENAI_API_KEY is required");
			}

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

			if (!response.ok) {
				throw new Error(`Responses API failed with status ${response.status}`);
			}

			return (await response.json()) as ResponsesApiResponse;
		},
	};
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

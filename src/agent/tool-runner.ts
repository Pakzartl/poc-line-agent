import type { FunctionCallItem, FunctionTool } from "./llm-client";

export type ToolResult = {
	ok: boolean;
	data?: unknown;
	error?: string;
};

export type RegisteredTool = {
	definition: FunctionTool;
	run(argumentsJson: string): Promise<ToolResult>;
};

export type ToolRunner = {
	definitions: FunctionTool[];
	run(call: FunctionCallItem): Promise<ToolResult>;
};

export function createToolRunner(tools: RegisteredTool[]): ToolRunner {
	const toolMap = new Map(tools.map((tool) => [tool.definition.name, tool]));

	return {
		definitions: tools.map((tool) => tool.definition),
		async run(call) {
			const tool = toolMap.get(call.name);

			if (!tool) {
				return { ok: false, error: `Unknown tool: ${call.name}` };
			}

			try {
				return await tool.run(call.arguments);
			} catch (error) {
				return {
					ok: false,
					error: error instanceof Error ? error.message : "Tool failed",
				};
			}
		},
	};
}

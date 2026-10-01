import type { ConversationMessage } from "../memory/types";
import type { ResponsesClient, ResponsesInputItem } from "./llm-client";
import { extractFunctionCalls, extractOutputText } from "./llm-client";
import { buildInstructions } from "./prompts";
import type { SkillManager } from "./skill-manager";
import type { ToolRunner } from "./tool-runner";

export type AgentOrchestrator = {
	answer(question: string, history?: ConversationMessage[]): Promise<string>;
};

export type AgentOrchestratorOptions = {
	skillManager: SkillManager;
	responsesClient: ResponsesClient;
	toolRunner: ToolRunner;
	maxToolRounds: number;
	maxToolCalls: number;
};

export function createAgentOrchestrator(
	options: AgentOrchestratorOptions,
): AgentOrchestrator {
	return {
		async answer(question, history = []) {
			const skillName = options.skillManager.selectSkill(question);
			const skillMarkdown = await options.skillManager.loadSkill(skillName);
			const instructions = buildInstructions(skillName, skillMarkdown);
			const items: ResponsesInputItem[] = [
				...history.map((message) => ({
					role: message.role,
					content: message.content,
				})),
				{ role: "user", content: question },
			];

			let toolCallCount = 0;
			let budgetExhausted = false;
			for (let round = 0; round < options.maxToolRounds; round += 1) {
				const response = await options.responsesClient.create({
					instructions,
					items,
					tools: options.toolRunner.definitions,
				});
				const calls = extractFunctionCalls(response);

				if (calls.length === 0) {
					return extractOutputText(response) || "No answer returned.";
				}

				items.push(...(response.output ?? []));

				for (const call of calls) {
					if (toolCallCount >= options.maxToolCalls) {
						items.push({
							type: "function_call_output",
							call_id: call.call_id,
							output: JSON.stringify({
								ok: false,
								error: "Total tool-call budget exhausted",
							}),
						});
						budgetExhausted = true;
						continue;
					}

					toolCallCount += 1;
					const startedAt = Date.now();
					const result = await options.toolRunner.run(call);
					console.info(
						JSON.stringify({
							message: "agent tool call",
							tool: call.name,
							round: round + 1,
							toolCall: toolCallCount,
							ok: result.ok,
							durationMs: Date.now() - startedAt,
						}),
					);
					items.push({
						type: "function_call_output",
						call_id: call.call_id,
						output: JSON.stringify(result),
					});
				}

				if (budgetExhausted || toolCallCount >= options.maxToolCalls) {
					break;
				}
			}

			const finalResponse = await options.responsesClient.create({
				instructions: [
					instructions,
					"The tool-use budget is exhausted. Do not call any more tools. Answer now using the evidence already collected, state important gaps, and keep the result concise.",
				].join("\n\n"),
				items,
				tools: [],
			});

			return (
				extractOutputText(finalResponse) ||
				"I reached the tool-use limit before enough evidence was available."
			);
		},
	};
}

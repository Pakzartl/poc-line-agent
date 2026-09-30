import { buildInstructions } from "./prompts";
import type { ResponsesClient, ResponsesInputItem } from "./llm-client";
import { extractFunctionCalls, extractOutputText } from "./llm-client";
import type { SkillManager } from "./skill-manager";
import type { ToolRunner } from "./tool-runner";
import type { ConversationMessage } from "../memory/types";

export type AgentOrchestrator = {
	answer(question: string, history?: ConversationMessage[]): Promise<string>;
};

export type AgentOrchestratorOptions = {
	skillManager: SkillManager;
	responsesClient: ResponsesClient;
	toolRunner: ToolRunner;
	maxToolRounds: number;
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

			for (let round = 0; round <= options.maxToolRounds; round += 1) {
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
					const result = await options.toolRunner.run(call);
					items.push({
						type: "function_call_output",
						call_id: call.call_id,
						output: JSON.stringify(result),
					});
				}
			}

			return "I could not finish within the configured tool-call limit.";
		},
	};
}

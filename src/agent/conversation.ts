import type { AgentOrchestrator } from "./orchestrator";
import type { SessionMemoryStore } from "../memory/types";

export type ConversationDeps = {
	orchestrator: AgentOrchestrator;
	memoryStore: SessionMemoryStore;
};

export async function answerConversation(
	input: {
		question: string;
		sessionId?: string;
		memoryEnabled?: boolean;
	},
	deps: ConversationDeps,
): Promise<string> {
	const memoryEnabled = input.memoryEnabled ?? true;
	const history =
		memoryEnabled && input.sessionId
			? await deps.memoryStore.read(input.sessionId)
			: [];
	const answer = await deps.orchestrator.answer(input.question, history);

	if (memoryEnabled && input.sessionId) {
		await deps.memoryStore.append(input.sessionId, [
			{ role: "user", content: input.question },
			{ role: "assistant", content: answer },
		]);
	}

	return answer;
}

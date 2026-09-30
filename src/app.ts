import { createAgentOrchestrator } from "./agent/orchestrator";
import { createResponsesClient } from "./agent/llm-client";
import { createSkillManager } from "./agent/skill-manager";
import { createToolRunner } from "./agent/tool-runner";
import type { AppConfig } from "./config";
import { createLineReplyClient } from "./line/reply";
import { handleLineWebhook } from "./line/webhook";
import {
	createSessionMemoryStore,
	type SessionMemoryStore,
} from "./memory/session-memory";
import { createGitHubTools } from "./tools/github";

export type AppDeps = {
	config: AppConfig;
	orchestrator: ReturnType<typeof createAgentOrchestrator>;
	lineReplyClient: ReturnType<typeof createLineReplyClient>;
	memoryStore: SessionMemoryStore;
};

export type AppRuntimeOptions = {
	hostname?: string;
	fetch?: typeof fetch;
	memoryStore?: SessionMemoryStore;
};

export function createAppDeps(
	config: AppConfig,
	options: Pick<AppRuntimeOptions, "fetch" | "memoryStore"> = {},
): AppDeps {
	const fetchImpl = options.fetch ?? fetch;
	const toolRunner = createToolRunner(
		createGitHubTools({ config: config.github, fetch: fetchImpl }),
	);
	const orchestrator = createAgentOrchestrator({
		skillManager: createSkillManager(),
		responsesClient: createResponsesClient(config, fetchImpl),
		toolRunner,
		maxToolRounds: config.llm.maxToolRounds,
	});
	const lineReplyClient = createLineReplyClient({
		channelAccessToken: config.line.channelAccessToken,
		apiBaseUrl: config.line.apiBaseUrl,
		fetch: fetchImpl,
	});
	const memoryStore =
		options.memoryStore ??
		createSessionMemoryStore({
			directory: config.memory.directory,
			maxMessages: config.memory.maxMessages,
		});

	return { config, orchestrator, lineReplyClient, memoryStore };
}

export function createAppHandler(
	deps: AppDeps,
): (request: Request) => Promise<Response> {
	return async (request) => {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/health") {
			return Response.json({ ok: true });
		}

		if (request.method === "POST" && url.pathname === "/line/webhook") {
			return handleLineWebhook(request, deps);
		}

		return new Response("not found", { status: 404 });
	};
}

export function startLineAgentServer(
	config: AppConfig,
	options: AppRuntimeOptions = {},
): Bun.Server<undefined> {
	return Bun.serve({
		hostname: options.hostname,
		port: config.port,
		fetch: createAppHandler(createAppDeps(config, options)),
	});
}

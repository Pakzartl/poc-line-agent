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
import { createTelegramReplyClient } from "./telegram/reply";
import { handleTelegramWebhook } from "./telegram/webhook";
import { createGitHubTools } from "./tools/github";
import { createWhatsAppReplyClient } from "./whatsapp/reply";
import {
	handleWhatsAppVerification,
	handleWhatsAppWebhook,
} from "./whatsapp/webhook";

export type AppDeps = {
	config: AppConfig;
	orchestrator: ReturnType<typeof createAgentOrchestrator>;
	lineReplyClient: ReturnType<typeof createLineReplyClient>;
	telegramReplyClient: ReturnType<typeof createTelegramReplyClient>;
	whatsAppReplyClient: ReturnType<typeof createWhatsAppReplyClient>;
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
	const telegramReplyClient = createTelegramReplyClient({
		botToken: config.telegram.botToken,
		apiBaseUrl: config.telegram.apiBaseUrl,
		fetch: fetchImpl,
	});
	const whatsAppReplyClient = createWhatsAppReplyClient({
		accessToken: config.whatsapp.accessToken,
		phoneNumberId: config.whatsapp.phoneNumberId,
		apiBaseUrl: config.whatsapp.apiBaseUrl,
		fetch: fetchImpl,
	});
	const memoryStore =
		options.memoryStore ??
		createSessionMemoryStore({
			directory: config.memory.directory,
			maxMessages: config.memory.maxMessages,
		});

	return {
		config,
		orchestrator,
		lineReplyClient,
		telegramReplyClient,
		whatsAppReplyClient,
		memoryStore,
	};
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
			if (!isLineConfigured(deps.config)) {
				return new Response("LINE provider is not configured", { status: 503 });
			}
			return handleLineWebhook(request, deps);
		}

		if (request.method === "POST" && url.pathname === "/telegram/webhook") {
			if (!isTelegramConfigured(deps.config)) {
				return new Response("Telegram provider is not configured", {
					status: 503,
				});
			}
			return handleTelegramWebhook(request, deps);
		}

		if (url.pathname === "/whatsapp/webhook") {
			if (!isWhatsAppConfigured(deps.config)) {
				return new Response("WhatsApp provider is not configured", {
					status: 503,
				});
			}
			if (request.method === "GET") {
				return handleWhatsAppVerification(request, deps.config);
			}
			if (request.method === "POST") {
				return handleWhatsAppWebhook(request, deps);
			}
		}

		return new Response("not found", { status: 404 });
	};
}

function isLineConfigured(config: AppConfig): boolean {
	return Boolean(config.line.channelSecret && config.line.channelAccessToken);
}

function isTelegramConfigured(config: AppConfig): boolean {
	return Boolean(config.telegram.botToken && config.telegram.webhookSecret);
}

function isWhatsAppConfigured(config: AppConfig): boolean {
	return Boolean(
		config.whatsapp.accessToken &&
			config.whatsapp.phoneNumberId &&
			config.whatsapp.verifyToken &&
			config.whatsapp.appSecret,
	);
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

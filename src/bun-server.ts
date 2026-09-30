import { createBunSkillLoader } from "./agent/bun-skill-loader";
import { createSkillManager } from "./agent/skill-manager";
import { createAppDeps, createAppHandler } from "./app";
import type { AppConfig } from "./config";
import { createSessionMemoryStore } from "./memory/session-memory";
import type { SessionMemoryStore } from "./memory/types";

export type BunServerOptions = {
	hostname?: string;
	fetch?: typeof fetch;
	memoryStore?: SessionMemoryStore;
};

export function startLineAgentServer(
	config: AppConfig,
	options: BunServerOptions = {},
): Bun.Server<undefined> {
	const memoryStore =
		options.memoryStore ??
		createSessionMemoryStore({
			directory: config.memory.directory,
			maxMessages: config.memory.maxMessages,
		});

	return Bun.serve({
		hostname: options.hostname,
		port: config.port,
		fetch: createAppHandler(
			createAppDeps(config, {
				fetch: options.fetch,
				memoryStore,
				skillManager: createSkillManager(createBunSkillLoader()),
			}),
		),
	});
}

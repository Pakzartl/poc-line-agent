import { startLineAgentServer } from "./bun-server";
import { loadConfig, validateConfig } from "./config";
import { createSessionMemoryStore } from "./memory/session-memory";
import {
	createSandboxMockHandler,
	createSandboxState,
} from "./sandbox/mock-services";

const channelSecret = process.env.LINE_CHANNEL_SECRET || "sandbox-line-secret";
const mockPort = Number(process.env.SANDBOX_PORT ?? "3101");
const appPort = Number(process.env.PORT ?? "3100");
const providerMode = process.argv.includes("--live") ? "live" : "mock";
let appOrigin = "";

const state = createSandboxState();
const liveConfig = loadConfig({ ...process.env, PORT: String(appPort) });
const repository =
	providerMode === "live"
		? `${liveConfig.github.owner}/${liveConfig.github.repo}`
		: "sandbox/repo";
const memoryStore = createSessionMemoryStore({
	directory: liveConfig.memory.directory,
	maxMessages: liveConfig.memory.maxMessages,
});
const mockServer = Bun.serve({
	hostname: "127.0.0.1",
	port: mockPort,
	fetch: createSandboxMockHandler({
		state,
		channelSecret,
		getAppOrigin: () => appOrigin,
		providerMode,
		repository,
		resetSessionMemory: () => memoryStore.clear("line:user:sandbox-user"),
	}),
});
const mockOrigin = `http://127.0.0.1:${mockServer.port}`;
const config =
	providerMode === "live"
		? loadConfig({
				...process.env,
				PORT: String(appPort),
				LINE_API_BASE_URL: `${mockOrigin}/line`,
			})
		: loadConfig({
				...process.env,
				PORT: String(appPort),
				LINE_CHANNEL_SECRET: channelSecret,
				LINE_CHANNEL_ACCESS_TOKEN: "sandbox-line-token",
				LINE_API_BASE_URL: `${mockOrigin}/line`,
				OPENAI_API_KEY: "sandbox-openai-key",
				OPENAI_BASE_URL: `${mockOrigin}/openai`,
				OPENAI_MODEL: "sandbox-model",
				OPENAI_MAX_TOOL_ROUNDS: process.env.OPENAI_MAX_TOOL_ROUNDS ?? "50",
				GITHUB_OWNER: "sandbox",
				GITHUB_REPO: "repo",
				GITHUB_TOKEN: "sandbox-github-token",
				GITHUB_REF: "main",
				GITHUB_API_BASE_URL: `${mockOrigin}/github`,
			});
validateConfig(config);

const observedFetch: typeof fetch = Object.assign(
	async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		const url = new URL(
			input instanceof Request ? input.url : input.toString(),
		);
		if (url.href.startsWith(`${config.llm.baseUrl}/responses`)) {
			state.responsesRequests.push({ provider: "live" });
		}
		if (url.href.startsWith(config.github.apiBaseUrl)) {
			state.githubRequests.push(`${url.pathname}${url.search}`);
		}
		return fetch(input, init);
	},
	{ preconnect: fetch.preconnect },
);
const appServer = startLineAgentServer(config, {
	hostname: "127.0.0.1",
	fetch: providerMode === "live" ? observedFetch : undefined,
	memoryStore,
});
appOrigin = `http://127.0.0.1:${appServer.port}`;

console.log(`LINE Agent sandbox app (${providerMode} providers): ${appOrigin}`);
console.log(`Sandbox UI and LINE capture: ${mockOrigin}`);
console.log(
	`Send a test message: curl -s -X POST ${mockOrigin}/sandbox/send -H 'Content-Type: application/json' -d '{"text":"why does login fail?"}'`,
);

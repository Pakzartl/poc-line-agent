import { afterEach, describe, expect, test } from "bun:test";
import { startLineAgentServer } from "../app";
import { loadConfig } from "../config";
import { createSandboxMockHandler, createSandboxState } from "./mock-services";

const servers: Bun.Server<undefined>[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) {
		server.stop(true);
	}
});

describe("local sandbox full loop", () => {
	test("signs a LINE webhook and completes OpenAI, GitHub, and LINE reply mocks", async () => {
		const state = createSandboxState();
		const channelSecret = "sandbox-secret";
		let appOrigin = "";
		const mockServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: createSandboxMockHandler({
				state,
				channelSecret,
				getAppOrigin: () => appOrigin,
			}),
		});
		servers.push(mockServer);
		const mockOrigin = `http://127.0.0.1:${mockServer.port}`;
		const config = loadConfig({
			PORT: "0",
			LINE_CHANNEL_SECRET: channelSecret,
			LINE_CHANNEL_ACCESS_TOKEN: "line-token",
			LINE_API_BASE_URL: `${mockOrigin}/line`,
			OPENAI_API_KEY: "openai-key",
			OPENAI_BASE_URL: `${mockOrigin}/openai`,
			OPENAI_MODEL: "sandbox-model",
			GITHUB_OWNER: "sandbox",
			GITHUB_REPO: "repo",
			GITHUB_TOKEN: "github-token",
			GITHUB_API_BASE_URL: `${mockOrigin}/github`,
		});
		const appServer = startLineAgentServer(config, { hostname: "127.0.0.1" });
		servers.push(appServer);
		appOrigin = `http://127.0.0.1:${appServer.port}`;

		const pageResponse = await fetch(mockOrigin);
		const page = await pageResponse.text();
		expect(pageResponse.status).toBe(200);
		expect(page).toContain("LINE Coding Agent Sandbox");
		expect(page).toContain('id="question"');
		expect(page).toContain('id="use-memory"');
		expect(pageResponse.headers.get("content-security-policy")).toContain(
			"default-src 'self'",
		);
		const pageScript = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
		expect(pageScript).toBeDefined();
		expect(() => new Function(pageScript ?? "")).not.toThrow();

		const response = await fetch(`${mockOrigin}/sandbox/send`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "why does login fail?" }),
		});
		const result = (await response.json()) as {
			ok: boolean;
			status: number;
			lineReplies: { messages: { text: string }[] }[];
			responseRequestCount: number;
			githubRequests: string[];
		};

		expect(response.status).toBe(200);
		expect(result.ok).toBe(true);
		expect(result.status).toBe(200);
		expect(result.responseRequestCount).toBe(3);
		expect(
			result.githubRequests.some((path) =>
				path.startsWith("/github/search/code"),
			),
		).toBe(true);
		expect(
			result.githubRequests.includes(
				"/github/repos/sandbox/repo/contents/src/auth/login.ts?ref=main",
			),
		).toBe(true);
		expect(result.lineReplies).toHaveLength(1);
		expect(result.lineReplies[0]?.messages[0]?.text).toContain(
			"Sandbox full loop OK",
		);
		expect(state.responsesRequests).toHaveLength(3);
	});
});

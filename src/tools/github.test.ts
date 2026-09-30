import { describe, expect, test } from "bun:test";
import { loadConfig } from "../config";
import { createGitHubTools } from "./github";

describe("GitHub tools", () => {
	test("search_code uses GitHub code search without exposing the token", async () => {
		const requestedHeaders: HeadersInit[] = [];
		const tools = createGitHubTools({
			config: loadConfig({
				GITHUB_OWNER: "superset",
				GITHUB_REPO: "repo",
				GITHUB_TOKEN: "secret-token",
			}).github,
			fetch: async (_url, init) => {
				requestedHeaders.push(init?.headers ?? {});
				return Response.json({
					items: [
						{ path: "src/auth/login.ts", html_url: "https://github.test/file" },
					],
				});
			},
		});

		const result = await tools
			.find((tool) => tool.definition.name === "search_code")
			?.run('{"query":"login"}');

		expect(result).toEqual({
			ok: true,
			data: {
				files: [{ path: "src/auth/login.ts", url: "https://github.test/file" }],
			},
		});
		expect(JSON.stringify(result)).not.toContain("secret-token");
		expect(JSON.stringify(requestedHeaders)).toContain("secret-token");
	});

	test("read_file limits large decoded content", async () => {
		const tools = createGitHubTools({
			config: loadConfig({
				GITHUB_OWNER: "superset",
				GITHUB_REPO: "repo",
				GITHUB_TOKEN: "secret-token",
			}).github,
			fetch: async () =>
				Response.json({
					path: "src/large.ts",
					size: 30_000,
					encoding: "base64",
					content: Buffer.from("x".repeat(25_000)).toString("base64"),
				}),
		});

		const result = await tools
			.find((tool) => tool.definition.name === "read_file")
			?.run('{"path":"src/large.ts"}');

		expect(result?.ok).toBe(true);
		expect(JSON.stringify(result?.data).length).toBeLessThan(21_000);
		expect(JSON.stringify(result?.data)).toContain("[truncated]");
	});
});

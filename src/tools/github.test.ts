import { describe, expect, test } from "bun:test";
import { loadConfig } from "../config";
import { createGitHubTools } from "./github";

describe("GitHub tools", () => {
	test("lists repositories available to the token with bounded metadata", async () => {
		let request: Request | undefined;
		const tools = createGitHubTools({
			config: loadConfig({ GITHUB_TOKEN: "secret-token" }).github,
			fetch: async (input, init) => {
				request = new Request(input, init);
				return Response.json([
					{
						full_name: "acme/api",
						private: true,
						description: "API",
						default_branch: "main",
						html_url: "https://github.test/acme/api",
					},
				]);
			},
		});

		const result = await tools
			.find((tool) => tool.definition.name === "list_repositories")
			?.run("{}");

		expect(request?.method).toBe("GET");
		expect(request?.url).toContain("/user/repos?");
		expect(result).toEqual({
			ok: true,
			data: {
				repositories: [
					{
						name: "acme/api",
						private: true,
						description: "API",
						defaultBranch: "main",
						archived: false,
						url: "https://github.test/acme/api",
					},
				],
			},
		});
	});

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
			?.run('{"repository":"superset/repo","query":"login"}');

		expect(result).toEqual({
			ok: true,
			data: {
				repository: "superset/repo",
				files: [{ path: "src/auth/login.ts", url: "https://github.test/file" }],
			},
		});
		expect(JSON.stringify(result)).not.toContain("secret-token");
		expect(JSON.stringify(requestedHeaders)).toContain("secret-token");
		expect(new Headers(requestedHeaders[0]).get("user-agent")).toBe(
			"poc-line-agent/0.1",
		);
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
			?.run('{"repository":"superset/repo","path":"src/large.ts"}');

		expect(result?.ok).toBe(true);
		expect(JSON.stringify(result?.data).length).toBeLessThan(21_000);
		expect(JSON.stringify(result?.data)).toContain("[truncated]");
	});

	test("generic reads are GET-only and reject non-allowlisted paths", async () => {
		let method: string | undefined;
		const tools = createGitHubTools({
			config: loadConfig({ GITHUB_TOKEN: "secret-token" }).github,
			fetch: async (_input, init) => {
				method = init?.method;
				return Response.json({ default_branch: "main" });
			},
		});
		const githubGet = tools.find(
			(tool) => tool.definition.name === "github_get",
		);

		expect(await githubGet?.run('{"path":"/repos/acme/api/branches"}')).toEqual(
			{ ok: true, data: { default_branch: "main" } },
		);
		expect(method).toBe("GET");
		await expect(
			githubGet?.run('{"path":"https://example.com/private"}') ??
				Promise.resolve(),
		).rejects.toThrow("invalid GitHub GET path");
	});

	test("limits generic GitHub output before adding it to model context", async () => {
		const tools = createGitHubTools({
			config: loadConfig({ GITHUB_TOKEN: "secret-token" }).github,
			fetch: async () => Response.json({ content: "x".repeat(25_000) }),
		});
		const githubGet = tools.find(
			(tool) => tool.definition.name === "github_get",
		);

		const result = await githubGet?.run('{"path":"/repos/acme/api/tree"}');

		expect(result?.ok).toBe(true);
		expect(JSON.stringify(result?.data).length).toBeLessThan(20_100);
		expect(JSON.stringify(result?.data)).toContain("[truncated]");
	});

	test("does not expose mutation tools", () => {
		const names = createGitHubTools({
			config: loadConfig({ GITHUB_TOKEN: "secret-token" }).github,
		}).map((tool) => tool.definition.name);

		expect(names).toEqual([
			"list_repositories",
			"github_get",
			"search_code",
			"read_file",
			"get_commit",
		]);
	});
});

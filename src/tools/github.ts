import { Buffer } from "node:buffer";
import type { AppConfig } from "../config";
import type { RegisteredTool, ToolResult } from "../agent/tool-runner";

const maxSearchResults = 10;
const maxFileChars = 20_000;
const maxCommitFiles = 20;

type GitHubToolOptions = {
	config: AppConfig["github"];
	fetch?: FetchLike;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createGitHubTools(
	options: GitHubToolOptions,
): RegisteredTool[] {
	const client = createGitHubClient(options.config, options.fetch ?? fetch);

	return [
		{
			definition: {
				type: "function",
				name: "search_code",
				description:
					"Search repository source code paths and matching fragments.",
				strict: true,
				parameters: {
					type: "object",
					properties: {
						query: { type: "string", description: "Code search query." },
					},
					required: ["query"],
					additionalProperties: false,
				},
			},
			run: async (argumentsJson) =>
				client.searchCode(getRequiredArg(argumentsJson, "query")),
		},
		{
			definition: {
				type: "function",
				name: "read_file",
				description: "Read a repository file by path.",
				strict: true,
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "Repository-relative file path.",
						},
					},
					required: ["path"],
					additionalProperties: false,
				},
			},
			run: async (argumentsJson) =>
				client.readFile(getRequiredArg(argumentsJson, "path")),
		},
		{
			definition: {
				type: "function",
				name: "get_commit",
				description: "Read commit metadata and touched files by SHA.",
				strict: true,
				parameters: {
					type: "object",
					properties: {
						sha: { type: "string", description: "Commit SHA or ref." },
					},
					required: ["sha"],
					additionalProperties: false,
				},
			},
			run: async (argumentsJson) =>
				client.getCommit(getRequiredArg(argumentsJson, "sha")),
		},
	];
}

function createGitHubClient(config: AppConfig["github"], fetchImpl: FetchLike) {
	const repoPath = `${config.owner}/${config.repo}`;

	async function requestJson<T>(path: string): Promise<T> {
		validateConfig(config);

		const response = await fetchImpl(`${config.apiBaseUrl}${path}`, {
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${config.token}`,
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});

		if (!response.ok) {
			throw new Error(`GitHub request failed with status ${response.status}`);
		}

		return (await response.json()) as T;
	}

	return {
		async searchCode(query: string): Promise<ToolResult> {
			const trimmed = query.trim().slice(0, 200);
			if (!trimmed) {
				return { ok: false, error: "query is required" };
			}

			const searchQuery = encodeURIComponent(`${trimmed} repo:${repoPath}`);
			const data = await requestJson<{
				items?: { path: string; html_url?: string }[];
			}>(`/search/code?q=${searchQuery}&per_page=${maxSearchResults}`);

			return {
				ok: true,
				data: {
					files: (data.items ?? []).slice(0, maxSearchResults).map((item) => ({
						path: item.path,
						url: item.html_url,
					})),
				},
			};
		},
		async readFile(path: string): Promise<ToolResult> {
			const safePath = normalizeRepoPath(path);
			const data = await requestJson<{
				content?: string;
				encoding?: string;
				path?: string;
				size?: number;
			}>(
				`/repos/${repoPath}/contents/${encodeURIComponentPath(safePath)}?ref=${encodeURIComponent(config.ref)}`,
			);

			if (data.encoding !== "base64" || !data.content) {
				return { ok: false, error: "file content is not base64 text" };
			}

			const decoded = Buffer.from(
				data.content.replace(/\n/g, ""),
				"base64",
			).toString("utf8");

			return {
				ok: true,
				data: {
					path: data.path ?? safePath,
					size: data.size,
					content: limitText(decoded, maxFileChars),
				},
			};
		},
		async getCommit(sha: string): Promise<ToolResult> {
			const safeSha = sha.trim().slice(0, 100);
			if (!safeSha) {
				return { ok: false, error: "sha is required" };
			}

			const data = await requestJson<{
				sha: string;
				html_url?: string;
				commit?: {
					message?: string;
					author?: { name?: string; date?: string };
				};
				files?: {
					filename: string;
					status?: string;
					additions?: number;
					deletions?: number;
				}[];
			}>(`/repos/${repoPath}/commits/${encodeURIComponent(safeSha)}`);

			return {
				ok: true,
				data: {
					sha: data.sha,
					url: data.html_url,
					message: limitText(data.commit?.message ?? "", 2_000),
					author: data.commit?.author,
					files: (data.files ?? []).slice(0, maxCommitFiles).map((file) => ({
						path: file.filename,
						status: file.status,
						additions: file.additions,
						deletions: file.deletions,
					})),
				},
			};
		},
	};
}

function parseArgs(argumentsJson: string): Record<string, string> {
	try {
		const parsed = JSON.parse(argumentsJson) as Record<string, unknown>;
		return Object.fromEntries(
			Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")]),
		);
	} catch {
		return {};
	}
}

function getRequiredArg(argumentsJson: string, name: string): string {
	const value = parseArgs(argumentsJson)[name];

	if (!value) {
		throw new Error(`${name} is required`);
	}

	return value;
}

function validateConfig(config: AppConfig["github"]): void {
	if (!config.owner || !config.repo || !config.token) {
		throw new Error("GitHub owner, repo, and token are required");
	}
}

function normalizeRepoPath(path: string): string {
	const trimmed = path.trim().replace(/^\/+/, "");

	if (!trimmed || trimmed.includes("..")) {
		throw new Error("invalid repository path");
	}

	return trimmed;
}

function encodeURIComponentPath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

function limitText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}

	return `${text.slice(0, maxChars)}\n[truncated]`;
}

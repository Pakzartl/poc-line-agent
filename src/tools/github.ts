import { Buffer } from "node:buffer";
import type { RegisteredTool, ToolResult } from "../agent/tool-runner";
import type { AppConfig } from "../config";

const maxRepositories = 50;
const maxSearchResults = 10;
const maxFileChars = 20_000;
const maxCommitFiles = 20;
const maxGitHubResponseBytes = 750_000;
const maxGenericResultChars = 40_000;
const githubUserAgent = "poc-line-agent/0.1";

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
				name: "list_repositories",
				description:
					"List repositories that the configured GitHub token can read. Use this before assuming a repository name.",
				strict: true,
				parameters: {
					type: "object",
					properties: {},
					required: [],
					additionalProperties: false,
				},
			},
			run: async () => client.listRepositories(),
		},
		{
			definition: {
				type: "function",
				name: "github_get",
				description:
					"Call an allowlisted GitHub REST GET endpoint. Paths may target /user/repos, /repos/{owner}/{repo}/..., /users/{user}/repos, /orgs/{org}/repos, or GitHub search. Mutations and external URLs are blocked.",
				strict: true,
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description:
								"GitHub REST path beginning with /, including an optional query string.",
						},
					},
					required: ["path"],
					additionalProperties: false,
				},
			},
			run: async (argumentsJson) =>
				client.get(getRequiredArg(argumentsJson, "path")),
		},
		{
			definition: {
				type: "function",
				name: "search_code",
				description: "Search source code in one readable GitHub repository.",
				strict: true,
				parameters: {
					type: "object",
					properties: {
						repository: {
							type: "string",
							description: "Repository in owner/name form.",
						},
						query: { type: "string", description: "Code search query." },
					},
					required: ["repository", "query"],
					additionalProperties: false,
				},
			},
			run: async (argumentsJson) =>
				client.searchCode(
					getRequiredArg(argumentsJson, "repository"),
					getRequiredArg(argumentsJson, "query"),
				),
		},
		{
			definition: {
				type: "function",
				name: "read_file",
				description: "Read a text file from one readable GitHub repository.",
				strict: true,
				parameters: {
					type: "object",
					properties: {
						repository: {
							type: "string",
							description: "Repository in owner/name form.",
						},
						path: {
							type: "string",
							description: "Repository-relative file path.",
						},
					},
					required: ["repository", "path"],
					additionalProperties: false,
				},
			},
			run: async (argumentsJson) =>
				client.readFile(
					getRequiredArg(argumentsJson, "repository"),
					getRequiredArg(argumentsJson, "path"),
				),
		},
		{
			definition: {
				type: "function",
				name: "get_commit",
				description:
					"Read commit metadata and touched files from one repository.",
				strict: true,
				parameters: {
					type: "object",
					properties: {
						repository: {
							type: "string",
							description: "Repository in owner/name form.",
						},
						sha: { type: "string", description: "Commit SHA or ref." },
					},
					required: ["repository", "sha"],
					additionalProperties: false,
				},
			},
			run: async (argumentsJson) =>
				client.getCommit(
					getRequiredArg(argumentsJson, "repository"),
					getRequiredArg(argumentsJson, "sha"),
				),
		},
	];
}

function createGitHubClient(config: AppConfig["github"], fetchImpl: FetchLike) {
	async function requestJson<T>(path: string): Promise<T> {
		validateConfig(config);
		const safePath = validateReadPath(path);
		const response = await fetchImpl(`${config.apiBaseUrl}${safePath}`, {
			method: "GET",
			redirect: "manual",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${config.token}`,
				"User-Agent": githubUserAgent,
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});

		if (response.status >= 300 && response.status < 400) {
			throw new Error("GitHub response redirect blocked");
		}
		if (!response.ok) {
			throw new Error(`GitHub request failed with status ${response.status}`);
		}

		const body = await readBoundedText(response, maxGitHubResponseBytes);
		try {
			return JSON.parse(body) as T;
		} catch {
			throw new Error("GitHub response was not JSON");
		}
	}

	return {
		async listRepositories(): Promise<ToolResult> {
			const data = await requestJson<
				{
					full_name: string;
					private?: boolean;
					description?: string | null;
					default_branch?: string;
					html_url?: string;
					archived?: boolean;
				}[]
			>(
				`/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&sort=updated&per_page=${maxRepositories}`,
			);

			return {
				ok: true,
				data: {
					repositories: data.slice(0, maxRepositories).map((repository) => ({
						name: repository.full_name,
						private: repository.private ?? false,
						description: repository.description ?? undefined,
						defaultBranch: repository.default_branch,
						archived: repository.archived ?? false,
						url: repository.html_url,
					})),
				},
			};
		},
		async get(path: string): Promise<ToolResult> {
			const data = await requestJson<unknown>(path);
			const serialized = JSON.stringify(data);
			return {
				ok: true,
				data:
					serialized.length <= maxGenericResultChars
						? data
						: {
								truncated: true,
								json: `${serialized.slice(0, maxGenericResultChars)}...[truncated]`,
							},
			};
		},
		async searchCode(repository: string, query: string): Promise<ToolResult> {
			const repoPath = normalizeRepository(repository);
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
					repository: repoPath,
					files: (data.items ?? []).slice(0, maxSearchResults).map((item) => ({
						path: item.path,
						url: item.html_url,
					})),
				},
			};
		},
		async readFile(repository: string, path: string): Promise<ToolResult> {
			const repoPath = normalizeRepository(repository);
			const safePath = normalizeRepoFilePath(path);
			const data = await requestJson<{
				content?: string;
				encoding?: string;
				path?: string;
				size?: number;
			}>(`/repos/${repoPath}/contents/${encodeURIComponentPath(safePath)}`);

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
					repository: repoPath,
					path: data.path ?? safePath,
					size: data.size,
					content: limitText(decoded, maxFileChars),
				},
			};
		},
		async getCommit(repository: string, sha: string): Promise<ToolResult> {
			const repoPath = normalizeRepository(repository);
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
					repository: repoPath,
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
	if (!config.token) {
		throw new Error("GitHub token is required");
	}
}

function validateReadPath(path: string): string {
	const trimmed = path.trim();
	if (
		!trimmed.startsWith("/") ||
		trimmed.startsWith("//") ||
		trimmed.includes("\\") ||
		trimmed.includes("#")
	) {
		throw new Error("invalid GitHub GET path");
	}

	const url = new URL(trimmed, "https://github.invalid");
	const allowed = [
		/^\/user\/repos$/,
		/^\/repos\/[^/]+\/[^/]+(?:\/.*)?$/,
		/^\/(?:users|orgs)\/[^/]+\/repos$/,
		/^\/search\/(?:code|issues|commits)$/,
	].some((pattern) => pattern.test(url.pathname));
	if (!allowed) {
		throw new Error("GitHub GET path is not allowlisted");
	}

	const perPage = Number(url.searchParams.get("per_page"));
	if (Number.isFinite(perPage) && perPage > 100) {
		url.searchParams.set("per_page", "100");
	}
	return `${url.pathname}${url.search}`;
}

function normalizeRepository(repository: string): string {
	const trimmed = repository.trim();
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
		throw new Error("repository must use owner/name format");
	}
	return trimmed;
}

function normalizeRepoFilePath(path: string): string {
	const trimmed = path.trim().replace(/^\/+/, "");
	if (!trimmed || trimmed.split("/").includes("..")) {
		throw new Error("invalid repository file path");
	}
	return trimmed;
}

function encodeURIComponentPath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}

async function readBoundedText(
	response: Response,
	maxBytes: number,
): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		throw new Error("GitHub response exceeded the size limit");
	}
	if (!response.body) {
		return "";
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				throw new Error("GitHub response exceeded the size limit");
			}
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}

	const body = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}

function limitText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return `${text.slice(0, maxChars)}\n[truncated]`;
}

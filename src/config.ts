export type AppConfig = {
	port: number;
	line: {
		channelSecret: string;
		channelAccessToken: string;
		apiBaseUrl: string;
	};
	llm: {
		apiKey: string;
		baseUrl: string;
		model: string;
		maxToolRounds: number;
	};
	github: {
		owner: string;
		repo: string;
		token: string;
		ref: string;
		apiBaseUrl: string;
	};
	memory: {
		directory: string;
		maxMessages: number;
	};
};

const defaultOpenAiBaseUrl = "https://api.openai.com/v1";
const defaultLineApiBaseUrl = "https://api.line.me";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	return {
		port: Number(env.PORT ?? "3000"),
		line: {
			channelSecret: env.LINE_CHANNEL_SECRET ?? "",
			channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
			apiBaseUrl: stripTrailingSlash(
				env.LINE_API_BASE_URL ?? defaultLineApiBaseUrl,
			),
		},
		llm: {
			apiKey: env.OPENAI_API_KEY ?? "",
			baseUrl: stripTrailingSlash(env.OPENAI_BASE_URL ?? defaultOpenAiBaseUrl),
			model: env.OPENAI_MODEL ?? "gpt-5.4-mini",
			maxToolRounds: Number(env.OPENAI_MAX_TOOL_ROUNDS ?? "6"),
		},
		github: {
			owner: env.GITHUB_OWNER ?? "",
			repo: env.GITHUB_REPO ?? "",
			token: env.GITHUB_TOKEN ?? "",
			ref: env.GITHUB_REF ?? "main",
			apiBaseUrl: stripTrailingSlash(
				env.GITHUB_API_BASE_URL ?? "https://api.github.com",
			),
		},
		memory: {
			directory: env.SESSION_MEMORY_DIR ?? ".sessions",
			maxMessages: Number(env.SESSION_MEMORY_MAX_MESSAGES ?? "12"),
		},
	};
}

export function validateConfig(config: AppConfig): void {
	const requiredValues = [
		["LINE_CHANNEL_SECRET", config.line.channelSecret],
		["LINE_CHANNEL_ACCESS_TOKEN", config.line.channelAccessToken],
		["OPENAI_API_KEY", config.llm.apiKey],
		["OPENAI_MODEL", config.llm.model],
		["GITHUB_OWNER", config.github.owner],
		["GITHUB_REPO", config.github.repo],
		["GITHUB_TOKEN", config.github.token],
	] as const;
	const missing = requiredValues
		.filter(([, value]) => !value.trim())
		.map(([name]) => name);

	if (missing.length > 0) {
		throw new Error(
			`Missing required environment variables: ${missing.join(", ")}`,
		);
	}

	if (
		!Number.isInteger(config.port) ||
		config.port < 1 ||
		config.port > 65_535
	) {
		throw new Error("PORT must be an integer between 1 and 65535");
	}

	if (
		!Number.isInteger(config.llm.maxToolRounds) ||
		config.llm.maxToolRounds < 0 ||
		config.llm.maxToolRounds > 20
	) {
		throw new Error(
			"OPENAI_MAX_TOOL_ROUNDS must be an integer between 0 and 20",
		);
	}

	if (
		!Number.isInteger(config.memory.maxMessages) ||
		config.memory.maxMessages < 2 ||
		config.memory.maxMessages > 100
	) {
		throw new Error(
			"SESSION_MEMORY_MAX_MESSAGES must be an integer between 2 and 100",
		);
	}

	if (!config.memory.directory.trim()) {
		throw new Error("SESSION_MEMORY_DIR is required");
	}

	for (const [name, value] of [
		["OPENAI_BASE_URL", config.llm.baseUrl],
		["LINE_API_BASE_URL", config.line.apiBaseUrl],
		["GITHUB_API_BASE_URL", config.github.apiBaseUrl],
	] as const) {
		try {
			new URL(value);
		} catch {
			throw new Error(`${name} must be a valid URL`);
		}
	}
}

function stripTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

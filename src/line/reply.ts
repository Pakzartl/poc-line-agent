export type LineReplyClient = {
	reply(replyToken: string, text: string): Promise<void>;
};

export type LineReplyClientOptions = {
	channelAccessToken: string;
	apiBaseUrl?: string;
	fetch?: typeof fetch;
};

export function createLineReplyClient(
	options: LineReplyClientOptions,
): LineReplyClient {
	const fetchImpl = options.fetch ?? fetch;
	const apiBaseUrl = options.apiBaseUrl ?? "https://api.line.me";

	return {
		async reply(replyToken, text) {
			if (!options.channelAccessToken) {
				throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required");
			}

			const response = await fetchImpl(`${apiBaseUrl}/v2/bot/message/reply`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${options.channelAccessToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					replyToken,
					messages: [{ type: "text", text: limitLineText(text) }],
				}),
			});

			if (!response.ok) {
				throw new Error(`LINE reply failed with status ${response.status}`);
			}
		},
	};
}

export function limitLineText(text: string): string {
	if (text.length <= 4_900) {
		return text;
	}

	return `${text.slice(0, 4_850)}\n\n[truncated]`;
}

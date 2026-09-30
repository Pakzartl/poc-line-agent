export type TelegramReplyClient = {
	reply(
		chatId: number | string,
		text: string,
		messageId?: number,
	): Promise<void>;
};

export function createTelegramReplyClient(options: {
	botToken: string;
	apiBaseUrl?: string;
	fetch?: typeof fetch;
}): TelegramReplyClient {
	const fetchImpl = options.fetch ?? fetch;
	const apiBaseUrl = options.apiBaseUrl ?? "https://api.telegram.org";

	return {
		async reply(chatId, text, messageId) {
			if (!options.botToken) {
				throw new Error("TELEGRAM_BOT_TOKEN is required");
			}

			const response = await fetchImpl(
				`${apiBaseUrl}/bot${options.botToken}/sendMessage`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chat_id: chatId,
						text: limitTelegramText(text),
						...(messageId
							? { reply_parameters: { message_id: messageId } }
							: {}),
					}),
				},
			);

			if (!response.ok) {
				throw new Error(`Telegram reply failed with status ${response.status}`);
			}
		},
	};
}

export function limitTelegramText(text: string): string {
	return text.length <= 4_096 ? text : `${text.slice(0, 4_046)}\n\n[truncated]`;
}

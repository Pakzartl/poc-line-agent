import { formatTelegramMessage, limitTelegramText } from "./format";

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

			const message = formatTelegramMessage(text);
			let response = await sendMessage(message.html, "HTML");
			if (response.status === 400) {
				response = await sendMessage(message.plainText);
			}

			if (!response.ok) {
				throw new Error(`Telegram reply failed with status ${response.status}`);
			}

			async function sendMessage(
				messageText: string,
				parseMode?: "HTML",
			): Promise<Response> {
				return fetchImpl(`${apiBaseUrl}/bot${options.botToken}/sendMessage`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						chat_id: chatId,
						text: messageText,
						...(parseMode ? { parse_mode: parseMode } : {}),
						...(messageId
							? { reply_parameters: { message_id: messageId } }
							: {}),
					}),
				});
			}
		},
	};
}

export { limitTelegramText };

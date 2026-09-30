export type WhatsAppReplyClient = {
	reply(recipient: string, text: string, messageId?: string): Promise<void>;
};

export function createWhatsAppReplyClient(options: {
	accessToken: string;
	phoneNumberId: string;
	apiBaseUrl?: string;
	fetch?: typeof fetch;
}): WhatsAppReplyClient {
	const fetchImpl = options.fetch ?? fetch;
	const apiBaseUrl = options.apiBaseUrl ?? "https://graph.facebook.com/v26.0";

	return {
		async reply(recipient, text, messageId) {
			if (!options.accessToken || !options.phoneNumberId) {
				throw new Error(
					"WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required",
				);
			}

			const response = await fetchImpl(
				`${apiBaseUrl}/${encodeURIComponent(options.phoneNumberId)}/messages`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${options.accessToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						messaging_product: "whatsapp",
						to: recipient,
						type: "text",
						text: { body: limitWhatsAppText(text), preview_url: false },
						...(messageId ? { context: { message_id: messageId } } : {}),
					}),
				},
			);

			if (!response.ok) {
				throw new Error(`WhatsApp reply failed with status ${response.status}`);
			}
		},
	};
}

export function limitWhatsAppText(text: string): string {
	return text.length <= 4_096 ? text : `${text.slice(0, 4_046)}\n\n[truncated]`;
}

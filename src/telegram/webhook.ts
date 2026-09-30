import { timingSafeEqual } from "node:crypto";
import type { AgentOrchestrator } from "../agent/orchestrator";
import { answerConversation } from "../agent/conversation";
import type { AppConfig } from "../config";
import type { SessionMemoryStore } from "../memory/session-memory";
import type { TelegramReplyClient } from "./reply";

type TelegramUpdate = {
	message?: {
		message_id?: number;
		text?: string;
		from?: { is_bot?: boolean };
		chat?: { id?: number | string };
	};
};

export type TelegramWebhookDeps = {
	config: AppConfig;
	orchestrator: AgentOrchestrator;
	telegramReplyClient: TelegramReplyClient;
	memoryStore: SessionMemoryStore;
};

export async function handleTelegramWebhook(
	request: Request,
	deps: TelegramWebhookDeps,
): Promise<Response> {
	if (
		!secretsMatch(
			request.headers.get("x-telegram-bot-api-secret-token"),
			deps.config.telegram.webhookSecret,
		)
	) {
		return new Response("invalid secret", { status: 401 });
	}

	let update: TelegramUpdate;
	try {
		update = (await request.json()) as TelegramUpdate;
	} catch {
		return new Response("invalid json", { status: 400 });
	}

	const message = update.message;
	if (
		!message?.text ||
		message.chat?.id === undefined ||
		message.from?.is_bot
	) {
		return Response.json({ ok: true });
	}

	const chatId = message.chat.id;
	const answer = await answerConversation(
		{
			question: message.text,
			sessionId: `telegram:chat:${chatId}`,
		},
		deps,
	);
	await deps.telegramReplyClient.reply(chatId, answer, message.message_id);

	return Response.json({ ok: true });
}

function secretsMatch(received: string | null, expected: string): boolean {
	if (!received || !expected) {
		return false;
	}
	const receivedBytes = Buffer.from(received);
	const expectedBytes = Buffer.from(expected);
	return (
		receivedBytes.length === expectedBytes.length &&
		timingSafeEqual(receivedBytes, expectedBytes)
	);
}

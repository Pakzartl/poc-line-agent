import { timingSafeEqual } from "node:crypto";
import { answerConversation } from "../agent/conversation";
import { ResponsesApiError } from "../agent/llm-client";
import type { AgentOrchestrator } from "../agent/orchestrator";
import type { AppConfig } from "../config";
import type { SessionMemoryStore } from "../memory/types";
import type { TelegramReplyClient } from "./reply";
import type { TelegramUpdateStore } from "./update-store";

type TelegramUpdate = {
	update_id?: number | string;
	message?: {
		message_id?: number;
		text?: string;
		from?: { id?: number | string; is_bot?: boolean };
		chat?: { id?: number | string };
	};
};

export type TelegramWebhookDeps = {
	config: AppConfig;
	orchestrator: AgentOrchestrator;
	telegramReplyClient: TelegramReplyClient;
	telegramUpdateStore: TelegramUpdateStore;
	memoryStore: SessionMemoryStore;
};

const temporaryAiFailureMessage =
	"ระบบ AI มีคำขอหนาแน่นชั่วคราว กรุณาลองใหม่อีกครั้งในอีกสักครู่ครับ";
const permanentAiFailureMessage =
	"ระบบ AI ไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบเพื่อตรวจสอบโควตาหรือการตั้งค่าครับ";

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
		message.from?.id === undefined ||
		message.from?.is_bot
	) {
		return Response.json({ ok: true });
	}

	const chatId = message.chat.id;
	const userId = String(message.from.id);
	const updateId = getUpdateId(update, message);
	if (updateId && (await deps.telegramUpdateStore.has(updateId))) {
		return Response.json({ ok: true, duplicate: true });
	}

	const replyAndMark = async (text: string): Promise<Response> => {
		await deps.telegramReplyClient.reply(chatId, text, message.message_id);
		if (updateId) {
			try {
				await deps.telegramUpdateStore.mark(updateId);
			} catch (error) {
				console.error(
					JSON.stringify({
						message: "telegram update marker failed",
						updateId,
						error: error instanceof Error ? error.message : "Unknown error",
					}),
				);
			}
		}
		return Response.json({ ok: true });
	};

	if (isWhoAmICommand(message.text)) {
		return replyAndMark(`Your Telegram user ID is: ${userId}`);
	}

	if (!deps.config.telegram.allowedUserIds.includes(userId)) {
		return replyAndMark(`Access denied. Your Telegram user ID is: ${userId}`);
	}

	try {
		const answer = await answerConversation(
			{
				question: message.text,
				sessionId: `telegram:chat:${chatId}`,
			},
			deps,
		);
		return replyAndMark(answer);
	} catch (error) {
		if (!(error instanceof ResponsesApiError)) {
			throw error;
		}

		console.error(
			JSON.stringify({
				message: "telegram agent request failed",
				provider: "openai",
				status: error.status,
				code: error.code ?? "unknown",
				requestId: error.requestId ?? "unknown",
				attempts: error.attempts,
				retryable: error.retryable,
			}),
		);
		return replyAndMark(
			error.retryable ? temporaryAiFailureMessage : permanentAiFailureMessage,
		);
	}
}

function getUpdateId(
	update: TelegramUpdate,
	message: NonNullable<TelegramUpdate["message"]>,
): string | undefined {
	if (update.update_id !== undefined) {
		return String(update.update_id);
	}
	if (message.message_id !== undefined && message.chat?.id !== undefined) {
		return `message:${message.chat.id}:${message.message_id}`;
	}
	return undefined;
}

function isWhoAmICommand(text: string): boolean {
	return /^\/whoami(?:@\w+)?(?:\s|$)/i.test(text.trim());
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

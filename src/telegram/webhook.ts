import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config";
import type { TelegramJobQueue } from "./job";
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
	telegramJobQueue: TelegramJobQueue;
	telegramReplyClient: TelegramReplyClient;
	telegramUpdateStore: TelegramUpdateStore;
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
		message.from?.id === undefined ||
		message.from?.is_bot
	) {
		return Response.json({ ok: true });
	}

	const chatId = message.chat.id;
	const userId = String(message.from.id);
	const updateId = getUpdateId(update, message);
	if (updateId) {
		try {
			if (!(await deps.telegramUpdateStore.claim(updateId))) {
				return Response.json({ ok: true, duplicate: true });
			}
		} catch (error) {
			console.error(
				JSON.stringify({
					message: "telegram update claim failed",
					updateId,
					error: error instanceof Error ? error.message : "Unknown error",
				}),
			);
		}
	}

	const replyAndComplete = async (text: string): Promise<Response> => {
		await deps.telegramReplyClient.reply(chatId, text, message.message_id);
		if (updateId) {
			try {
				await deps.telegramUpdateStore.complete(updateId);
			} catch (error) {
				console.error(
					JSON.stringify({
						message: "telegram update completion failed",
						updateId,
						error: error instanceof Error ? error.message : "Unknown error",
					}),
				);
			}
		}
		return Response.json({ ok: true });
	};

	if (isWhoAmICommand(message.text)) {
		return replyAndComplete(`Your Telegram user ID is: ${userId}`);
	}

	if (!deps.config.telegram.allowedUserIds.includes(userId)) {
		return replyAndComplete(
			`Access denied. Your Telegram user ID is: ${userId}`,
		);
	}

	try {
		await deps.telegramJobQueue.send({
			updateId,
			chatId,
			messageId: message.message_id,
			text: message.text,
		});
		return Response.json({ ok: true, accepted: true });
	} catch (error) {
		if (updateId) {
			try {
				await deps.telegramUpdateStore.release(updateId);
			} catch (releaseError) {
				console.error(
					JSON.stringify({
						message: "telegram update release failed",
						updateId,
						error:
							releaseError instanceof Error
								? releaseError.message
								: "Unknown error",
					}),
				);
			}
		}
		throw error;
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

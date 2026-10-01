import { ResponsesApiError } from "../agent/llm-client";
import type { AgentOrchestrator } from "../agent/orchestrator";
import type { SessionMemoryStore } from "../memory/types";
import type { TelegramReplyClient } from "./reply";
import type { TelegramUpdateStore } from "./update-store";

export type TelegramJob = {
	updateId?: string;
	chatId: number | string;
	messageId?: number;
	text: string;
};

export type TelegramJobQueue = {
	send(job: TelegramJob): Promise<void>;
};

export type TelegramJobProcessorDeps = {
	orchestrator: AgentOrchestrator;
	telegramReplyClient: TelegramReplyClient;
	telegramUpdateStore: TelegramUpdateStore;
	memoryStore: SessionMemoryStore;
};

type TelegramQueueMessage = {
	body: TelegramJob;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
};

const maxDeliveryAttempts = 3;
const temporaryAiFailureMessage =
	"ระบบ AI มีคำขอหนาแน่นชั่วคราว กรุณาลองใหม่อีกครั้งในอีกสักครู่ครับ";
const permanentAiFailureMessage =
	"ระบบ AI ไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบเพื่อตรวจสอบโควตาหรือการตั้งค่าครับ";
const unexpectedFailureMessage =
	"เกิดข้อผิดพลาดระหว่างประมวลผล กรุณาลองส่งคำขออีกครั้งครับ";

export function createInlineTelegramJobQueue(
	deps: TelegramJobProcessorDeps,
): TelegramJobQueue {
	return {
		send: async (job) => processTelegramJob(job, deps),
	};
}

export async function processTelegramQueueMessage(
	message: TelegramQueueMessage,
	deps: TelegramJobProcessorDeps,
): Promise<void> {
	try {
		await processTelegramJob(message.body, deps);
		message.ack();
	} catch (error) {
		const retryable = !(error instanceof ResponsesApiError) || error.retryable;
		if (retryable && message.attempts < maxDeliveryAttempts) {
			const delaySeconds = 30 * 2 ** Math.max(0, message.attempts - 1);
			console.warn(
				JSON.stringify({
					message: "telegram agent job retry",
					updateId: message.body.updateId ?? "unknown",
					attempt: message.attempts,
					delaySeconds,
					error: describeError(error),
				}),
			);
			message.retry({ delaySeconds });
			return;
		}

		console.error(
			JSON.stringify({
				message: "telegram agent job failed",
				updateId: message.body.updateId ?? "unknown",
				attempt: message.attempts,
				error: describeError(error),
			}),
		);
		await notifyFailure(message.body, error, deps);
		await completeUpdate(message.body.updateId, deps.telegramUpdateStore);
		message.ack();
	}
}

async function processTelegramJob(
	job: TelegramJob,
	deps: TelegramJobProcessorDeps,
): Promise<void> {
	const sessionId = `telegram:chat:${job.chatId}`;
	const history = await deps.memoryStore.read(sessionId);
	const answer = await deps.orchestrator.answer(job.text, history);
	await deps.telegramReplyClient.reply(job.chatId, answer, job.messageId);
	try {
		await deps.memoryStore.append(sessionId, [
			{ role: "user", content: job.text },
			{ role: "assistant", content: answer },
		]);
	} catch (error) {
		console.error(
			JSON.stringify({
				message: "telegram memory append failed",
				updateId: job.updateId ?? "unknown",
				error: describeError(error),
			}),
		);
	}
	await completeUpdate(job.updateId, deps.telegramUpdateStore);
}

async function notifyFailure(
	job: TelegramJob,
	error: unknown,
	deps: TelegramJobProcessorDeps,
): Promise<void> {
	const text =
		error instanceof ResponsesApiError
			? error.retryable
				? temporaryAiFailureMessage
				: permanentAiFailureMessage
			: unexpectedFailureMessage;
	await deps.telegramReplyClient.reply(job.chatId, text, job.messageId);
}

async function completeUpdate(
	updateId: string | undefined,
	store: TelegramUpdateStore,
): Promise<void> {
	if (!updateId) {
		return;
	}
	try {
		await store.complete(updateId);
	} catch (error) {
		console.error(
			JSON.stringify({
				message: "telegram update completion failed",
				updateId,
				error: describeError(error),
			}),
		);
	}
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown error";
}

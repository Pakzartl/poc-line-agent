import type { AgentOrchestrator } from "../agent/orchestrator";
import type { AppConfig } from "../config";
import type { SessionMemoryStore } from "../memory/session-memory";
import type { LineReplyClient } from "./reply";
import { verifyLineSignature } from "./signature";

type LineTextMessageEvent = {
	type: "message";
	replyToken?: string;
	message?: {
		type: "text";
		text?: string;
	};
	source?: {
		type?: "user" | "group" | "room";
		userId?: string;
		groupId?: string;
		roomId?: string;
	};
	memoryEnabled?: boolean;
};

type LineWebhookBody = {
	events?: LineTextMessageEvent[];
};

export type WebhookDeps = {
	config: AppConfig;
	orchestrator: AgentOrchestrator;
	lineReplyClient: LineReplyClient;
	memoryStore: SessionMemoryStore;
};

export async function handleLineWebhook(
	request: Request,
	deps: WebhookDeps,
): Promise<Response> {
	const rawBody = await request.text();
	const signature = request.headers.get("x-line-signature");

	if (
		!verifyLineSignature(rawBody, deps.config.line.channelSecret, signature)
	) {
		return new Response("invalid signature", { status: 401 });
	}

	const body = parseWebhookBody(rawBody);

	if (!body) {
		return new Response("invalid json", { status: 400 });
	}

	const textEvents = extractTextEvents(body);

	for (const event of textEvents) {
		const memoryEnabled = event.memoryEnabled ?? true;
		const history =
			memoryEnabled && event.sessionId
				? await deps.memoryStore.read(event.sessionId)
				: [];
		const answer = await deps.orchestrator.answer(event.text, history);
		await deps.lineReplyClient.reply(event.replyToken, answer);
		if (memoryEnabled && event.sessionId) {
			await deps.memoryStore.append(event.sessionId, [
				{ role: "user", content: event.text },
				{ role: "assistant", content: answer },
			]);
		}
	}

	return Response.json({ ok: true });
}

export function extractTextEvents(body: LineWebhookBody): {
	replyToken: string;
	text: string;
	sessionId?: string;
	memoryEnabled?: boolean;
}[] {
	return (body.events ?? []).flatMap((event) => {
		if (
			event.type !== "message" ||
			event.message?.type !== "text" ||
			!event.message.text ||
			!event.replyToken
		) {
			return [];
		}

		const sessionId = getSessionId(event.source);
		return [
			{
				replyToken: event.replyToken,
				text: event.message.text,
				...(sessionId ? { sessionId } : {}),
				...(typeof event.memoryEnabled === "boolean"
					? { memoryEnabled: event.memoryEnabled }
					: {}),
			},
		];
	});
}

function getSessionId(
	source: LineTextMessageEvent["source"],
): string | undefined {
	if (source?.type === "group" && source.groupId) {
		return `group:${source.groupId}`;
	}
	if (source?.type === "room" && source.roomId) {
		return `room:${source.roomId}`;
	}
	if (source?.userId) {
		return `user:${source.userId}`;
	}
	return undefined;
}

function parseWebhookBody(rawBody: string): LineWebhookBody | null {
	try {
		return JSON.parse(rawBody) as LineWebhookBody;
	} catch {
		return null;
	}
}

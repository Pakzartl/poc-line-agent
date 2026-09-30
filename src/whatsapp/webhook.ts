import type { AgentOrchestrator } from "../agent/orchestrator";
import { answerConversation } from "../agent/conversation";
import type { AppConfig } from "../config";
import type { SessionMemoryStore } from "../memory/types";
import type { WhatsAppReplyClient } from "./reply";
import { verifyWhatsAppSignature } from "./signature";

type WhatsAppWebhookBody = {
	entry?: {
		changes?: {
			field?: string;
			value?: {
				messages?: {
					from?: string;
					id?: string;
					type?: string;
					text?: { body?: string };
				}[];
			};
		}[];
	}[];
};

export type WhatsAppWebhookDeps = {
	config: AppConfig;
	orchestrator: AgentOrchestrator;
	whatsAppReplyClient: WhatsAppReplyClient;
	memoryStore: SessionMemoryStore;
};

export function handleWhatsAppVerification(
	request: Request,
	config: AppConfig,
): Response {
	const url = new URL(request.url);
	const mode = url.searchParams.get("hub.mode");
	const token = url.searchParams.get("hub.verify_token");
	const challenge = url.searchParams.get("hub.challenge");

	if (
		mode !== "subscribe" ||
		token !== config.whatsapp.verifyToken ||
		!challenge
	) {
		return new Response("verification failed", { status: 403 });
	}

	return new Response(challenge, { status: 200 });
}

export async function handleWhatsAppWebhook(
	request: Request,
	deps: WhatsAppWebhookDeps,
): Promise<Response> {
	const rawBody = await request.text();
	if (
		!verifyWhatsAppSignature(
			rawBody,
			deps.config.whatsapp.appSecret,
			request.headers.get("x-hub-signature-256"),
		)
	) {
		return new Response("invalid signature", { status: 401 });
	}

	let body: WhatsAppWebhookBody;
	try {
		body = JSON.parse(rawBody) as WhatsAppWebhookBody;
	} catch {
		return new Response("invalid json", { status: 400 });
	}

	for (const message of extractWhatsAppTextMessages(body)) {
		const answer = await answerConversation(
			{
				question: message.text,
				sessionId: `whatsapp:user:${message.from}`,
			},
			deps,
		);
		await deps.whatsAppReplyClient.reply(message.from, answer, message.id);
	}

	return Response.json({ ok: true });
}

export function extractWhatsAppTextMessages(body: WhatsAppWebhookBody): {
	from: string;
	id?: string;
	text: string;
}[] {
	return (body.entry ?? []).flatMap((entry) =>
		(entry.changes ?? []).flatMap((change) =>
			(change.value?.messages ?? []).flatMap((message) => {
				if (
					change.field !== "messages" ||
					message.type !== "text" ||
					!message.from ||
					!message.text?.body
				) {
					return [];
				}
				return [
					{
						from: message.from,
						text: message.text.body,
						...(message.id ? { id: message.id } : {}),
					},
				];
			}),
		),
	);
}

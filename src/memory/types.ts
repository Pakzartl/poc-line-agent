export type ConversationMessage = {
	role: "user" | "assistant";
	content: string;
};

export type SessionMemoryStore = {
	read(sessionId: string): Promise<ConversationMessage[]>;
	append(
		sessionId: string,
		messages: ConversationMessage[],
	): Promise<ConversationMessage[]>;
	clear(sessionId: string): Promise<void>;
};

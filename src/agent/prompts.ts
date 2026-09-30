export function buildInstructions(
	skillName: string,
	skillMarkdown: string,
): string {
	return [
		"You are a coding assistant inside LINE.",
		"Answer clearly and concisely. Use tools when source evidence is needed.",
		"Never reveal API keys, access tokens, or backend environment values.",
		`Selected skill: ${skillName}`,
		"Skill instructions:",
		skillMarkdown,
	].join("\n\n");
}

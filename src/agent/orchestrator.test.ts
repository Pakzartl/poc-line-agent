import { describe, expect, test } from "bun:test";
import { loadConfig } from "../config";
import { createAgentOrchestrator } from "./orchestrator";
import type { ResponsesClient, ResponsesInputItem } from "./llm-client";
import type { SkillManager } from "./skill-manager";
import { createToolRunner } from "./tool-runner";

describe("agent orchestrator", () => {
	test("runs a Responses API tool loop and returns the final answer", async () => {
		const seenInputs: ResponsesInputItem[][] = [];
		const responsesClient: ResponsesClient = {
			create: async ({ items }) => {
				seenInputs.push([...items]);

				if (seenInputs.length === 1) {
					return {
						output: [
							{
								type: "function_call",
								call_id: "call-1",
								name: "search_code",
								arguments: '{"query":"login"}',
							},
						],
					};
				}

				return {
					output_text: "Found login failure in src/auth/login.ts.",
					output: [
						{
							type: "message",
							content: [
								{
									type: "output_text",
									text: "Found login failure in src/auth/login.ts.",
								},
							],
						},
					],
				};
			},
		};
		const skillManager: SkillManager = {
			selectSkill: () => "bug-investigator",
			loadSkill: async () => "# Bug Investigator",
		};
		const toolRunner = createToolRunner([
			{
				definition: {
					type: "function",
					name: "search_code",
					description: "Search code",
					strict: true,
					parameters: {
						type: "object",
						properties: { query: { type: "string" } },
						required: ["query"],
						additionalProperties: false,
					},
				},
				run: async () => ({ ok: true, data: { files: ["src/auth/login.ts"] } }),
			},
		]);

		const answer = await createAgentOrchestrator({
			skillManager,
			responsesClient,
			toolRunner,
			maxToolRounds: 3,
		}).answer("what was its path?", [
			{ role: "user", content: "find the login failure" },
			{
				role: "assistant",
				content: "I found the login implementation.",
			},
		]);

		expect(answer).toBe("Found login failure in src/auth/login.ts.");
		expect(seenInputs[0]?.slice(0, 3)).toEqual([
			{ role: "user", content: "find the login failure" },
			{ role: "assistant", content: "I found the login implementation." },
			{ role: "user", content: "what was its path?" },
		]);
		expect(seenInputs[1]).toContainEqual({
			type: "function_call_output",
			call_id: "call-1",
			output: JSON.stringify({
				ok: true,
				data: { files: ["src/auth/login.ts"] },
			}),
		});
	});

	test("allows a repository analysis to complete after eight tool calls", async () => {
		let responseCount = 0;
		const responsesClient: ResponsesClient = {
			create: async () => {
				responseCount += 1;
				if (responseCount <= 8) {
					return {
						output: [
							{
								type: "function_call",
								call_id: `call-${responseCount}`,
								name: "github_get",
								arguments: '{"path":"/repos/acme/api/contents"}',
							},
						],
					};
				}

				return {
					output_text: "Architecture summary complete.",
					output: [],
				};
			},
		};
		const skillManager: SkillManager = {
			selectSkill: () => "architecture-map",
			loadSkill: async () => "# Architecture Map",
		};
		const toolRunner = createToolRunner([
			{
				definition: {
					type: "function",
					name: "github_get",
					description: "Read GitHub data",
					strict: true,
					parameters: {
						type: "object",
						properties: { path: { type: "string" } },
						required: ["path"],
						additionalProperties: false,
					},
				},
				run: async () => ({ ok: true, data: {} }),
			},
		]);

		const answer = await createAgentOrchestrator({
			skillManager,
			responsesClient,
			toolRunner,
			maxToolRounds: loadConfig({}).llm.maxToolRounds,
		}).answer("อธิบาย architecture ของ acme/api");

		expect(answer).toBe("Architecture summary complete.");
		expect(responseCount).toBe(9);
	});
});

import { describe, expect, test } from "bun:test";
import { loadConfig } from "../config";
import type { ResponsesClient, ResponsesInputItem } from "./llm-client";
import { createAgentOrchestrator } from "./orchestrator";
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
			maxToolCalls: 10,
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
			maxToolCalls: loadConfig({}).llm.maxToolCalls,
		}).answer("อธิบาย architecture ของ acme/api");

		expect(answer).toBe("Architecture summary complete.");
		expect(responseCount).toBe(9);
	});

	test("returns a best-effort synthesis after exhausting the tool budget", async () => {
		const seenToolCounts: number[] = [];
		const responsesClient: ResponsesClient = {
			create: async ({ tools }) => {
				seenToolCounts.push(tools.length);
				if (tools.length > 0) {
					return {
						output: [
							{
								type: "function_call",
								call_id: `call-${seenToolCounts.length}`,
								name: "github_get",
								arguments: '{"path":"/repos/acme/api/contents"}',
							},
						],
					};
				}

				return {
					output_text: "สรุปจากข้อมูลที่ตรวจได้ก่อนถึงเพดาน",
					output: [],
				};
			},
		};
		const skillManager: SkillManager = {
			selectSkill: () => "find-code",
			loadSkill: async () => "# Find Code",
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
				run: async () => ({ ok: true, data: { path: "src/rate-limit.ts" } }),
			},
		]);

		const answer = await createAgentOrchestrator({
			skillManager,
			responsesClient,
			toolRunner,
			maxToolRounds: 2,
			maxToolCalls: 10,
		}).answer("list custom rate limit");

		expect(answer).toBe("สรุปจากข้อมูลที่ตรวจได้ก่อนถึงเพดาน");
		expect(seenToolCounts).toEqual([1, 1, 0]);
	});

	test("stops executing tools at the total tool-call budget", async () => {
		let responseCount = 0;
		let executed = 0;
		const finalInputs: ResponsesInputItem[][] = [];
		const responsesClient: ResponsesClient = {
			create: async ({ items, tools }) => {
				responseCount += 1;
				if (tools.length > 0) {
					return {
						output: [1, 2, 3].map((index) => ({
							type: "function_call" as const,
							call_id: `call-${index}`,
							name: "github_get",
							arguments: '{"path":"/repos/acme/api"}',
						})),
					};
				}
				finalInputs.push(items);
				return { output_text: "สรุปหลังถึงเพดานรวม", output: [] };
			},
		};
		const skillManager: SkillManager = {
			selectSkill: () => "find-code",
			loadSkill: async () => "# Find Code",
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
				run: async () => {
					executed += 1;
					return { ok: true, data: {} };
				},
			},
		]);

		const answer = await createAgentOrchestrator({
			skillManager,
			responsesClient,
			toolRunner,
			maxToolRounds: 50,
			maxToolCalls: 2,
		}).answer("audit the repository");

		expect(answer).toBe("สรุปหลังถึงเพดานรวม");
		expect(responseCount).toBe(2);
		expect(executed).toBe(2);
		expect(finalInputs[0]).toContainEqual({
			type: "function_call_output",
			call_id: "call-3",
			output: JSON.stringify({
				ok: false,
				error: "Total tool-call budget exhausted",
			}),
		});
	});
});

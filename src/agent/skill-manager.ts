export type SkillName = "debugging" | "code-review" | "architecture";

const skillKeywords: { name: SkillName; terms: string[] }[] = [
	{
		name: "code-review",
		terms: ["review", "pr", "security", "bug risk", "regression"],
	},
	{
		name: "architecture",
		terms: ["architecture", "design", "flow", "system", "scale"],
	},
	{
		name: "debugging",
		terms: [
			"bug",
			"error",
			"failed",
			"fail",
			"500",
			"debug",
			"exception",
			"why",
		],
	},
];

export type SkillManager = {
	selectSkill(question: string): SkillName;
	loadSkill(name: SkillName): Promise<string>;
};

export type SkillLoader = (name: SkillName) => Promise<string>;

export function createSkillManager(loadSkill: SkillLoader): SkillManager {
	return {
		selectSkill(question) {
			const normalized = question.toLowerCase();
			return (
				skillKeywords.find((skill) =>
					skill.terms.some((term) => normalized.includes(term)),
				)?.name ?? "debugging"
			);
		},
		loadSkill,
	};
}

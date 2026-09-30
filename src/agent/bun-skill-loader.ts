import type { SkillLoader } from "./skill-manager";

export function createBunSkillLoader(
	baseUrl = new URL("../skills/", import.meta.url),
): SkillLoader {
	return async (name) => {
		const file = Bun.file(new URL(`${name}.md`, baseUrl));
		if (!(await file.exists())) {
			throw new Error(`Skill not found: ${name}`);
		}

		return file.text();
	};
}

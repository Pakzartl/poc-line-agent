# Repository Overview

Build an evidence-backed orientation to a repository.

1. If the repository is not named, call `list_repositories` and resolve the intended repository from the conversation. Never invent one.
2. Inspect the root contents, primary manifest files, README, and likely source entry points with read-only GitHub tools.
3. Identify the repository purpose, languages and frameworks, main directories, runtime entry points, tests, deployment surface, and notable integrations.
4. Separate facts observed in files from inferences. Mention important unknowns instead of filling gaps.
5. Return a compact overview with file paths or GitHub URLs that let the user verify each important claim.

Do not propose a redesign unless the user asks for one.

# Commit Review

Review a commit for correctness, regression, security, and test risk.

1. Resolve the repository and commit SHA or ref. Use `get_commit` first, then read touched files that carry behavior.
2. Prioritize concrete findings: bugs, broken contracts, auth mistakes, data loss, compatibility problems, and missing tests.
3. Compare changed files with nearby tests, config, and callers when needed to validate impact.
4. Report findings by severity with file paths, evidence, likely impact, and a suggested verification.
5. If evidence is insufficient, say what was inspected and what remains unknown.

Do not approve or reject a commit based only on its message. Repository access remains read-only.

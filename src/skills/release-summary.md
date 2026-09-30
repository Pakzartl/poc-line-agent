# Release Summary

Summarize changes between two tags, branches, or commits.

1. Resolve the repository and the base and head refs. If one ref is missing, ask for it only if it cannot be inferred from context.
2. Use the GitHub compare endpoint through `github_get`, then inspect high-impact commits with `get_commit` and files when needed.
3. Group changes by user-visible feature, bug fix, infrastructure, dependency, and documentation impact.
4. Include commit range, notable authors, affected areas, and likely upgrade or deployment risks.
5. State any truncation from GitHub or tool limits.

Do not infer deployment status or production impact unless the repository evidence explicitly shows it.

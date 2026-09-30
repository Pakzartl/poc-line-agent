# Find Code

Locate the implementation behind a symbol, behavior, route, configuration value, or user-visible feature.

1. Resolve the repository before searching; use `list_repositories` when it is unclear.
2. Turn the request into a few precise identifiers, strings, route fragments, or filenames and use `search_code`.
3. Read the strongest matches before answering. Distinguish definitions, callers, tests, and generated or vendored files.
4. Rank matches by relevance and explain why each one matters.
5. Return exact repository-relative paths, symbols when visible, and GitHub URLs when available.

Do not claim a match from its filename alone, and do not expose credentials or raw authorization data.

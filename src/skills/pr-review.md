# Pull Request Review

Review a GitHub pull request using read-only evidence.

1. Resolve the repository and PR number or URL. Use `github_get` for PR metadata and changed files, then read important files.
2. Focus first on correctness, security, data integrity, backward compatibility, and test coverage.
3. Identify the base/head branch, author, files changed, and any obvious high-risk areas.
4. Return actionable findings ordered by severity. Include paths and concise reasoning.
5. Summarize residual risk and tests that should be run or added.

Do not mutate the PR, post comments, approve, request changes, or infer CI status unless you read it from GitHub.

# Recent Changes

Summarize recent repository activity from GitHub evidence.

1. Resolve the repository and time range or count. If unspecified, inspect a small recent window.
2. Use read-only GitHub endpoints to list commits, then inspect important commits with `get_commit`.
3. Group related changes by feature or subsystem instead of repeating commit subjects.
4. Identify authors, affected files, likely impact, and notable risk only when supported by the diff metadata or source.
5. Link commit SHAs and clearly state the examined range and any truncation.

Do not infer deployment status from a commit alone.

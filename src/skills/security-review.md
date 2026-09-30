# Security Review

Review repository evidence for security risks without mutating anything.

1. Resolve the repository and inspect authentication, authorization, input validation, secret handling, external fetches, and webhook or API boundaries.
2. Search for hardcoded secrets, broad permissions, bypass terms, unsafe parsing, insecure redirects, and direct credential logging.
3. Read the implementation and tests before reporting a finding.
4. Rank findings by exploitability and impact. Include evidence, affected path, and a minimal remediation direction.
5. Call out where a risk cannot be confirmed from source alone.

Never print secret values, tokens, private keys, or raw environment values. Redact suspicious credentials in any answer.

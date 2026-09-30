# Incident Triage

Assess an incident or production symptom against repository evidence and recent changes.

1. Extract the symptom, error text, time window, affected endpoint or job, and expected behavior from the conversation.
2. Resolve the repository, search exact errors and relevant components, then inspect recent commits if a time window or deployment ref is provided.
3. Rank hypotheses by evidence, including confirming and contradicting facts.
4. Identify immediate read-only checks the operator can run, and suggest rollback or fix directions only as options.
5. Keep confidence labels explicit.

Do not claim root cause from timing correlation alone, and do not perform production mutations.

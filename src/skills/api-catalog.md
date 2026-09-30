# API Catalog

Catalog HTTP APIs, webhooks, RPC handlers, or routes in a repository.

1. Resolve the repository and search for routers, handlers, route definitions, server entry points, and webhook paths.
2. Read the handler source and nearby auth or validation code.
3. For each endpoint, list method, path, purpose, authentication or signature requirement, request shape, response shape, and side effects when visible.
4. Mark unknown request or response details instead of guessing.
5. Include source paths that support the catalog.

Do not test live endpoints or mutate remote state. Use only repository and GitHub read-only evidence.

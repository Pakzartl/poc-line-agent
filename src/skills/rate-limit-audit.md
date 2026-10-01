# Rate Limit Audit

Inventory every rate limit that can affect the requested APIs on the configured GitHub ref. This is an exhaustive audit, not a single-file lookup.

1. Resolve and name the repository. Use `list_repositories` if the repository is unclear.
2. Search the configured ref with one batched `search_code` query using literal alternatives separated by `|`. Start with framework and behavior variants such as `@Throttle|Throttle(|ThrottlerGuard|SkipThrottle|RateLimit|rateLimit|rate-limit|rate limit|Retry-After|TOO_MANY_REQUESTS|429`. Record the returned ref and pass that same ref to every subsequent `search_code` and `read_file` call.
3. Search dependency and configuration variants such as `@nestjs/throttler|express-rate-limit|rate-limiter-flexible|bottleneck`. Expand with custom guard, decorator, interceptor, middleware, provider, or environment names discovered in the first pass.
4. Read every relevant definition and registration. Trace route/controller -> method/class decorators -> module providers/imports -> global guards/interceptors/middleware -> bootstrap and infrastructure configuration.
5. Deduplicate inherited policies. Distinguish route-specific, controller-wide, application-wide, and external/infrastructure limits.
6. Stop expanding after two consecutive searches produce no new relevant definitions or registrations. Avoid duplicate searches and duplicate file reads.

Before saying a limit is absent, cover all of these categories: route decorators, controller decorators, guards, interceptors, middleware, modules/providers, bootstrap/global configuration, dependency configuration, and repository-visible gateway/ingress configuration. If any category was not checked, say `not confirmed` instead of `not found`.

Return a compact inventory with API method/path, limit and time window, scope, policy/decorator name, exact source path, and confidence. Separate confirmed limits from inherited, external, or unresolved limits. State the repository and ref that were actually searched.

Do not infer a numeric limit from a name alone, and never expose credentials or raw authorization data.

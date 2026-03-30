Goal: automated Alexa UK cookie rotation to keep the MCP server authenticated.

Repository: britrik/alexa-mcp-server on GitHub.

Security constraints:
- The repository is public.
- No secrets, cookies, session values, browser profiles, or tokens may be committed to the repo.
- Cookies and tokens must stay in local environment variables, Cloudflare secrets, or Cloudflare KV.
- Do not print raw cookie values, auth tokens, signatures, or request bodies to logs.
- Do not add sample secrets beyond obvious placeholders.

Implementation requirements:
1. Review and keep the Playwright rotation script in the repo at scripts/rotate-alexa-session.ts so it can be pulled directly.
2. The Playwright script should read cookies from a local browser context and POST them to the Worker without logging sensitive values.
3. Make authorization for POST /update-session robust. Prefer signed requests with a shared secret and a freshness check over plain bearer-token auth.
4. Store rotated cookies only in encrypted Cloudflare KV, using a secret encryption key that is never committed.
5. Update docs so it is explicit that secrets must remain local or in Cloudflare secrets/KV.

Acceptance criteria:
- No cookies or tokens appear in committed files or console output.
- /update-session rejects unsigned or stale requests.
- KV storage is encrypted at rest by application code and uses an expiration policy.
- The final patch is clean and limited to the rotation workflow, auth, storage, and docs.

# Minimal Setup Guide

Super simple setup - set the Alexa base URL, marketplace, and keep the cookie values out of the repo.

## Quick Setup (2 minutes)

1. Login to your regional Amazon Alexa site in your browser.

2. Open DevTools (F12) → Network tab.

3. Find any request and copy the local browser values you need:
   - `ubid-main` cookie value
   - `at-main` cookie value
   - `ALEXA_BASE_URL=https://alexa.amazon.co.uk`
   - `ALEXAMARKETPLACEID=A1F8U5RK5OH7Y3`

4. Configure local env only:
   ```bash
   cp .env.example .env
   # Edit .env - paste the cookie values and secrets locally
   ```

5. Deploy:
   ```bash
   pnpm install && pnpm run deploy
   ```

## Cookie rotation / session refresh

The Playwright rotation script in `scripts/rotate-alexa-session.ts` reads cookies from a local browser context, posts them to `POST /update-session`, and never prints the cookie values.

Run it with `pnpm run rotate:session` once the local browser profile has the Alexa session you want to rotate.

Required runtime secrets:
- `UPDATE_SESSION_TOKEN` for request signing
- `SESSION_ENCRYPTION_KEY` for KV encryption
- `SESSION_KV` binding for encrypted cookie storage

Do not commit any cookie values, tokens, or browser profile data.

## Local Development & Testing

### Running Locally
1. Start development server: `pnpm dev`
2. Server runs at `localhost:8787`

### Testing with MCP Inspector
1. Run MCP Inspector: `pnpm dlx @modelcontextprotocol/inspector@latest`
2. Use SSE endpoint: `http://localhost:8787/sse`
3. Test MCP server functionality through the inspector

### Deployment to Cloudflare
1. Deploy: `wrangler deploy`
2. Add secrets to deployed worker:
   ```bash
   wrangler secret put UBID_MAIN
   wrangler secret put AT_MAIN
   wrangler secret put UPDATE_SESSION_TOKEN
   wrangler secret put SESSION_ENCRYPTION_KEY
   ```
3. Add a KV binding named `SESSION_KV` and use it only for encrypted session storage.
4. Use the provided base URL as your `API_BASE`

**That's it!** The server automatically builds proper cookies with `csrf=1`

## What Works

| Feature | Amazon.com Cookies | Alexa App Cookies |
|---------|-------------------|-------------------|
| Account Info | ✅ | ✅ |
| Device Control | ✅ | ✅ |
| Smart Home | ✅ | ✅ |
| Music Info | ✅ | ✅ |
| Announcements | ❌ | ✅ |

## Authentication Details

The server automatically detects your cookie type and:

- Amazon.com cookies: Uses CSRF format for web APIs
- Alexa app cookies: Uses mobile authentication format
- Auto-discovery: Dynamically finds your devices and account ID
- Caching: Reduces API calls with 5-minute cache

## Troubleshooting

- 403/401 errors: Cookies expired, get fresh ones
- Device not found: Wait 1-2 minutes for discovery cache
- Announcements fail: Need Alexa app cookies for the configured regional Alexa site

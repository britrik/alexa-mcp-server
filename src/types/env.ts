import { z } from "zod";

// Environment validation schema for Cloudflare Workers
export const EnvSchema = z.object({
	/** Amazon ubid-main cookie value */
	UBID_MAIN: z.string().optional(),

	/** Amazon at-main authentication token */
	AT_MAIN: z.string().optional(),

	/** Base URL for Alexa API requests, e.g. https://alexa.amazon.co.uk */
	ALEXA_BASE_URL: z.string().url("ALEXA_BASE_URL must be a valid URL"),

	/** Alexa marketplace ID for GraphQL requests */
	ALEXA_MARKETPLACE_ID: z.string().min(1, "ALEXA_MARKETPLACE_ID is required"),

	/** API key for MCP client authentication */
	API_KEY: z.string().optional(),

	/** Base URL for the Alexa API service */
	API_BASE: z.string().url("API_BASE must be a valid URL"),

	/** Shared secret used to authenticate /update-session requests */
	UPDATE_SESSION_TOKEN: z.string().min(32).optional(),

	/** Encryption key used to protect rotated Alexa cookies in KV */
	SESSION_ENCRYPTION_KEY: z.string().min(32).optional(),

	/** Optional TTL for encrypted session data stored in KV, in seconds */
	SESSION_KV_TTL_SECONDS: z.coerce.number().int().min(3600).max(60 * 60 * 24 * 30).optional(),

	/** KV namespace used to store encrypted session data */
	SESSION_KV: z.custom<KVNamespace>().optional(),

	/** IANA timezone (e.g. 'America/New_York') for announcement scheduling */
	TZ: z.string().optional(),

	/** Spotify Bearer Token for Web API access */
	SPOTIFY_TOKEN: z.string().optional(),

	/** Spotify Client ID for OAuth */
	SPOTIFY_CLIENT_ID: z.string().optional(),

	/** Spotify Client Secret for OAuth */
	SPOTIFY_CLIENT_SECRET: z.string().optional(),

	/** Spotify Refresh Token for OAuth */
	SPOTIFY_REFRESH_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

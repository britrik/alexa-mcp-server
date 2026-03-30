import type { Context } from "hono";
import { z } from "zod";
import { type Env, EnvSchema } from "@/types/env";
import { storeAlexaSessionCredentials } from "@/utils/session";

const UpdateSessionSchema = z.object({
	ubidMain: z.string().min(1).max(512),
	atMain: z.string().min(1).max(8192),
	source: z.string().min(1).max(128).optional(),
});

const MAX_BODY_BYTES = 16 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function timingSafeEqual(left: string, right: string) {
	const encoder = new TextEncoder();
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	let mismatch = leftBytes.length ^ rightBytes.length;
	for (let index = 0; index < Math.min(leftBytes.length, rightBytes.length); index += 1) {
		mismatch |= leftBytes[index] ^ rightBytes[index];
	}
	return mismatch === 0;
}

function extractHeader(request: Request, name: string) {
	return request.headers.get(name) ?? request.headers.get(name.toLowerCase()) ?? null;
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array) {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	return Array.from(view)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function hmacSha256Hex(secret: string, message: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
	return bytesToHex(signature);
}

function isRequestFresh(timestampHeader: string) {
	const timestamp = Number(timestampHeader);
	if (!Number.isFinite(timestamp)) return false;
	const requestTime = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
	return Math.abs(Date.now() - requestTime) <= MAX_CLOCK_SKEW_MS;
}

async function verifyRequestSignature(request: Request, rawBody: string, secret: string) {
	const timestamp = extractHeader(request, "x-session-timestamp")?.trim();
	const signature = extractHeader(request, "x-session-signature")?.trim();

	if (!timestamp || !signature || !isRequestFresh(timestamp)) {
		return false;
	}

	const payload = `${timestamp}.${rawBody}`;
	const expected = await hmacSha256Hex(secret, payload);
	const provided = signature.toLowerCase().replace(/^v1=/, "");
	return timingSafeEqual(provided, expected);
}

export async function updateSessionHandler(c: Context<{ Bindings: Env }>) {
	const env = EnvSchema.parse(c.env);
	const expectedSecret = env.UPDATE_SESSION_TOKEN?.trim();

	if (!expectedSecret) {
		return c.json({ error: "UPDATE_SESSION_TOKEN is not configured." }, 500);
	}

	if (c.req.method !== "POST") {
		return c.json({ error: "Method not allowed" }, 405);
	}

	const contentLength = c.req.header("content-length");
	if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_BYTES) {
		return c.json({ error: "Request body too large." }, 413);
	}

	const contentType = c.req.header("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		return c.json({ error: "Content-Type must be application/json." }, 415);
	}

	const rawBody = await c.req.text();
	if (rawBody.length > MAX_BODY_BYTES) {
		return c.json({ error: "Request body too large." }, 413);
	}

	const validSignature = await verifyRequestSignature(c.req.raw, rawBody, expectedSecret);
	if (!validSignature) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawBody) as unknown;
	} catch {
		return c.json({ error: "Invalid JSON body." }, 400);
	}

	const body = UpdateSessionSchema.safeParse(parsed);
	if (!body.success) {
		return c.json(
			{
				error: "Invalid session payload.",
				details: body.error.flatten(),
			},
			400,
		);
	}

	const stored = await storeAlexaSessionCredentials(env, {
		ubidMain: body.data.ubidMain,
		atMain: body.data.atMain,
		source: body.data.source ?? "playwright-rotation",
	});

	return c.json({
		status: "ok",
		updatedAt: stored.updatedAt,
		source: stored.source,
	});
}

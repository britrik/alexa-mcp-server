import type { Env } from "@/types/env";

export interface AlexaSessionCredentials {
	ubidMain: string;
	atMain: string;
	updatedAt: string;
	source?: string;
}

const SESSION_STORAGE_KEY = "alexa/session/current";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

function textEncoder() {
	return new TextEncoder();
}

function textDecoder() {
	return new TextDecoder();
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
	const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = "";
	for (const byte of array) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

async function deriveAesKey(secret: string) {
	const secretBytes = textEncoder().encode(secret);
	const hash = await crypto.subtle.digest("SHA-256", secretBytes);
	return await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function getSessionKv(env: Env): KVNamespace | null {
	return env.SESSION_KV ?? null;
}

function getSessionTtlSeconds(env: Env): number {
	return env.SESSION_KV_TTL_SECONDS ?? DEFAULT_SESSION_TTL_SECONDS;
}

function isSessionRecord(value: unknown): value is AlexaSessionCredentials {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.ubidMain === "string" &&
		record.ubidMain.length > 0 &&
		typeof record.atMain === "string" &&
		record.atMain.length > 0 &&
		typeof record.updatedAt === "string" &&
		record.updatedAt.length > 0
	);
}

export async function getAlexaSessionCredentials(env: Env): Promise<AlexaSessionCredentials | null> {
	const kv = getSessionKv(env);
	const encryptionKey = env.SESSION_ENCRYPTION_KEY?.trim();

	if (kv || encryptionKey) {
		if (!kv || !encryptionKey) {
			throw new Error("SESSION_KV and SESSION_ENCRYPTION_KEY must both be configured for rotated Alexa cookies");
		}

		const encrypted = (await kv.get(SESSION_STORAGE_KEY, "json")) as
			| { iv: string; ciphertext: string }
			| null;

		if (encrypted?.iv && encrypted?.ciphertext) {
			const key = await deriveAesKey(encryptionKey);
			const decrypted = await crypto.subtle.decrypt(
				{
					name: "AES-GCM",
					iv: fromBase64(encrypted.iv),
				},
				key,
				fromBase64(encrypted.ciphertext),
			);
			const parsed = JSON.parse(textDecoder().decode(decrypted)) as unknown;
			if (isSessionRecord(parsed)) {
				return parsed;
			}

			throw new Error("Invalid encrypted Alexa session record in KV");
		}
	}

	if (typeof env.UBID_MAIN === "string" && typeof env.AT_MAIN === "string") {
		return {
			ubidMain: env.UBID_MAIN,
			atMain: env.AT_MAIN,
			updatedAt: new Date().toISOString(),
			source: "environment",
		};
	}

	return null;
}

export async function storeAlexaSessionCredentials(
	env: Env,
	credentials: { ubidMain: string; atMain: string; source?: string },
) {
	const kv = getSessionKv(env);
	const encryptionKey = env.SESSION_ENCRYPTION_KEY?.trim();

	if (!kv) {
		throw new Error("SESSION_KV binding is required to store rotated Alexa cookies");
	}
	if (!encryptionKey) {
		throw new Error("SESSION_ENCRYPTION_KEY is required to store rotated Alexa cookies securely");
	}

	const ubidMain = credentials.ubidMain.trim();
	const atMain = credentials.atMain.trim();

	if (!ubidMain || !atMain) {
		throw new Error("Alexa session credentials must not be empty");
	}

	const record: AlexaSessionCredentials = {
		ubidMain,
		atMain,
		updatedAt: new Date().toISOString(),
		source: credentials.source?.trim() || "update-session",
	};

	const key = await deriveAesKey(encryptionKey);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv,
		},
		key,
		textEncoder().encode(JSON.stringify(record)),
	);

	await kv.put(
		SESSION_STORAGE_KEY,
		JSON.stringify({
			iv: toBase64(iv),
			ciphertext: toBase64(ciphertext),
		}),
		{ expirationTtl: getSessionTtlSeconds(env) },
	);

	return record;
}

export function getSessionStorageKey() {
	return SESSION_STORAGE_KEY;
}

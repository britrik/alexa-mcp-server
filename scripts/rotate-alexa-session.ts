import { chromium } from "playwright";

function requireEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}

function optionalEnv(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value || undefined;
}

function toHex(bytes: ArrayBuffer | Uint8Array) {
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
	return toHex(signature);
}

async function main() {
	const baseUrl = requireEnv("ALEXA_BASE_URL");
	const updateSessionUrl = requireEnv("UPDATE_SESSION_URL");
	const updateSessionToken = requireEnv("UPDATE_SESSION_TOKEN");
	const userDataDir = optionalEnv("PLAYWRIGHT_USER_DATA_DIR") ?? ".playwright/alexa-session";
	const headless = optionalEnv("HEADLESS") !== "false";

	const origin = new URL(baseUrl).origin;
	const browser = await chromium.launchPersistentContext(userDataDir, {
		headless,
	});

	try {
		const page = browser.pages()[0] ?? (await browser.newPage());
		await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
		await page.waitForLoadState("networkidle").catch(() => undefined);

		const cookies = await browser.cookies(origin);
		const ubidMain = cookies.find((cookie) => cookie.name === "ubid-main")?.value?.trim();
		const atMain = cookies.find((cookie) => cookie.name === "at-main")?.value?.trim();

		if (!ubidMain || !atMain) {
			throw new Error("Required Alexa cookies were not found in the local browser profile");
		}

		const body = JSON.stringify({
			ubidMain,
			atMain,
			source: "playwright-rotation",
		});
		const timestamp = Math.floor(Date.now() / 1000).toString();
		const signature = await hmacSha256Hex(updateSessionToken, `${timestamp}.${body}`);

		const response = await fetch(updateSessionUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-session-timestamp": timestamp,
				"x-session-signature": `v1=${signature}`,
			},
			body,
		});

		if (!response.ok) {
			throw new Error(`Session update failed with status ${response.status}`);
		}

		const result = (await response.json()) as { status?: string; updatedAt?: string; source?: string };
		console.info(JSON.stringify({
			status: result.status ?? "ok",
			updatedAt: result.updatedAt,
			source: result.source,
		}));
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : "Rotation failed");
	process.exitCode = 1;
});

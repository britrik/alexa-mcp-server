import { Hono } from "hono";
import { cors } from "hono/cors";

const soundbarApp = new Hono();

// Soundbar API proxy - forwards requests to the cloudflared tunnel
const SOUNDBAR_URL = "https://soundbar.vibingfun.com";

// Enable CORS
soundbarApp.use("*", cors());

// Health check for soundbar API
soundbarApp.get("/health", async (c) => {
	try {
		const response = await fetch(`${SOUNDBAR_URL}/status`);
		const data = await response.json();
		return c.json({ status: "ok", soundbar: data });
	} catch (error) {
		return c.json({ status: "error", message: String(error) }, 500);
	}
});

// Get soundbar status
soundbarApp.get("/status", async (c) => {
	try {
		const response = await fetch(`${SOUNDBAR_URL}/status`);
		const data = await response.json();
		return c.json(data);
	} catch (error) {
		return c.json({ error: String(error) }, 500);
	}
});

// Set volume
soundbarApp.post("/volume", async (c) => {
	const body = await c.req.json();
	const { volume } = body;
	
	try {
		const response = await fetch(`${SOUNDBAR_URL}/volume`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ volume }),
		});
		const data = await response.json();
		return c.json(data);
	} catch (error) {
		return c.json({ error: String(error) }, 500);
	}
});

// Set night mode
soundbarApp.post("/nightmode", async (c) => {
	const body = await c.req.json();
	const { enabled } = body;
	
	try {
		const response = await fetch(`${SOUNDBAR_URL}/nightmode`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ enabled }),
		});
		const data = await response.json();
		return c.json(data);
	} catch (error) {
		return c.json({ error: String(error) }, 500);
	}
});

// Set mute
soundbarApp.post("/mute", async (c) => {
	const body = await c.req.json();
	const { muted } = body;
	
	try {
		const response = await fetch(`${SOUNDBAR_URL}/mute`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ muted }),
		});
		const data = await response.json();
		return c.json(data);
	} catch (error) {
		return c.json({ error: String(error) }, 500);
	}
});

// Change input source
soundbarApp.post("/function", async (c) => {
	const body = await c.req.json();
	const { source } = body;
	
	try {
		const response = await fetch(`${SOUNDBAR_URL}/function`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ source }),
		});
		const data = await response.json();
		return c.json(data);
	} catch (error) {
		return c.json({ error: String(error) }, 500);
	}
});

export { soundbarApp };

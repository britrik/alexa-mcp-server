import type { Env } from "@/types/env";

export const DEFAULT_ALEXA_MARKETPLACE_ID = "A1F8U5RK5OH7Y3";

export function getAlexaMarketplaceId(env: Pick<Env, "ALEXAMARKETPLACEID" | "ALEXA_MARKETPLACE_ID">): string {
	return env.ALEXAMARKETPLACEID?.trim() || env.ALEXA_MARKETPLACE_ID?.trim() || DEFAULT_ALEXA_MARKETPLACE_ID;
}

import { treaty } from "@elysiajs/eden";
import type { App } from "@dismanet/api";

const isServer = typeof window === "undefined";
let serverApiUrl = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
if (!serverApiUrl.startsWith("http://") && !serverApiUrl.startsWith("https://")) {
  serverApiUrl = `https://${serverApiUrl}`;
}

const URL_API = isServer ? serverApiUrl : "/api";

/**
 * Cliente de API tipado extremo a extremo con Eden Treaty: los tipos de
 * cada endpoint salen directo de apps/api (export type App), sin duplicar
 * interfaces a mano.
 *
 * `credentials: "include"` es obligatorio: la sesión vive en una cookie
 * httpOnly, no en un header que este cliente pueda fijar.
 */
export const api = treaty<App>(URL_API as string, {
  fetch: { credentials: "include" },
});

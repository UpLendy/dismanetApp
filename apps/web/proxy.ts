import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const NOMBRE_COOKIE_SESION = "sesion";

/**
 * Chequeo superficial de presencia de cookie, solo para evitar el parpadeo
 * de una página protegida sin sesión. La verificación autoritativa (rol,
 * empresa activa, token válido) ocurre en el layout protegido contra
 * GET /auth/yo — el proxy corre en el Edge Runtime y no debe decidir
 * autorización real.
 */
export function proxy(request: NextRequest) {
  const tieneSesion = request.cookies.has(NOMBRE_COOKIE_SESION);

  if (!tieneSesion) {
    const url = new URL("/login", request.url);
    url.searchParams.set("redirigir", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/panel/:path*", "/vender/:path*"],
};

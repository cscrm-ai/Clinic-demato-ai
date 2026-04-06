import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  // Extract subdomain: "grupogs.allbele.app" → "grupogs"
  const parts = host.split(".");
  const subdomain = parts.length >= 3 ? parts[0] : "";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-subdomain", subdomain);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

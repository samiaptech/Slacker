import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createWebContentSecurityPolicy } from "./config/security-policy";

const securityHeaders = Object.freeze({
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin"
});

export const proxy = (request: NextRequest): NextResponse => {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBaseUrl) throw new Error("NEXT_PUBLIC_API_BASE_URL is required to configure the web security policy.");

  const nonce = Buffer.from(randomUUID()).toString("base64");
  const contentSecurityPolicy = createWebContentSecurityPolicy({
    apiBaseUrl,
    nonce,
    production: process.env.NODE_ENV === "production"
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  for (const [name, value] of Object.entries(securityHeaders)) {
    response.headers.set(name, value);
  }
  return response;
};

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};

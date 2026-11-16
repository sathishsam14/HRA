// middleware.js
// Next.js Edge-compatible middleware enforcing session authentication
// on all pages except /login, and server-side read-only enforcement for VIEWER on write APIs.

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE_NAME = "hra_session";

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // 1. Always allow Next.js internals and static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth/login") ||
    pathname.includes(".") || // static files like images (.png, .jpg), favicon.ico
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // 2. Read and verify session token
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let session = null;

  if (token) {
    try {
      const secret = getSecretKey();
      if (secret) {
        const { payload } = await jwtVerify(token, secret);
        session = payload;
      }
    } catch {
      session = null;
    }
  }

  // 3. /login route logic
  if (pathname === "/login") {
    // If user is already authenticated with a valid session, redirect to /dashboard
    if (session) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // 4. Require session for all other pages and API routes
  if (!session) {
    // If API request, return JSON 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    // If page request, redirect to /login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 5. Server-side enforcement: VIEWER is strictly read-only on all write operations
  // "Viewer is read-only. Every write API (upload, decision, submit) must reject VIEWER on the server, not only hide the buttons."
  const method = request.method.toUpperCase();
  const isWriteMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  if (isWriteMethod && pathname.startsWith("/api/")) {
    // Allow logout for all roles
    if (pathname !== "/api/auth/logout" && session.role === "VIEWER") {
      return NextResponse.json(
        {
          error: "Forbidden: VIEWER role is read-only and cannot perform write operations",
        },
        { status: 403 }
      );
    }
  }

  // Root path / redirects to /dashboard when authenticated
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for static files.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

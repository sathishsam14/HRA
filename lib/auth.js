// lib/auth.js
// Authentication, bcrypt password hashing, signed JWT sessions with jose, and RBAC helpers.

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "hra_session";
export const SESSION_EXPIRY_SECONDS = 8 * 60 * 60; // 8 hours (BRD / rule requirement)

function getSecretKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is missing");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Hashes a plaintext password with bcryptjs.
 */
export async function hashPassword(plaintext) {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("Invalid password provided for hashing");
  }
  return bcrypt.hash(plaintext, 10);
}

/**
 * Compares plaintext password against bcrypt hash.
 */
export async function verifyPassword(plaintext, hash) {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * Creates a signed JWT session token with 8 hour expiry.
 */
export async function createSessionToken(payload) {
  const secret = getSecretKey();
  return new SignJWT({
    id: payload.id,
    email: payload.email,
    name: payload.name,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret);
}

/**
 * Verifies a signed JWT session token. Returns payload or null if invalid/expired.
 */
export async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const secret = getSecretKey();
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

/**
 * Retrieves the current user session from Next.js cookies or a custom request.
 * Can be called in Server Components, Route Handlers, or with a custom request/token.
 */
export async function getSession(reqOrCookies) {
  try {
    let token = null;

    if (typeof reqOrCookies === "string") {
      token = reqOrCookies;
    } else if (reqOrCookies?.cookies?.get) {
      token = reqOrCookies.cookies.get(SESSION_COOKIE_NAME)?.value;
    } else if (reqOrCookies?.headers?.get) {
      const cookieHeader = reqOrCookies.headers.get("cookie") || "";
      const match = cookieHeader.match(new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]*)`));
      token = match ? decodeURIComponent(match[1]) : null;
    } else {
      // Default to Next.js next/headers cookies()
      const cookieStore = await cookies();
      token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    }

    if (!token) return null;
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

/**
 * Enforces role-based access control.
 * Throws an error with .status property (401 or 403) if unauthorized.
 *
 * @param {string|string[]} allowedRoles Single role or array of allowed roles (e.g. ['ADMIN', 'HANDICAPPER'])
 * @param {Object} [session] Optional pre-fetched session. If omitted, fetched via getSession().
 * @returns {Promise<Object>} The authenticated user session payload.
 */
export async function requireRole(allowedRoles, session = null) {
  const currentSession = session || (await getSession());

  if (!currentSession) {
    const err = new Error("Authentication required");
    err.status = 401;
    throw err;
  }

  const roleList = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  if (!roleList.includes(currentSession.role)) {
    const err = new Error(`Forbidden: Role '${currentSession.role}' does not have required permissions`);
    err.status = 403;
    throw err;
  }

  return currentSession;
}

/**
 * Specifically enforces that MANAGER cannot perform any write operation.
 * "Manager is read-only. Every write API (upload, decision, submit) must reject MANAGER on the server, not only hide the buttons."
 */
export async function assertWritePermission(session = null) {
  const currentSession = session || (await getSession());

  if (!currentSession) {
    const err = new Error("Authentication required");
    err.status = 401;
    throw err;
  }

  if (currentSession.role === "MANAGER" || currentSession.role === "MANAGER") {
    const err = new Error("Forbidden: MANAGER role is read-only and cannot perform write operations");
    err.status = 403;
    throw err;
  }

  return currentSession;
}

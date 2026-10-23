import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";

export const ADMIN_PASSWORD_SESSION_COOKIE = "roomfinder_admin_password_session";
export const ADMIN_PASSWORD_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const MIN_ADMIN_SECRET_LENGTH = 20;
const TOKEN_SUBJECT = "campus-locator-admin";

function adminSecret(): string | null {
  const secret = process.env.ADMIN_SECRET_KEY;
  return typeof secret === "string" && secret.length >= MIN_ADMIN_SECRET_LENGTH ? secret : null;
}

export function hasConfiguredAdminPassword(): boolean {
  return adminSecret() !== null;
}

export function verifyAdminPassword(candidate: unknown): boolean {
  const secret = adminSecret();
  if (!secret || typeof candidate !== "string" || candidate.length === 0 || candidate.length > 512) return false;

  const expectedDigest = createHash("sha256").update(secret, "utf8").digest();
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}

export function createAdminPasswordSessionToken(now = Date.now()): string {
  const secret = adminSecret();
  if (!secret) throw new Error("ADMIN_SECRET_KEY is not configured with a sufficiently long value.");

  const payload = Buffer.from(JSON.stringify({
    version: 1,
    subject: TOKEN_SUBJECT,
    issuedAt: now,
    expiresAt: now + ADMIN_PASSWORD_SESSION_LIFETIME_MS,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function isValidAdminPasswordSessionToken(token: unknown, now = Date.now()): boolean {
  const secret = adminSecret();
  if (!secret || typeof token !== "string" || token.length > 2048) return false;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [payload, signature] = parts;

  try {
    const expectedSignature = createHmac("sha256", secret).update(payload).digest();
    const providedSignature = Buffer.from(signature, "base64url");
    if (providedSignature.length !== expectedSignature.length || !timingSafeEqual(expectedSignature, providedSignature)) return false;

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      version?: unknown;
      subject?: unknown;
      issuedAt?: unknown;
      expiresAt?: unknown;
    };
    return decoded.version === 1
      && decoded.subject === TOKEN_SUBJECT
      && typeof decoded.issuedAt === "number"
      && decoded.issuedAt <= now
      && typeof decoded.expiresAt === "number"
      && decoded.expiresAt > now
      && decoded.expiresAt - decoded.issuedAt <= ADMIN_PASSWORD_SESSION_LIFETIME_MS;
  } catch {
    return false;
  }
}

export function hasValidAdminPasswordSession(req: Pick<Request, "headers">): boolean {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== "string") return false;
  const prefix = `${ADMIN_PASSWORD_SESSION_COOKIE}=`;
  const pair = cookieHeader.split(";").map(value => value.trim()).find(value => value.startsWith(prefix));
  if (!pair) return false;
  return isValidAdminPasswordSessionToken(pair.slice(prefix.length));
}

function cookieOptions(includeMaxAge: boolean): CookieOptions {
  // Never let Host or X-Forwarded-* request headers downgrade an Admin credential cookie.
  // Secure cookies are accepted by modern browsers on loopback hosts for local Preview.
  return {
    httpOnly: true,
    path: "/",
    secure: true,
    sameSite: "none",
    ...(includeMaxAge ? { maxAge: ADMIN_PASSWORD_SESSION_LIFETIME_MS } : {}),
  };
}

export function setAdminPasswordSessionCookie(res: Response, token: string): void {
  res.cookie(ADMIN_PASSWORD_SESSION_COOKIE, token, cookieOptions(true));
}

export function clearAdminPasswordSessionCookie(res: Response): void {
  res.clearCookie(ADMIN_PASSWORD_SESSION_COOKIE, cookieOptions(false));
}

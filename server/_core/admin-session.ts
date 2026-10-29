import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";

export const ADMIN_PASSWORD_SESSION_COOKIE = "roomfinder_admin_password_session";
export const ADMIN_PASSWORD_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const ADMIN_BOOKING_SNAPSHOT_LIFETIME_MS = 2 * 60 * 60 * 1000;
const MIN_ADMIN_SECRET_LENGTH = 20;
const TOKEN_SUBJECT = "campus-locator-admin";
const BOOKING_SNAPSHOT_SUBJECT = "campus-locator-booking-csv-snapshot";
const SNAPSHOT_HASH_PATTERN = /^[a-f0-9]{64}$/;

type AdminBookingSnapshotClaims = {
  version: 1;
  subject: typeof BOOKING_SNAPSHOT_SUBJECT;
  issuedAt: number;
  expiresAt: number;
  snapshotHash: string;
};

function adminSecrets(): string[] {
  return [...new Set([process.env.ADMIN_SECRET_KEY, process.env.ROOMFINDER_ADMIN_PASSWORD]
    .filter((secret): secret is string => typeof secret === "string" && secret.length >= MIN_ADMIN_SECRET_LENGTH))];
}

function adminSecret(): string | null {
  return adminSecrets()[0] ?? null;
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signatureMatches(payload: string, providedSignature: string, secrets: string[]): boolean {
  let matched = false;
  let provided: Buffer;
  try {
    provided = Buffer.from(providedSignature, "base64url");
  } catch {
    return false;
  }
  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(payload).digest();
    const equal = provided.length === expected.length && timingSafeEqual(expected, provided);
    matched = matched || equal;
  }
  return matched;
}

export function hasConfiguredAdminPassword(): boolean {
  return adminSecrets().length > 0;
}

export function verifyAdminPassword(candidate: unknown): boolean {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 512) return false;
  const secrets = adminSecrets();
  if (secrets.length === 0) return false;
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  let matched = false;
  for (const secret of secrets) {
    const expectedDigest = createHash("sha256").update(secret, "utf8").digest();
    const equal = timingSafeEqual(expectedDigest, candidateDigest);
    matched = matched || equal;
  }
  return matched;
}

export function createAdminPasswordSessionToken(now = Date.now()): string {
  const secret = adminSecret();
  if (!secret) throw new Error("Set ADMIN_SECRET_KEY or ROOMFINDER_ADMIN_PASSWORD to a value of at least 20 characters.");

  const payload = Buffer.from(JSON.stringify({
    version: 1,
    subject: TOKEN_SUBJECT,
    issuedAt: now,
    expiresAt: now + ADMIN_PASSWORD_SESSION_LIFETIME_MS,
  })).toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

export function isValidAdminPasswordSessionToken(token: unknown, now = Date.now()): boolean {
  const secrets = adminSecrets();
  if (secrets.length === 0 || typeof token !== "string" || token.length > 2048) return false;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !signatureMatches(parts[0], parts[1], secrets)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as {
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

export function createAdminBookingSnapshotToken(snapshotHash: string, now = Date.now()): string {
  const secret = adminSecret();
  if (!secret) throw new Error("An Admin password environment variable is required to sign booking snapshots.");
  if (!SNAPSHOT_HASH_PATTERN.test(snapshotHash)) throw new Error("The booking snapshot hash is invalid.");

  const payload = Buffer.from(JSON.stringify({
    version: 1,
    subject: BOOKING_SNAPSHOT_SUBJECT,
    issuedAt: now,
    expiresAt: now + ADMIN_BOOKING_SNAPSHOT_LIFETIME_MS,
    snapshotHash,
  } satisfies AdminBookingSnapshotClaims)).toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyAdminBookingSnapshotToken(token: unknown, now = Date.now()): AdminBookingSnapshotClaims | null {
  const secrets = adminSecrets();
  if (secrets.length === 0 || typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !signatureMatches(parts[0], parts[1], secrets)) return null;

  try {
    const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<AdminBookingSnapshotClaims>;
    if (claims.version !== 1
      || claims.subject !== BOOKING_SNAPSHOT_SUBJECT
      || typeof claims.issuedAt !== "number"
      || claims.issuedAt > now
      || typeof claims.expiresAt !== "number"
      || claims.expiresAt <= now
      || claims.expiresAt - claims.issuedAt > ADMIN_BOOKING_SNAPSHOT_LIFETIME_MS
      || typeof claims.snapshotHash !== "string"
      || !SNAPSHOT_HASH_PATTERN.test(claims.snapshotHash)) return null;
    return claims as AdminBookingSnapshotClaims;
  } catch {
    return null;
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

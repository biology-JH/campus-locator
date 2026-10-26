import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import express, { type CookieOptions, type Express, type Request, type Response } from "express";

export const SITE_PASSWORD_SESSION_COOKIE = "campus_site_password_session";
export const SITE_PASSWORD_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const SITE_PASSWORD_LOGIN_PATH = "/api/site-password/login";
const TOKEN_SUBJECT = "campus-locator-site-access";
const MAX_PASSWORD_LENGTH = 512;

function configuredSitePassword(): string | null {
  const password = process.env.SITE_PASSWORD;
  return typeof password === "string" && password.length > 0 ? password : null;
}

function passwordMatches(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > MAX_PASSWORD_LENGTH) return false;

  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}

function createSessionToken(password: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    subject: TOKEN_SUBJECT,
    issuedAt: now,
    expiresAt: now + SITE_PASSWORD_SESSION_LIFETIME_MS,
  })).toString("base64url");
  const signature = createHmac("sha256", password).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function isValidSessionToken(token: unknown, password: string, now = Date.now()): boolean {
  if (typeof token !== "string" || token.length > 2048) return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [payload, signature] = parts;

  try {
    const expectedSignature = createHmac("sha256", password).update(payload).digest("base64url");
    const expectedSignatureBytes = Buffer.from(expectedSignature, "ascii");
    const providedSignatureBytes = Buffer.from(signature, "ascii");
    if (providedSignatureBytes.length !== expectedSignatureBytes.length || !timingSafeEqual(expectedSignatureBytes, providedSignatureBytes)) return false;

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
      && decoded.expiresAt - decoded.issuedAt <= SITE_PASSWORD_SESSION_LIFETIME_MS;
  } catch {
    return false;
  }
}

function requestHasValidSession(req: Request, password: string): boolean {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== "string") return false;
  const prefix = `${SITE_PASSWORD_SESSION_COOKIE}=`;
  const pair = cookieHeader.split(";").map(value => value.trim()).find(value => value.startsWith(prefix));
  if (!pair) return false;
  return isValidSessionToken(pair.slice(prefix.length), password);
}

function usesPublicHttps(req: Request): boolean {
  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return forwardedProtocol === "https" || req.protocol === "https";
}

function sessionCookieOptions(req: Request): CookieOptions {
  const secure = usesPublicHttps(req);
  return {
    httpOnly: true,
    path: "/",
    secure,
    sameSite: secure ? "none" : "lax",
    maxAge: SITE_PASSWORD_SESSION_LIFETIME_MS,
  };
}

function renderLoginPage(invalidPassword = false): string {
  const errorMessage = invalidPassword
    ? '<p class="error" role="alert">That password did not match. Please try again.</p>'
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Campus Space &amp; Staff locator · Access</title>
  <style>
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; color: #24312b; background: #f3f4f1; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; }
    main { width: min(100%, 440px); padding: clamp(28px, 7vw, 48px); background: #fff; border: 1px solid #dfe5df; border-radius: 18px; box-shadow: 0 22px 64px rgba(24, 47, 34, .12); }
    .eyebrow { margin: 0 0 14px; color: #51715b; font-size: 11px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
    h1 { margin: 0; color: #213b2c; font-family: Georgia, 'Times New Roman', serif; font-size: clamp(30px, 7vw, 40px); font-weight: 500; line-height: 1.08; }
    .intro { margin: 14px 0 28px; color: #66716a; font-size: 15px; line-height: 1.55; }
    label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 700; }
    input { width: 100%; min-height: 48px; padding: 12px 14px; border: 1px solid #cdd6ce; border-radius: 9px; color: #24312b; font-size: 16px; }
    input:focus { border-color: #315e40; outline: 3px solid rgba(49, 94, 64, .16); }
    button { width: 100%; min-height: 48px; margin-top: 16px; border: 0; border-radius: 9px; background: #244b34; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
    button:hover { background: #193d29; }
    .error { margin: 14px 0 0; color: #a12f2f; font-size: 14px; }
    .note { margin: 22px 0 0; color: #7b847e; font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Yew Chung International School</p>
    <h1>Campus Space &amp; Staff locator</h1>
    <p class="intro">Enter the site password to continue to the campus locator.</p>
    <form action="${SITE_PASSWORD_LOGIN_PATH}" method="post">
      <label for="site-password">Site password</label>
      <input id="site-password" name="password" type="password" autocomplete="current-password" maxlength="${MAX_PASSWORD_LENGTH}" required autofocus>
      <button type="submit">Continue</button>
    </form>
    ${errorMessage}
    <p class="note">Authorized school community access.</p>
  </main>
</body>
</html>`;
}

function setNoStore(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
}

export function registerSitePasswordGate(app: Express): void {
  app.post(
    SITE_PASSWORD_LOGIN_PATH,
    express.urlencoded({ extended: false, limit: "4kb" }),
    (req, res) => {
      setNoStore(res);
      const password = configuredSitePassword();
      if (!password) {
        res.status(404).json({ message: "Site password protection is not enabled." });
        return;
      }
      if (!passwordMatches(req.body?.password, password)) {
        res.status(401).type("html").send(renderLoginPage(true));
        return;
      }

      res.cookie(SITE_PASSWORD_SESSION_COOKIE, createSessionToken(password), sessionCookieOptions(req));
      res.redirect(303, "/");
    },
  );

  app.use((req, res, next) => {
    if (req.path === "/api/health") {
      next();
      return;
    }

    const password = configuredSitePassword();
    if (!password) {
      next();
      return;
    }

    setNoStore(res);
    if (requestHasValidSession(req, password)) {
      next();
      return;
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    const acceptHeader = req.get("accept") ?? "";
    if (req.method === "GET" && /\btext\/html\b/i.test(acceptHeader)) {
      res.status(401).type("html").send(renderLoginPage());
      return;
    }
    res.status(401).json({ message: "Site password required." });
  });
}

import { createServer, type Server } from "node:http";
import express, { type Express } from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSitePasswordGate } from "./_core/site-password.js";
import { createExpressApp } from "./_core/app.js";

let originalSitePassword: string | undefined;
let server: Server | undefined;
let origin = "";

function createProbeApp(): Express {
  const app = express();
  registerSitePasswordGate(app);
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/", (_req, res) => res.status(200).send("Campus Locator app"));
  app.get("/assets/app.js", (_req, res) => res.type("application/javascript").send("window.appLoaded = true;"));
  app.get("/api/private", (_req, res) => res.json({ data: "protected" }));
  return app;
}

async function startTestServer(app: Express = createProbeApp()): Promise<void> {
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port.");
  origin = `http://127.0.0.1:${address.port}`;
}

beforeEach(() => {
  originalSitePassword = process.env.SITE_PASSWORD;
  delete process.env.SITE_PASSWORD;
});

afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>(resolve => server?.close(() => resolve()));
  }
  server = undefined;
  if (originalSitePassword === undefined) delete process.env.SITE_PASSWORD;
  else process.env.SITE_PASSWORD = originalSitePassword;
});

describe("SITE_PASSWORD access gate", () => {
  it("leaves the site and APIs unchanged when SITE_PASSWORD is unset", async () => {
    await startTestServer();

    const page = await fetch(`${origin}/`, { headers: { Accept: "text/html" } });
    const api = await fetch(`${origin}/api/private`, { headers: { Accept: "application/json" } });
    const health = await fetch(`${origin}/api/health`);

    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Campus Locator app");
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ data: "protected" });
    expect(health.status).toBe(200);
  });

  it("treats an empty SITE_PASSWORD as disabled", async () => {
    process.env.SITE_PASSWORD = "";
    await startTestServer();

    const page = await fetch(`${origin}/`, { headers: { Accept: "text/html" } });
    const api = await fetch(`${origin}/api/private`, { headers: { Accept: "application/json" } });

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
  });

  it("shows a password form and blocks pages, assets, and private APIs when SITE_PASSWORD is set", async () => {
    process.env.SITE_PASSWORD = "local-test-site-password";
    await startTestServer();

    const page = await fetch(`${origin}/`, { headers: { Accept: "text/html" } });
    const pageHtml = await page.text();
    const asset = await fetch(`${origin}/assets/app.js`, { headers: { Accept: "*/*" } });
    const api = await fetch(`${origin}/api/private`, { headers: { Accept: "application/json" } });
    const apiBody = await api.json();
    const health = await fetch(`${origin}/api/health`);

    expect(page.status).toBe(401);
    expect(pageHtml).toContain('<form action="/api/site-password/login" method="post">');
    expect(pageHtml).toContain('name="password" type="password"');
    expect(pageHtml).not.toContain("local-test-site-password");
    expect(page.headers.get("cache-control")).toContain("no-store");
    expect(asset.status).toBe(401);
    expect(api.status).toBe(401);
    expect(apiBody).toEqual({ message: "Site password required." });
    expect(health.status).toBe(200);
  });

  it("mounts before the real Express application routes while preserving public health", async () => {
    process.env.SITE_PASSWORD = "local-test-site-password";
    await startTestServer(createExpressApp());

    const page = await fetch(`${origin}/`, { headers: { Accept: "text/html" } });
    const publicConfig = await fetch(`${origin}/api/platform/config.js`);
    const api = await fetch(`${origin}/api/trpc/timetable.roomList`, { headers: { Accept: "application/json" } });
    const health = await fetch(`${origin}/api/health`);

    expect(page.status).toBe(401);
    expect(publicConfig.status).toBe(401);
    expect(api.status).toBe(401);
    expect(health.status).toBe(200);
  });

  it("rejects an incorrect password and grants access with a signed HTTPS session cookie", async () => {
    process.env.SITE_PASSWORD = "local-test-site-password";
    await startTestServer();

    const wrongPassword = await fetch(`${origin}/api/site-password/login`, {
      method: "POST",
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Forwarded-Proto": "https",
      },
      body: new URLSearchParams({ password: "incorrect" }),
      redirect: "manual",
    });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.headers.get("set-cookie")).toBeNull();
    expect(await wrongPassword.text()).toContain("That password did not match");

    const login = await fetch(`${origin}/api/site-password/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Forwarded-Proto": "https",
      },
      body: new URLSearchParams({ password: "local-test-site-password" }),
      redirect: "manual",
    });
    const setCookie = login.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0];

    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe("/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=None");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Max-Age=28800");

    const page = await fetch(`${origin}/`, { headers: { Accept: "text/html", Cookie: cookie } });
    const api = await fetch(`${origin}/api/private`, { headers: { Accept: "application/json", Cookie: cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Campus Locator app");
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ data: "protected" });
  });

  it("uses a non-Secure Lax cookie for plain HTTP local development", async () => {
    process.env.SITE_PASSWORD = "local-test-site-password";
    await startTestServer();

    const login = await fetch(`${origin}/api/site-password/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "local-test-site-password" }),
      redirect: "manual",
    });
    const setCookie = login.headers.get("set-cookie") ?? "";

    expect(login.status).toBe(303);
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Secure");
  });

  it("rejects a tampered session cookie", async () => {
    process.env.SITE_PASSWORD = "local-test-site-password";
    await startTestServer();

    const login = await fetch(`${origin}/api/site-password/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "local-test-site-password" }),
      redirect: "manual",
    });
    const setCookie = login.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0];
    const [name, value] = cookie.split("=");
    const lastCharacter = value.at(-1) === "a" ? "b" : "a";
    const tamperedCookie = `${name}=${value.slice(0, -1)}${lastCharacter}`;
    const response = await fetch(`${origin}/api/private`, {
      headers: { Accept: "application/json", Cookie: tamperedCookie },
    });

    expect(response.status).toBe(401);
  });
});

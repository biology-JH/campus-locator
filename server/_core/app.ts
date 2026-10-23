import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { adminUploadErrorHandler, registerAdminRoutes } from "../admin.js";
import { appRouter } from "../routers.js";
import { createContext } from "./context.js";
import { registerOAuthRoutes } from "./oauth.js";
import { publicPlatformScript } from "./publicConfig.js";

export function createExpressApp() {
  const app = express();
  // Vercel forwards the client address through one trusted proxy hop.
  if (process.env.VERCEL === "1") app.set("trust proxy", 1);

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });

  // Admin endpoints own small login JSON and raw Excel bodies; mount them before generic parsers.
  registerAdminRoutes(app);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerOAuthRoutes(app);

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  app.use(adminUploadErrorHandler());
  return app;
}

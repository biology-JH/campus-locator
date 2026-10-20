import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { adminUploadErrorHandler, registerAdminRoutes } from "../admin";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";

export function createExpressApp() {
  const app = express();

  // Configure body parser with larger size limit for file uploads.
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });

  registerAdminRoutes(app);
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

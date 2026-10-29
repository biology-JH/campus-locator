import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema.js";
import { hasValidAdminPasswordSession } from "./admin-session.js";
import { hasValidSitePasswordSession } from "./site-password.js";
import { sdk } from "./sdk.js";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  adminPasswordSession?: boolean;
  sitePasswordSession?: boolean;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    adminPasswordSession: hasValidAdminPasswordSession(opts.req),
    sitePasswordSession: hasValidSitePasswordSession(opts.req),
  };
}

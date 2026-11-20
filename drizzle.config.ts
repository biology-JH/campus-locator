import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: [".env.local", ".env"] });

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required to run PostgreSQL migrations");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/postgres-migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});

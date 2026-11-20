// Vercel Deploy Fix v3 - Stable Core Setup
import dotenv from "dotenv";
import { createExpressApp } from "./server/_core/app.js";
import { serveStatic } from "./server/_core/static.js";

dotenv.config({ path: [".env.local", ".env"] });

// 1. Initialize Manus's core pre-configured database application engine
const app = createExpressApp();

// 2. Serve your static frontend files through Manus's internal server layer natively
serveStatic(app);

export default app;

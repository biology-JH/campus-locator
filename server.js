// Vercel Deploy Fix v3
import "dotenv/config";
import { createExpressApp } from "./server/_core/app.js";
import { serveStatic } from "./server/_core/static.js";

// 1. Initialize Manus's core pre-configured database application engine
const app = createExpressApp();

// 2. Serve your static frontend files through Manus's internal server layer
serveStatic(app);

export default app;

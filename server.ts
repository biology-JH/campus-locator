import "dotenv/config";
import { createExpressApp } from "./server/_core/app";
import { serveStatic } from "./server/_core/static";

const app = createExpressApp();
serveStatic(app);

export default app;

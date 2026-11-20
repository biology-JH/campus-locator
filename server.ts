import dotenv from "dotenv";
import express from "express";
import { createExpressApp } from "./server/_core/app.js";
import { serveStatic } from "./server/_core/static.js";

dotenv.config({ path: [".env.local", ".env"] });

const app = express();
app.use(createExpressApp());
serveStatic(app);

export default app;

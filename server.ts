import "dotenv/config";
import express from "express";
import { createExpressApp } from "./server/_core/app.js";
import { serveStatic } from "./server/_core/static.js";

const app = express();
app.use(createExpressApp());
serveStatic(app);

export default app;

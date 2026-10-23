import "dotenv/config";
import { createServer } from "http";
import { createExpressApp } from "./app.js";
import { setupVite } from "./vite";
import { serveStatic } from "./static";

async function startServer() {
  const app = createExpressApp();
  const server = createServer(app);

  // Development mode uses Vite; production mode serves the built frontend.
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});

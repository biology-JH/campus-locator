// Vercel Deploy Fix v2
import "dotenv/config";
import { createExpressApp } from "./server/_core/app.js";
import { serveStatic } from "./server/_core/static.js";

// 1. Initialize Manus's core pre-configured database application engine
const app = createExpressApp();

// 2. Structural Password Protection Middleware
app.use((req, res, next) => {
  const sitePassword = process.env.SITE_PASSWORD;

  // Let visitors pass if no environment variable password is set on Vercel
  if (!sitePassword) {
    return next();
  }

  // 3. TARGET LOCK: Only request passwords on entry locations. 
  // If the path request looks like a file asset or an explicit data fetch hook, let it slide.
  const isBackendRoute = req.path.startsWith('/api') || req.path.startsWith('/data') || req.path.startsWith('/db');
  const isAssetFile = req.path.includes('.') || req.path.startsWith('/_next');

  if (isBackendRoute || isAssetFile) {
    return next();
  }

  // Handle human authentication via Basic Login prompt
  const authHeader = req.headers['authorization'];

  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const parts = decoded.split(':');
      const password = parts[1]; // Pulls the exact password match string

      if (password === sitePassword) {
        return next(); // Match found, entry granted!
      }
    } catch (err) {
      console.error("Auth decoding error:", err);
    }
  }

  // Present the browser's built-in login prompt if unauthorized
  res.setHeader('WWW-Authenticate', 'Basic realm="Secure Site"');
  return res.status(401).send('Authentication Required');
});

// 4. Serve your static frontend files through Manus's internal server layer
serveStatic(app);

export default app;

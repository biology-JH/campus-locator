// Vercel Deploy Fix v2
import "dotenv/config";
import { createExpressApp } from "./server/_core/app.js";
import { serveStatic } from "./server/_core/static.js";

// 1. Initialize Manus's core pre-configured database application engine
const app = createExpressApp();

// 2. Simple Password Protection Middleware for internal paths
app.use((req, res, next) => {
  const sitePassword = process.env.SITE_PASSWORD;

  if (!sitePassword) {
    return next();
  }

  // Bypass authentication for backend data requests and static assets
  if (
    req.path.startsWith('/api') || 
    req.path.startsWith('/data') || 
    req.path.startsWith('/db') ||
    req.path.includes('.')
  ) {
    return next();
  }

  const authHeader = req.headers['authorization'];

  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const parts = decoded.split(':');
      const password = parts[1]; 

      if (password === sitePassword) {
        return next();
      }
    } catch (err) {
      console.error("Auth decoding error:", err);
    }
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Secure Site"');
  return res.status(401).send('Authentication Required');
});

// 3. Serve your static frontend files through Manus's internal server layer
serveStatic(app);

export default app;

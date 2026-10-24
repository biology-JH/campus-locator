// Vercel Deploy Fix v2
import "dotenv/config";
import { createExpressApp } from "./server/_core/app.js";
import { serveStatic } from "./server/_core/static.js";

// 1. Initialize Manus's core pre-configured database application engine
const app = createExpressApp();

// 2. Clear, fixed Password Protection Middleware
app.use((req, res, next) => {
  const sitePassword = process.env.SITE_PASSWORD;

  // Let visitors pass if no environment variable password is set on Vercel
  if (!sitePassword) {
    return next();
  }

  // CRITICAL BYPASS: Ensure core database endpoints and asset routes bypass the login wall
  if (
    req.path.startsWith('/api') || 
    req.path.startsWith('/data') || 
    req.path.startsWith('/db') ||
    req.path.includes('.') // Allows JS chunks, CSS files, and database assets
  ) {
    return next();
  }

  const authHeader = req.headers['authorization'];

  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      // Decode Basic Auth header (Format: Basic base64(username:password))
      const token = authHeader.split(' ')[1];
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const parts = decoded.split(':');
      
      // FIXED ENGINE: Pull out array index 1 for the literal password value
      const password = parts[1]; 

      if (password === sitePassword) {
        return next(); // Password matches perfectly, unlock the session
      }
    } catch (err) {
      console.error("Auth decoding error:", err);
    }
  }

  // Present the browser's built-in login prompt if unauthorized
  res.setHeader('WWW-Authenticate', 'Basic realm="Secure Site"');
  return res.status(401).send('Authentication Required');
});

// 3. Serve your static frontend files through Manus's internal server layer
serveStatic(app);

export default app;

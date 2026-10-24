// Vercel Deploy Fix v2
import "dotenv/config";
import express from "express";
import { createExpressApp } from "./server/_core/app.js";
import { serveStatic } from "./server/_core/static.js";

const app = express();
// Middleware to protect the website using SITE_PASSWORD
app.use((req, res, next) => {
  const sitePassword = process.env.SITE_PASSWORD;

  // 1. If no password environment variable is set on Vercel, let visitors through
  if (!sitePassword) {
    return next();
  }

  // 2. CRITICAL FIX: Bypass password requirements for ALL database/API requests and internal assets
  if (
    req.path.startsWith('/api') || 
    req.path.startsWith('/data') || 
    req.path.startsWith('/db') ||
    req.path.includes('.') // Let CSS, JS, and image elements load natively
  ) {
    return next();
  }

  const authHeader = req.headers['authorization'];

  // 3. Authenticate visitors using the Basic Login prompt
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      const parts = decoded.split(':');
      const password = parts[1]; // Correctly isolates the input password text

      if (password === sitePassword) {
        return next(); // Correct password given, unlock site
      }
    } catch (err) {
      console.error("Auth decoding error:", err);
    }
  }

  // 4. Trigger the browser's built-in login prompt if unauthorized
  res.setHeader('WWW-Authenticate', 'Basic realm="Secure Site"');
  return res.status(401).send('Authentication Required');
});

// app.use(createExpressApp());
serveStatic(app);

export default app;

// Vercel Deploy Fix v2
import "dotenv/config";
import express from "express";
import { createExpressApp } from "./server/_core/app.js";
import { serveStatic } from "./server/_core/static.js";

const app = express();
// Middleware to protect the website using SITE_PASSWORD
app.use((req, res, next) => {
  const sitePassword = process.env.SITE_PASSWORD;

  // If no password environment variable is set on Vercel, let visitors through
  if (!sitePassword) {
    return next();
  }

  // Bypass authentication specifically for internal API calls or assets if needed
  if (req.path.startsWith('/api')) {
    return next();
  }

  const authHeader = req.headers['authorization'];

  if (authHeader) {
    // Decode Basic Auth header (Format: Basic base64(username:password))
    const token = authHeader.split(' ')[1];
    const decoded = Buffer.from(token, 'base64').toString('ascii');
    const [username, password] = decoded.split(':');

    // If the password matches, grant access (username can be anything)
    if (password === sitePassword) {
      return next();
    }
  }

  // Trigger the browser's built-in login prompt if unauthorized
  res.setHeader('WWW-Authenticate', 'Basic realm="Secure Site"');
  return res.status(401).send('Authentication Required');
});

// app.use(createExpressApp());
serveStatic(app);

export default app;

// Middleware to protect the website using SITE_PASSWORD
app.use((req, res, next) => {
  const sitePassword = process.env.SITE_PASSWORD;

  // If no password environment variable is set on Vercel, let visitors through
  if (!sitePassword) {
    return next();
  }

  // FORCE BYPASS: Ensure core background database routes and public files skip the prompt
  if (
    req.path.startsWith('/api') || 
    req.path.startsWith('/data') || 
    req.path.startsWith('/db') ||
    req.path.startsWith('/_next') ||
    req.path.includes('.') // Allows static bundle files, stylesheets, and images to download
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
      
      const password = parts[1]; // Correctly pull the password index

      if (password === sitePassword) {
        return next(); // Password matches perfectly, unlock the session!
      }
    } catch (err) {
      console.error("Auth decoding error:", err);
    }
  }

  // Trigger the browser's built-in login prompt if unauthorized
  res.setHeader('WWW-Authenticate', 'Basic realm="Secure Site"');
  return res.status(401).send('Authentication Required');
});

import { NextResponse } from 'next/server';

export const config = {
  // Enforce password verification on the root page views
  matcher: ['/', '/index.html'],
};

export function middleware(req) {
  const sitePassword = process.env.SITE_PASSWORD;

  // If no password variable is configured on Vercel, let visitors pass
  if (!sitePassword) {
    return NextResponse.next();
  }

  const basicAuth = req.headers.get('authorization');

  if (basicAuth && basicAuth.startsWith('Basic ')) {
    try {
      // Isolate the base64 string snippet
      const token = basicAuth.split(' ')[1];
      
      // EDGE ENVIRONMENT SAFE: Use standard text decoding instead of native atob
      const decoded = stringFromBase64(token);
      const parts = decoded.split(':');
      const password = parts[1]; // Extract the literal password text input

      if (password === sitePassword) {
        return NextResponse.next(); // Password matches perfectly, unlock the web session!
      }
    } catch (err) {
      console.error('Middleware decryption error:', err);
    }
  }

  // Present the browser's built-in login prompt if unauthorized
  return new NextResponse('Authentication Required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Site"',
    },
  });
}

// Helper utility to safely convert base64 inside Vercel's Edge Environment
function stringFromBase64(base64) {
  const binString = atob(base64);
  const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0));
  return new TextDecoder().decode(bytes);
}

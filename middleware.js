import { NextResponse } from 'next/server';

export const config = {
  // Run this check on the main entry pages, but ignore images, scripts, and api folders
  matcher: ['/', '/index.html'],
};

export function middleware(req) {
  const sitePassword = process.env.SITE_PASSWORD;

  // If no password environment variable is set on Vercel, let visitors through
  if (!sitePassword) {
    return NextResponse.next();
  }

  const basicAuth = req.headers.get('authorization');

  if (basicAuth) {
    try {
      // Decode Basic Auth header (Format: Basic base64(username:password))
      const authValue = basicAuth.split(' ')[1];
      const [_, password] = atob(authValue).split(':');

      if (password === sitePassword) {
        return NextResponse.next(); // Password matches perfectly, let them in!
      }
    } catch (err) {
      console.error('Middleware auth parsing error', err);
    }
  }

  // Trigger the browser's built-in login prompt if unauthorized
  return new NextResponse('Authentication Required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Site"',
    },
  });
}

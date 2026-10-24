import { NextResponse } from 'next/server';

export const config = {
  // Protect the homepage and root file explicitly
  matcher: ['/', '/index.html'],
};

export function middleware(req) {
  const sitePassword = process.env.SITE_PASSWORD;

  // If no password environment variable is set on Vercel, let visitors through
  if (!sitePassword) {
    return NextResponse.next();
  }

  // 1. Generate the expected base64 credential matching string.
  // Basic Auth is structured as "username:password". Since username is blank, it's ":yourpassword"
  const expectedCredentialString = btoa(`:${sitePassword}`);
  const expectedAuthHeader = `Basic ${expectedCredentialString}`;

  // 2. Read the visitor's authentication attempt header
  const authHeader = req.headers.get('authorization');

  // 3. Simple, native text matching—immune to edge runtime parsing crashes
  if (authHeader === expectedAuthHeader) {
    return NextResponse.next(); // Password matches perfectly, unlock website!
  }

  // Present the browser's built-in login prompt if unauthorized
  return new NextResponse('Authentication Required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Site"',
    },
  });
}

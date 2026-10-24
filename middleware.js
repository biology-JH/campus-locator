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
      // Isolate the base64 token
      const token = basicAuth.split(' ')[1];
      
      // Decode Base64 safely without using 'atob' or Node buffers
      const decoded = customBase64Decode(token);
      const parts = decoded.split(':');
      
      // Pull out the password string value (Format is username:password)
      const password = parts[1]; 

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

// A pure JavaScript Base64 decoder that works flawlessly inside Vercel Edge
function customBase64Decode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let raw = str.replace(/=+$/, '');
  let output = '';
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < raw.length; i++) {
    const idx = chars.indexOf(raw[i]);
    if (idx === -1) continue;
    
    buffer = (buffer << 6) | idx;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

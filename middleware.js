import { next } from '@vercel/functions';

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export default function middleware(request) {
  const expectedUser = process.env.SITE_LOCK_USER;
  const expectedPass = process.env.SITE_LOCK_PASSWORD;

  // Lock disabled unless both credentials are configured.
  if (!expectedUser || !expectedPass) return next();

  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Basic ')) {
    try {
      const decoded = atob(authHeader.slice(6));
      const sep = decoded.indexOf(':');
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      if (timingSafeEqual(user, expectedUser) && timingSafeEqual(pass, expectedPass)) {
        return next();
      }
    } catch {
      // fall through to 401
    }
  }

  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Gaya - Private Site"' },
  });
}

// No matcher: runs on every request (static assets, pages, and /api/*).

/* Eval bar data for /evalbar/. The Mac that reads the VGC broadcast PUTs
   head.json and one file per game; visitors' pages GET them. head.json is
   polled, so the CDN holds it for 10 seconds and the function runs about
   once per 10 seconds however many people watch: the durable cache, which
   shares a response across edge nodes, skips anything held for less (it
   bypassed s-maxage=5 when measured on 2026-10-10). Game files are asked
   for as <key>?v=<version> and cached for a year: query strings
   are part of the CDN cache key for function responses, and Netlify-Vary
   keeps any other query parameter out of it.

   Environment (Netlify site settings, a production-only secret):
   EVALBAR_TOKEN, the bearer token the Mac sends with every write. Deploy
   previews have no token, so they read the same store but cannot write. */
import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Config, Context } from '@netlify/functions';

const KEY = /^[A-Za-z0-9_-]{1,80}\.json$/;
const MAX_BYTES = 512 * 1024;

// hashing first makes the comparison constant-time whatever the lengths
const digest = (s: string) => createHash('sha256').update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

// v is a hash of the file, so a versioned URL never changes and browsers may keep it too
const reply = (status: number, body: string | null = null, versioned = false) => new Response(body, {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': versioned ? 'public, durable, s-maxage=31536000, immutable' : 'public, durable, s-maxage=10',
    'Netlify-Vary': 'query=v',
  },
});

export default async (req: Request, context: Context) => {
  const key = context.params.key;
  // strong reads: an eventually consistent read could put an old game under a new ?v= for good
  const store = getStore({ name: 'evalbar', consistency: 'strong' });

  if (req.method === 'GET') {
    if (!KEY.test(key)) return reply(404);
    const body = await store.get(key, { type: 'text' });
    if (body === null) return reply(404);
    const versioned = key !== 'head.json' && /^\d+$/.test(new URL(req.url).searchParams.get('v') ?? '');
    return reply(200, body, versioned);
  }

  const token = process.env.EVALBAR_TOKEN;
  if (!token) return new Response('not configured', { status: 503 });
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !same(auth.slice(7), token)) return new Response('unauthorized', { status: 401 });
  if (!KEY.test(key)) return new Response('bad key', { status: 400 });
  if (!/^application\/json\s*(;|$)/i.test(req.headers.get('content-type') ?? '')) return new Response('JSON only', { status: 400 });
  if (Number(req.headers.get('content-length')) > MAX_BYTES) return new Response('too large', { status: 413 });
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return new Response('too large', { status: 413 });
  const text = new TextDecoder().decode(bytes);
  try { JSON.parse(text); } catch (e) { return new Response('not JSON', { status: 400 }); }
  await store.set(key, text);
  return new Response(null, { status: 204 });
};

export const config: Config = {
  path: '/api/evalbar/:key',
  method: ['GET', 'PUT'],
};

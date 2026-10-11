/* Temporary experiment, never merged: which Netlify-CDN-Cache-Control values
   the durable cache keeps, and whether a tag purge works on this plan. */
import { purgeCache, type Config, type Context } from '@netlify/functions';

const CDN: Record<string, string> = {
  a: 'public, durable, s-maxage=5',
  b: 'public, durable, s-maxage=60',
  c: 'public, durable, s-maxage=5, stale-while-revalidate=30',
  d: 'public, durable, s-maxage=60, stale-while-revalidate=30',
  e: 'public, durable, s-maxage=31536000',
  f: 'public, durable, s-maxage=31536000, stale-while-revalidate=30',
};

export default async (req: Request, context: Context) => {
  const v = context.params.variant;
  if (req.method === 'POST' && v === 'purge') {
    const t0 = Date.now();
    try { await purgeCache({ tags: ['cachetest-e', 'cachetest-f'] }); } catch (e) { return Response.json({ purged: false, error: String(e) }); }
    return Response.json({ purged: true, ms: Date.now() - t0 });
  }
  if (!CDN[v]) return new Response('no', { status: 404 });
  return Response.json({ variant: v, at: Date.now() }, {
    headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Netlify-CDN-Cache-Control': CDN[v],
      'Netlify-Cache-Tag': 'cachetest-' + v,
      'Netlify-Vary': 'query=v',
    },
  });
};

export const config: Config = { path: '/api/cachetest/:variant', method: ['GET', 'POST'] };

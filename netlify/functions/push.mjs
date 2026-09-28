/* Seven Tiles turn notifications. The database calls this when a move is
   saved (see notify_turn in plans/seven-tiles-supabase.sql), with the game
   record and the web-push subscriptions of the player whose turn it now is.
   It words the notification, signs and sends it to each subscription, and
   reports subscriptions the push service says are gone.

   Environment (Netlify site settings): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
   and PUSH_SECRET, which must match the 'secret' row of push_config. */
import webpush from 'web-push';
import { timingSafeEqual } from 'node:crypto';
import { turnMessage } from './lib/turn-message.mjs';

const SUPABASE_URL = 'https://ebbgvdomzqsmecryepon.supabase.co';
const SUPABASE_KEY = 'sb_publishable_OL6TD1hxZosugdW-IntbYQ_dKZSGH22';   // public by design, like the page's

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export default async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const { PUSH_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!PUSH_SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return new Response('not configured', { status: 503 });
  if (!same(req.headers.get('x-push-secret'), PUSH_SECRET)) return new Response('forbidden', { status: 403 });
  let body;
  try { body = await req.json(); } catch (e) { return new Response('bad request', { status: 400 }); }
  const payload = JSON.stringify(turnMessage(body));
  webpush.setVapidDetails('https://shichengrao.com/seven-tiles/', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const gone = [];
  let sent = 0;
  await Promise.all((Array.isArray(body.subs) ? body.subs : []).slice(0, 20).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 3 * 24 * 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) gone.push(s.endpoint);
    }
  }));
  if (gone.length) {
    await fetch(SUPABASE_URL + '/rest/v1/rpc/push_prune', {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ p_secret: PUSH_SECRET, p_endpoints: gone })
    }).catch(() => {});
  }
  return Response.json({ sent, gone: gone.length });
};

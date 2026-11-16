/* The resume for /resume/, from a Google Doc published to the web. A page on
   this site can't read docs.google.com, so this fetches the published copy
   and hands back the doc's own stylesheet and content as JSON, and the page
   shows them inline, at full width on a phone. Google republishes about every
   five minutes, and the CDN keeps a copy for as long, so the function runs
   about once per five minutes however many people look.

   Only DOC is ever fetched, so this can't be pointed at anything else. It is
   the same link as `doc` in content/resume/_index.md (a test checks). */
export const DOC = 'https://docs.google.com/document/d/e/2PACX-1vROr_pnQu02eOdVk9XrtYIAvP5c3_Mhg9tsqwEFA6JsoTgtnme5Cuni_ivnXEYEGhcjLlIegvwKVpty/pub';

// The published page is Google's chrome and scripts around one stylesheet and
// one div.doc-content. Keep those two; the page parses the content inertly
// and strips anything active before showing it.
export function extract(html) {
  const css = html.match(/<style type="text\/css">([\s\S]*?)<\/style>/);
  const start = html.search(/<div class="[^"]*\bdoc-content\b[^"]*">/);
  if (!css || start < 0) return null;
  const end = html.indexOf('<script', start);
  return { css: css[1], html: html.slice(start, end < 0 ? undefined : end) };
}

const reply = (status, body = null) => new Response(body, {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': status === 200 ? 'public, durable, s-maxage=300, stale-while-revalidate=86400' : 'no-store',
  },
});

export default async () => {
  let page;
  try {
    const res = await fetch(`${DOC}?embedded=true`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return reply(502);
    page = await res.text();
  } catch (e) {
    return reply(502);
  }
  const doc = extract(page);
  return doc ? reply(200, JSON.stringify(doc)) : reply(502);
};

export const config = {
  path: '/api/resume',
  method: ['GET'],
};

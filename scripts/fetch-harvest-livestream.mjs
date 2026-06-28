import { mkdir, readFile, writeFile } from "node:fs/promises";

const CHANNEL_ID = "UCgWXzSt9GyMkmYnzII75SGA";
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const TITLE_NEEDLE = "harvest sunday service";
const OUT_FILE = new URL("../data/harvest_livestream.json", import.meta.url);
const FALLBACK = {
  videoId: "8QC1aqtN0ws",
  title: "Harvest Sunday Service | 6/28/2026 |",
  url: "https://www.youtube.com/watch?v=8QC1aqtN0ws",
  channelUrl: "https://www.youtube.com/@harvestinthecity/streams",
  matchedTitleWords: TITLE_NEEDLE,
  source: "fallback",
  serviceDate: "2026-06-28",
  updatedAt: "2026-06-21T22:06:10+00:00"
};

function textBetween(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1].trim()) : "";
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function serviceDateFromTitle(title) {
  const match = title.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!match) return "";

  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  if (!month || !day || month > 12 || day > 31) return "";

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseEntries(feed) {
  return [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map(([, entry]) => {
      const videoId = textBetween(entry, "yt:videoId");
      const title = textBetween(entry, "title");
      const updatedAt = textBetween(entry, "updated");
      const publishedAt = textBetween(entry, "published");
      return {
        videoId,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        channelUrl: "https://www.youtube.com/@harvestinthecity/streams",
        matchedTitleWords: TITLE_NEEDLE,
        source: "youtube-feed",
        serviceDate: serviceDateFromTitle(title),
        updatedAt,
        publishedAt
      };
    })
    .filter((entry) => {
      return entry.videoId && entry.title.toLowerCase().includes(TITLE_NEEDLE);
    });
}

function sortKey(entry) {
  return entry.serviceDate || entry.publishedAt || entry.updatedAt || "";
}

async function currentOrFallback() {
  try {
    return JSON.parse(await readFile(OUT_FILE, "utf8"));
  } catch {
    return FALLBACK;
  }
}

async function main() {
  try {
    const response = await fetch(FEED_URL);
    if (!response.ok) throw new Error(`YouTube feed returned ${response.status}`);

    const feed = await response.text();
    const latest = parseEntries(feed).sort((a, b) => sortKey(b).localeCompare(sortKey(a)))[0];
    if (!latest) throw new Error(`No video title contained "${TITLE_NEEDLE}"`);

    await mkdir(new URL("../data", import.meta.url), { recursive: true });
    await writeFile(OUT_FILE, `${JSON.stringify(latest, null, 2)}\n`);
    console.log(`Selected Harvest livestream: ${latest.title} (${latest.videoId})`);
  } catch (error) {
    const fallback = await currentOrFallback();
    await mkdir(new URL("../data", import.meta.url), { recursive: true });
    await writeFile(OUT_FILE, `${JSON.stringify({ ...fallback, source: `${fallback.source || "cached"}-cached` }, null, 2)}\n`);
    console.warn(`Could not refresh Harvest livestream: ${error.message}`);
  }
}

await main();

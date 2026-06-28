import { mkdir, readFile, writeFile } from "node:fs/promises";

const CHANNEL_ID = "UCgWXzSt9GyMkmYnzII75SGA";
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const STREAMS_URL = "https://www.youtube.com/@harvestinthecity/streams";
const TITLE_NEEDLE = "harvest sunday service";
const OUT_FILE = new URL("../data/harvest_livestream.json", import.meta.url);
const FALLBACK = {
  videoId: "deB9CZdH_H0",
  title: "Harvest Sunday Service | Father's Day Performance (2026)",
  url: "https://www.youtube.com/watch?v=deB9CZdH_H0",
  channelUrl: STREAMS_URL,
  matchedTitleWords: TITLE_NEEDLE,
  source: "fallback",
  serviceDate: "",
  updatedAt: "2026-06-21T21:50:12+00:00"
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

function unique(items) {
  return [...new Set(items)];
}

function parseStreamsPageOrder(html) {
  return unique([...html.matchAll(/"videoId":"([^"]+)"/g)].map(([, videoId]) => videoId));
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
    const entries = parseEntries(feed);
    const byVideoId = new Map(entries.map((entry) => [entry.videoId, entry]));

    const streamsResponse = await fetch(STREAMS_URL);
    const streamsPage = streamsResponse.ok ? await streamsResponse.text() : "";
    const orderedVideoIds = parseStreamsPageOrder(streamsPage);

    const latestFromPage = orderedVideoIds
      .map((videoId) => byVideoId.get(videoId))
      .find(Boolean);

    const latest = latestFromPage || entries.sort((a, b) => sortKey(b).localeCompare(sortKey(a)))[0];
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

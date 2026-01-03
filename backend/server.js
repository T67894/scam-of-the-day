import express from "express";
import cheerio from "cheerio";
import NodeCache from "node-cache";

const app = express();
const cache = new NodeCache({ stdTTL: 60 * 60 }); // 1 hour
const PORT = process.env.PORT || 3000;

// ---------- Helpers ----------
function ymd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// FNV-1a 32-bit for deterministic daily pick
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pickIndexForDate(dateStr, count) {
  if (!count) return 0;
  return fnv1a32(dateStr) % count;
}

function strip(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function simplifyText(text, maxLen = 360) {
  let t = strip(text);
  t = t.replace(/[“”]/g, '"').replace(/[’]/g, "'");
  if (t.length > maxLen) t = t.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
  return t;
}

function genericAvoidTips() {
  return [
    "Don’t click links or call numbers from unexpected messages.",
    "Hang up. Then call the organization using a trusted number (card, bill, official website).",
    "Never share passwords or one-time codes.",
    "If pressured to act immediately, stop—scammers use urgency.",
    "Talk to a trusted family member or caregiver before sending money."
  ];
}

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ScamOfTheDayBot/1.0 (educational)",
      "Accept": "text/html,*/*"
    }
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

// ---------- Source fetchers (best-effort HTML parsing) ----------

async function getFTCAlerts(limit = 12) {
  const url = "https://consumer.ftc.gov/consumer-alerts";
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const links = [];
  $("a[href*='/consumer-alerts/']").each((_, el) => {
    const href = $(el).attr("href");
    const title = strip($(el).text());
    if (!href || !title) return;
    const full = href.startsWith("http") ? href : `https://consumer.ftc.gov${href}`;
    if (!full.includes("/consumer-alerts/")) return;
    links.push({ title, url: full });
  });

  const seen = new Set();
  const deduped = [];
  for (const it of links) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    deduped.push(it);
  }

  const top = deduped.slice(0, limit);
  const out = [];

  for (const it of top) {
    try {
      const articleHTML = await fetchHTML(it.url);
      const $$ = cheerio.load(articleHTML);

      const desc =
        $$("meta[name='description']").attr("content") ||
        strip($$("article p").first().text()) ||
        strip($$("main p").first().text());

      out.push({
        id: `ftc:${it.url}`,
        title: it.title,
        category: "FTC Consumer Alert",
        source: "FTC",
        sourceUrl: it.url,
        looksLike: simplifyText(desc || "Consumer scam alert from the FTC."),
        avoid: genericAvoidTips(),
        redFlags: [
          "Unexpected contact",
          "Urgency or threats",
          "Request for money, gift cards, or crypto",
          "Asks for personal info or one-time codes"
        ],
        published: null
      });
    } catch {}
  }

  return out;
}

async function getIC3PSAs(limit = 12) {
  const url = "https://www.ic3.gov/PSA";
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const links = [];
  $("a[href*='/PSA/']").each((_, el) => {
    const href = $(el).attr("href");
    const title = strip($(el).text());
    if (!href || !title) return;
    if (!href.includes("/PSA/20")) return;
    const full = href.startsWith("http") ? href : `https://www.ic3.gov${href}`;
    links.push({ title, url: full });
  });

  const seen = new Set();
  const deduped = [];
  for (const it of links) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    deduped.push(it);
  }

  const top = deduped.slice(0, limit);
  const out = [];

  for (const it of top) {
    try {
      const articleHTML = await fetchHTML(it.url);
      const $$ = cheerio.load(articleHTML);

      const desc =
        $$("meta[name='description']").attr("content") ||
        strip($$("main p").first().text()) ||
        strip($$("article p").first().text());

      out.push({
        id: `ic3:${it.url}`,
        title: it.title,
        category: "FBI IC3 PSA",
        source: "FBI IC3",
        sourceUrl: it.url,
        looksLike: simplifyText(desc || "Public safety scam advisory from FBI IC3."),
        avoid: genericAvoidTips(),
        redFlags: [
          "Impersonation of government or bank",
          "Requests for wire transfer, gift cards, or crypto",
          "Links to lookalike websites",
          "Pressure to act fast"
        ],
        published: null
      });
    } catch {}
  }

  return out;
}

async function getSSAOIG(limit = 12) {
  const url = "https://oig.ssa.gov/scam-alerts/";
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const links = [];
  $("a[href*='/scam-alerts/']").each((_, el) => {
    const href = $(el).attr("href");
    const title = strip($(el).text());
    if (!href || !title) return;
    if (href.endsWith("/scam-alerts/")) return;
    const full = href.startsWith("http") ? href : `https://oig.ssa.gov${href}`;
    links.push({ title, url: full });
  });

  const seen = new Set();
  const deduped = [];
  for (const it of links) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    deduped.push(it);
  }

  const top = deduped.slice(0, limit);
  const out = [];

  for (const it of top) {
    try {
      const articleHTML = await fetchHTML(it.url);
      const $$ = cheerio.load(articleHTML);

      const desc =
        $$("meta[name='description']").attr("content") ||
        strip($$("main p").first().text()) ||
        strip($$("article p").first().text());

      out.push({
        id: `ssa:${it.url}`,
        title: it.title,
        category: "SSA OIG Scam Alert",
        source: "SSA OIG",
        sourceUrl: it.url,
        looksLike: simplifyText(desc || "Scam alert related to Social Security impersonation/fraud."),
        avoid: [
          "Social Security will not threaten you or demand immediate payment.",
          "Do not share your Social Security number or banking info with unexpected callers.",
          "Hang up and use official numbers from SSA.gov or your statement.",
          "Talk to a trusted family member or caregiver before sending money."
        ],
        redFlags: [
          "Threats of arrest or benefit suspension",
          "Demands for gift cards, crypto, or wire transfer",
          "Caller claims to be SSA/police and uses ‘badge numbers’"
        ],
        published: null
      });
    } catch {}
  }

  return out;
}

async function buildFeed() {
  const cached = cache.get("feed");
  if (cached) return cached;

  const [ftc, ic3, ssa] = await Promise.allSettled([
    getFTCAlerts(12),
    getIC3PSAs(12),
    getSSAOIG(12)
  ]);

  const list = []
    .concat(ftc.status === "fulfilled" ? ftc.value : [])
    .concat(ic3.status === "fulfilled" ? ic3.value : [])
    .concat(ssa.status === "fulfilled" ? ssa.value : []);

  // De-dupe by sourceUrl
  const seen = new Set();
  const deduped = [];
  for (const s of list) {
    if (!s.sourceUrl) continue;
    if (seen.has(s.sourceUrl)) continue;
    seen.add(s.sourceUrl);
    deduped.push(s);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    scams: deduped
  };

  cache.set("feed", payload);
  return payload;
}

// ---------- Routes ----------
app.get("/", (_, res) => {
  res.type("text").send("Scam of the Day backend running. Try /api/scam-of-day");
});

app.get("/api/scams", async (_, res) => {
  try {
    const feed = await buildFeed();
    res.json(feed);
  } catch (e) {
    res.status(500).json({ error: "Failed to build feed", details: String(e) });
  }
});

app.get("/api/scam-of-day", async (req, res) => {
  try {
    const dateStr = (req.query.date || ymd()).toString();
    const feed = await buildFeed();
    const scams = feed.scams || [];
    if (!scams.length) return res.status(503).json({ error: "No scams available right now." });

    const idx = pickIndexForDate(dateStr, scams.length);
    res.json({
      date: dateStr,
      index: idx,
      total: scams.length,
      scam: scams[idx]
    });
  } catch (e) {
    res.status(500).json({ error: "Failed to get scam of day", details: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});


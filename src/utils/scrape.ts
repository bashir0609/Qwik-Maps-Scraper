import { server$ } from "@builder.io/qwik-city";
import puppeteer, { type Browser, type Page } from "puppeteer";
import type { PlaceResult, ScrapeResult } from "../types";
import { rmSync } from "fs";

const BROWSERS_COUNT = 3;
const browsers: Browser[] = [];
const browserTempDirs: string[] = [];
let browserRoundRobin = 0;

const MAX_CONCURRENT_SESSIONS = 5;

const RATE_DELAY = {
  betweenKeywords: 1000,
  betweenTowns: 2000,
  detailPage: 500,
  emailPage: 500,
};

interface ScrapeSession {
  query: string;
  places: PlaceResult[];
  totalResults: number;
  status: "running" | "done" | "error";
  progress: string;
  error: string | null;
  _lastSnapshot: string;
}

const sessions = new Map<string, ScrapeSession>();

const SESSION_TTL = 30 * 60 * 1000;
const ORPHANED_SESSION_MAX_AGE = 60 * 60 * 1000;

const MULTI_PART_TLDS = new Set([
  "co.uk",
  "co.nz",
  "co.za",
  "co.in",
  "co.ke",
  "co.tz",
  "co.ug",
  "co.id",
  "com.au",
  "com.br",
  "com.cn",
  "com.hk",
  "com.my",
  "com.sg",
  "com.tw",
  "com.mx",
  "com.ar",
  "com.tr",
  "com.pk",
  "com.ph",
  "com.co",
  "com.pe",
  "org.uk",
  "org.au",
  "org.nz",
  "org.in",
  "net.au",
  "net.nz",
  "net.in",
  "ac.uk",
  "ac.nz",
  "ac.in",
  "ac.za",
  "edu.au",
  "edu.in",
  "gov.uk",
  "gov.au",
  "gov.in",
]);

function extractRootDomain(urlStr: string): string {
  if (!urlStr) return "";
  try {
    const u = new URL(urlStr.startsWith("http") ? urlStr : `https://${urlStr}`);
    const host = u.hostname.replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join(".");
    const lastThree = parts.slice(-3).join(".");
    if (MULTI_PART_TLDS.has(lastThree)) {
      return lastThree;
    }
    if (MULTI_PART_TLDS.has(lastTwo)) {
      return parts.slice(-3).join(".");
    }
    return lastTwo;
  } catch {
    return "";
  }
}

function isValidGoogleMapsUrl(url: string): boolean {
  if (!url) return false;
  return url.includes("google.com/maps") || url.includes("maps.google.com");
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const sessionAge = now - parseInt(id.split("-")[0]);
    const isStale = s.status !== "running" && sessionAge > SESSION_TTL;
    const isOrphaned =
      s.status === "running" && sessionAge > ORPHANED_SESSION_MAX_AGE;
    if (isStale || isOrphaned) {
      console.log(
        `[session cleanup] Removing ${isOrphaned ? "orphaned" : "stale"} session: ${id.substring(0, 20)}...`,
      );
      sessions.delete(id);
    }
  }
}, 60_000);

async function cleanupBrowsers(): Promise<void> {
  for (const b of browsers) {
    try {
      if (b.connected) await b.close();
    } catch {
      /* ignore */
    }
  }
  browsers.length = 0;
  browserRoundRobin = 0;
  for (const dir of browserTempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  browserTempDirs.length = 0;
}

if (typeof process !== "undefined") {
  process.on("SIGINT", async () => {
    console.log("[cleanup] Received SIGINT, closing browsers...");
    await cleanupBrowsers();
    process.exit(0);
  });
  process.on("exit", async () => {
    console.log("[cleanup] Process exiting, closing browsers...");
    await cleanupBrowsers();
  });
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
  const tempDir = `/tmp/puppeteer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  browserTempDirs.push(tempDir);
  return puppeteer.launch({
    headless: true,
    executablePath,
    protocolTimeout: 120000,
    userDataDir: tempDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--window-size=1920,1080",
      "--lang=en-US,en",
      "--disable-blink-features=AutomationControlled",
      "--incognito",
      "--disable-third-party-cookies",
      "--disk-cache-size=0",
      "--disable-features=NetworkService,TranslateUI",
      "--disable-ipc-flooding-protection",
      "--disable-background-networking",
      "--disable-sync",
    ],
  });
}

async function getBrowser(): Promise<Browser> {
  // Try to reuse an existing connected browser
  for (let round = 0; round < browsers.length; round++) {
    const idx = browserRoundRobin++ % browsers.length;
    const b = browsers[idx];
    if (!b || !b.connected) {
      browsers.splice(idx, 1);
      browserRoundRobin = 0;
      continue;
    }
    // Quick health check
    try {
      await b.version();
      return b;
    } catch {
      try {
        await b.close();
      } catch {
        /* ignore */
      }
      browsers.splice(idx, 1);
      browserRoundRobin = 0;
    }
  }
  // No healthy browser — launch new one
  const b = await launchBrowser();
  browsers.push(b);
  return b;
}

async function ensureBrowsers(count: number): Promise<void> {
  while (browsers.length < count) {
    browsers.push(await launchBrowser());
  }
}

async function closeAllBrowsers(): Promise<void> {
  for (const b of browsers) {
    try {
      if (b.connected) await b.close();
    } catch {
      /* ignore */
    }
  }
  browsers.length = 0;
  browserRoundRobin = 0;
  for (const dir of browserTempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  browserTempDirs.length = 0;
}

async function setupPage(
  page: Page,
  blockStyles: boolean = true,
): Promise<void> {
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  );
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  });

  // Block ads, trackers, analytics, and non-essential resources
  const blockPatterns = [
    /google-analytics/i,
    /googletagmanager/i,
    /analytics/i,
    /tracker/i,
    /doubleclick/i,
    /ads\/ads/i,
    /pagead2\.googlesyndication/i,
    /cdn\.segment/i,
    /intercom/i,
    /mixpanel/i,
    /hotjar/i,
    /facebook\.com\/tr/i,
    /googleadservices/i,
  ];

  await page.on("request", (request) => {
    const url = request.url();
    const resourceType = request.resourceType();

    // Block tracking/ad resources
    if (blockPatterns.some((p) => p.test(url))) {
      request.abort().catch(() => {});
      return;
    }

    // Block stylesheets, fonts, and non-Google images for Maps scraping
    if (
      blockStyles &&
      (resourceType === "stylesheet" ||
        resourceType === "font" ||
        (resourceType === "image" &&
          !url.includes("google") &&
          !url.includes("gstatic")))
    ) {
      request.abort().catch(() => {});
      return;
    }

    request.continue().catch(() => {});
  });
}

async function scrapeDetailPage(
  browser: Browser,
  href: string,
  retries: number = 1,
  timeoutMs: number = 30000,
): Promise<{
  name: string;
  category: string;
  rating: number | null;
  reviewCount: number | null;
  address: string;
  phone: string;
  website: string;
  placeUrl: string;
  lat: number | null;
  lng: number | null;
} | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const page = await browser.newPage();
    try {
      await setupPage(page);
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        (window as any).chrome = { runtime: {} };
        (navigator as any).plugins = [1, 2, 3, 4, 5];
        (navigator as any).languages = ["en-US", "en"];
      });
      await page.goto(href, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      await handleConsent(page);
      await page.waitForSelector("h1", { timeout: 8000 }).catch(() => null);
      await new Promise((r) => setTimeout(r, 1000));

      const result = await page.evaluate(() => {
        function parseReviewNum(raw: string): number | null {
          const cleaned = raw.replace(/[()]/g, "").trim();
          const m = cleaned.match(/^([\d.,]+)\s*([kKmM])?$/i);
          if (!m) return null;
          let num = m[1];
          if (/^\d{1,3}(\.\d{3})+$/.test(num))
            num = num.replace(/\./g, ""); // European: 1.234 → 1234
          else num = num.replace(/,/g, ""); // EN: 1,234 → 1234
          let n = parseFloat(num);
          if (m[2]?.toLowerCase() === "k") n *= 1000;
          else if (m[2]?.toLowerCase() === "m") n *= 1000000;
          return !isNaN(n) && n > 0 ? Math.round(n) : null;
        }
        function parseReviewFromLabel(label: string): number | null {
          const m = label.match(/([\d.,]+)\s*([kKmM])?\s*reviews?/i);
          if (!m) return null;
          let num = m[1];
          if (/^\d{1,3}(\.\d{3})+$/.test(num)) num = num.replace(/\./g, "");
          else num = num.replace(/,/g, "");
          let n = parseFloat(num);
          if (m[2]?.toLowerCase() === "k") n *= 1000;
          else if (m[2]?.toLowerCase() === "m") n *= 1000000;
          return !isNaN(n) && n > 0 ? Math.round(n) : null;
        }
        const name =
          (
            document.querySelector("h1.DUwDvf") as HTMLElement | null
          )?.textContent?.trim() ||
          (
            document.querySelector("h1") as HTMLElement | null
          )?.textContent?.trim() ||
          "";

        let category = "";
        const h1 =
          document.querySelector("h1.DUwDvf") || document.querySelector("h1");

        const catBtn = document.querySelector('button[jsaction*="pancat"]');
        if (catBtn) {
          const txt = (catBtn as HTMLElement).textContent?.trim() || "";
          if (txt && txt.length > 2 && txt.length < 60) category = txt;
        }

        if (!category) {
          const catBadge = document.querySelector(
            ".fontBodyMedium .DkEaL, .fontBodyMedium button",
          );
          if (catBadge) {
            const txt = (catBadge as HTMLElement).textContent?.trim() || "";
            if (isValidCategory(txt, name)) category = txt;
          }
        }

        if (!category && h1 && h1.parentElement) {
          const parent = h1.parentElement;
          const h1Next = h1.nextElementSibling;
          if (h1Next) {
            const txt = (h1Next as HTMLElement).textContent?.trim() || "";
            if (isValidCategory(txt, name)) category = txt;
          }
          if (!category) {
            const siblings = parent.querySelectorAll("button");
            for (const sib of siblings) {
              if (sib === h1) continue;
              if ((sib as HTMLElement).closest("[jscontroller]")) continue;
              const txt = (sib as HTMLElement).textContent?.trim() || "";
              if (isValidCategory(txt, name)) {
                category = txt;
                break;
              }
            }
          }
        }

        if (!category) {
          const infoRow = document.querySelector(".Io6YTe");
          if (infoRow) {
            const prev = infoRow.previousElementSibling;
            if (prev) {
              const txt = (prev as HTMLElement).textContent?.trim() || "";
              if (isValidCategory(txt, name)) category = txt;
            }
          }
        }

        let rating: number | null = null;
        let reviewCount: number | null = null;
        document.querySelectorAll("[aria-label]").forEach((el) => {
          const label = (el as HTMLElement).getAttribute("aria-label") || "";
          const rm = label.match(/(\d[.,]\d)[\s/]*(?:star|stars|\u2B50)/i);
          if (rm && rating === null)
            rating = parseFloat(rm[1].replace(",", "."));
          const rv = parseReviewFromLabel(label);
          if (rv !== null && reviewCount === null) reviewCount = rv;
        });
        const ratingEl = document.querySelector(
          ".MW4etd",
        ) as HTMLElement | null;
        if (rating === null && ratingEl) {
          const m = (ratingEl.textContent || "").match(/(\d[.,]\d)/);
          if (m) rating = parseFloat(m[1].replace(",", "."));
        }
        const reviewEl = document.querySelector(
          ".UY7F9d",
        ) as HTMLElement | null;
        if (reviewCount === null && reviewEl) {
          const rc = parseReviewNum(reviewEl.textContent || "");
          if (rc !== null) reviewCount = rc;
        }
        if (reviewCount === null) {
          document
            .querySelectorAll(".fontBodyMedium span, .UY7F9d")
            .forEach((el) => {
              if (reviewCount !== null) return;
              const rc = parseReviewNum((el as HTMLElement).textContent || "");
              if (rc !== null && rc >= 1) reviewCount = rc;
            });
        }

        let address = "";
        for (const item of document.querySelectorAll(".Io6YTe")) {
          const txt = (item as HTMLElement).textContent?.trim() || "";
          if (isValidAddress(txt) && !isJunkText(txt)) {
            address = txt;
            break;
          }
        }
        if (!address) {
          document.querySelectorAll("button[aria-label]").forEach((btn) => {
            if (address) return;
            const label = (btn as HTMLElement).getAttribute("aria-label") || "";
            const cleaned = label
              .replace(/^Copy\s+/i, "")
              .replace(/^Address:\s*/i, "")
              .trim();
            if (
              cleaned.length > 8 &&
              isValidAddress(cleaned) &&
              !isJunkText(cleaned)
            )
              address = cleaned;
          });
        }
        if (!address) {
          document.querySelectorAll("[data-tooltip]").forEach((el) => {
            if (address) return;
            const tip = (el as HTMLElement).getAttribute("data-tooltip") || "";
            if (
              tip.length > 8 &&
              isValidAddress(tip) &&
              !isJunkText(tip) &&
              !tip.toLowerCase().includes("copy")
            )
              address = tip;
          });
        }

        let phone = "";
        const telLinks = document.querySelectorAll('a[href^="tel:"]');
        if (telLinks.length > 0) {
          try {
            phone = decodeURIComponent(
              (telLinks[0] as HTMLAnchorElement).href
                .replace("tel:", "")
                .trim(),
            );
          } catch {
            phone = (telLinks[0] as HTMLAnchorElement).href
              .replace("tel:", "")
              .trim();
          }
        }
        if (!phone) {
          for (const item of document.querySelectorAll(".Io6YTe")) {
            const txt = (item as HTMLElement).textContent?.trim() || "";
            if (isValidPhone(txt)) {
              phone = txt;
              break;
            }
          }
        }
        if (!phone) {
          document.querySelectorAll("[data-tooltip]").forEach((el) => {
            if (phone) return;
            const tip = (el as HTMLElement).getAttribute("data-tooltip") || "";
            if (isValidPhone(tip)) phone = tip.trim();
          });
        }
        if (!phone) {
          document.querySelectorAll("button[aria-label]").forEach((el) => {
            if (phone) return;
            const label = (el as HTMLElement).getAttribute("aria-label") || "";
            const m = label.match(/(?:Phone|Call)[:\s]+([\d\s\-+().]{7,})/i);
            if (m) phone = m[1].trim();
          });
        }

        let website = "";
        const thirdPartyHosts = [
          "opentable.com",
          "resy.com",
          "tripleseat.com",
          "yelp.com",
          "tripadvisor.com",
          "foursquare.com",
          "zomato.com",
          "seamless.com",
          "grubhub.com",
          "ubereats.com",
          "doordash.com",
          "postmates.com",
          "menupages.com",
          "booking.com",
          "hotels.com",
          "expedia.com",
        ];
        for (const link of document.querySelectorAll("a[href]")) {
          const anchor = link as HTMLAnchorElement;
          const href = anchor.href;
          if (
            !href.startsWith("http") ||
            href.includes("google.com") ||
            href.includes("maps.google") ||
            href.includes("gstatic") ||
            href.includes("googleads")
          )
            continue;
          try {
            if (
              thirdPartyHosts.some((h) =>
                new URL(href).hostname.replace("www.", "").endsWith(h),
              )
            )
              continue;
          } catch {
            continue;
          }
          const ariaLabel = (
            anchor.getAttribute("aria-label") || ""
          ).toLowerCase();
          const tooltip = (
            anchor.getAttribute("data-tooltip") || ""
          ).toLowerCase();
          const linkText = (anchor.textContent?.trim() || "").toLowerCase();
          if (
            ariaLabel.includes("website") ||
            tooltip.includes("website") ||
            linkText.includes("website")
          ) {
            website = href;
            break;
          }
          for (const span of anchor.querySelectorAll("span, div")) {
            const domain = (span as HTMLElement).textContent?.trim() || "";
            if (
              domain &&
              domain.includes(".") &&
              !domain.includes(" ") &&
              domain.length < 60 &&
              !domain.includes("google")
            ) {
              website = href;
              break;
            }
          }
          if (website) break;
        }
        if (website) {
          try {
            const u = new URL(website);
            if (u.hostname.startsWith("www.")) {
              u.hostname = u.hostname.slice(4);
            }
            u.hash = "";
            const menuPatterns = [
              /\/menus?\/?$/,
              /\/food[-\w]*-menu\/?$/,
              /\/menu\/?$/,
              /\/s\/.+\.pdf$/,
              /\/book[-\w]*\/?$/,
              /\/book-an-app\/?$/,
              /\/appointments?\/?$/,
              /\/schedule[-\w]*\/?$/,
              /\/reserve\/?$/,
              /\/order[-\w]*\/?$/,
            ];
            if (menuPatterns.some((p) => p.test(u.pathname))) {
              u.pathname = u.pathname
                .replace(/\/menus?\/?$/, "")
                .replace(/\/food[-\w]*-menu\/?$/, "")
                .replace(/\/menu\/?$/, "")
                .replace(/\/s\/[^/]+\.pdf$/, "")
                .replace(/\/$/, "");
            }
            [
              "utm_source",
              "utm_medium",
              "utm_campaign",
              "ref",
              "rwg_token",
              "utm_content",
              "utm_term",
            ].forEach((k) => u.searchParams.delete(k));
            website = u.toString();
          } catch {
            /* invalid URL, keep original */
          }
        }

        const placeUrl = window.location.href;
        const coordMatch = placeUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        const lat = coordMatch ? parseFloat(coordMatch[1]) : null;
        const lng = coordMatch ? parseFloat(coordMatch[2]) : null;

        return {
          name,
          category,
          rating,
          reviewCount,
          address,
          phone,
          website,
          placeUrl,
          lat,
          lng,
        };

        function isValidCategory(txt: string, nm: string): boolean {
          const lower = txt.toLowerCase();
          return (
            txt.length > 2 &&
            txt.length < 60 &&
            txt !== nm &&
            !lower.includes("nearby") &&
            !lower.includes("direction") &&
            !lower.includes("save") &&
            !lower.includes("share") &&
            !lower.includes("order") &&
            !lower.includes("search") &&
            !lower.includes("call") &&
            !lower.includes("copy") &&
            !txt.includes("·") &&
            !/^\d[.,]\d/.test(txt) &&
            !txt.includes("(")
          );
        }
        function isValidAddress(txt: string): boolean {
          if (txt.length <= 8) return false;
          if (!/\d/.test(txt) || !/[a-zA-Z]/.test(txt) || !/\s/.test(txt))
            return false;
          if (/^\d[.,]\d/.test(txt) || txt.includes("·")) return false;
          if (/^[+\d\s\-().]+$/.test(txt.trim())) return false;
          // Reject field-label prefixes (e.g. "Phone: +1 518-897-3281")
          if (
            /^(phone|tel|fax|mobile|cell|email|website|url|address)[\s:]*/i.test(
              txt,
            )
          )
            return false;
          // Reject business hours text
          if (/\bhours?\b/i.test(txt)) return false;
          if (
            /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(
              txt,
            )
          )
            return false;
          if (/Copy open/i.test(txt) || /open 24/i.test(txt)) return false;
          return true;
        }
        function isValidPhone(txt: string): boolean {
          return (
            /^[\d\s\-+().]{7,}$/.test(txt.trim()) && txt.trim().length >= 7
          );
        }
        function isJunkText(txt: string): boolean {
          const lower = txt.toLowerCase();
          return (
            lower.includes("wheelchair") ||
            lower.includes("accessible") ||
            lower.includes("nearby") ||
            lower.includes("dine-in") ||
            lower.includes("takeout") ||
            lower.includes("delivery") ||
            lower.includes("hours") ||
            lower.includes("copy open") ||
            /^(mon|tue|wed|thu|fri|sat|sun)/.test(lower)
          );
        }
      });

      if (!result.name && attempt < retries) {
        if (!page.isClosed()) await page.close().catch(() => {});
        continue;
      }
      return result;
    } catch (err) {
      if (attempt < retries) {
        console.error(
          `[scrapeDetailPage] Attempt ${attempt + 1} failed for ${href}:`,
          err instanceof Error ? err.message : String(err),
        );
        if (!page.isClosed()) await page.close().catch(() => {});
        continue;
      }
      console.error(`[scrapeDetailPage] All attempts failed for ${href}`);
      return null;
    } finally {
      if (!page.isClosed()) await page.close().catch(() => {});
    }
  }
  return null;
}

async function enrichPlaceDetail(
  browser: Browser,
  placeUrl: string,
): Promise<Partial<PlaceResult>> {
  await new Promise((resolve) => setTimeout(resolve, RATE_DELAY.detailPage));

  const enrichWithTimeout = async (): Promise<Partial<PlaceResult>> => {
    const detail = await scrapeDetailPage(browser, placeUrl, 2, 45000);
    if (!detail) {
      console.warn(
        "[enrichPlaceDetail] scrapeDetailPage returned null for:",
        placeUrl.substring(0, 80),
      );
      return {};
    }
    const website = detail.website;
    const rootDomain = extractRootDomain(website);
    const city = extractCityFromAddress(detail.address);
    let email = "";
    if (website) {
      email = await extractEmails(browser, website);
    }
    return {
      name: detail.name,
      address: detail.address,
      rating: detail.rating,
      reviewCount: detail.reviewCount,
      category: detail.category,
      phone: detail.phone,
      email,
      website,
      rootDomain,
      coordinates:
        detail.lat !== null && detail.lng !== null
          ? { lat: detail.lat, lng: detail.lng }
          : null,
      placeUrl: detail.placeUrl,
      city,
    };
  };

  const timeoutMs = 60000;
  const timeoutPromise = new Promise<Partial<PlaceResult>>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            `[enrichPlaceDetail] Timeout after ${timeoutMs}ms for: ${placeUrl.substring(0, 80)}`,
          ),
        ),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([enrichWithTimeout(), timeoutPromise]);
  } catch (err) {
    console.warn(
      "[enrichPlaceDetail] Failed or timed out for:",
      placeUrl.substring(0, 80),
      err instanceof Error ? err.message : String(err),
    );
    return {};
  }
}

async function handleConsent(browserPage: Page): Promise<void> {
  try {
    const selectors = [
      'button[aria-label="Accept all"]',
      'button[aria-label="Accept"]',
      'button[aria-label*="Accept all"]',
      'form[action*="consent"] button',
      "#acceptAllButton",
      'button[name="agree"]',
    ];
    for (const s of selectors) {
      const btn = await browserPage.$(s);
      if (btn) {
        await btn.click().catch(() => {});
        await new Promise((r) => setTimeout(r, 1000));
        return;
      }
    }
    for (const frame of browserPage.frames()) {
      for (const s of selectors) {
        try {
          const btn = await frame.$(s);
          if (btn) {
            await btn.click().catch(() => {});
            await new Promise((r) => setTimeout(r, 1000));
            return;
          }
        } catch {
          continue;
        }
      }
    }
  } catch {
    /* no consent */
  }
}

async function extractEmails(
  browser: Browser,
  websiteUrl: string,
): Promise<string> {
  if (!websiteUrl) return "";
  const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const SKIP_LOCALS = new Set([
    "noreply",
    "webmaster",
    "no-reply",
    "mailer-daemon",
    "postmaster",
    "abuse",
    "admin",
    "example",
    "user",
    "test",
    "donotreply",
    "do-not-reply",
    "bounce",
    "daemon",
    "johndoe",
    "jane.doe",
    "john.doe",
    "janedoe",
    "foo",
    "bar",
    "someone",
  ]);
  const SKIP_DOMAINS = new Set([
    "sentry.io",
    "wixpress.com",
    "sentry-next.wixpress.com",
    "sentry.wixpress.com",
    "example.com",
    "domain.com",
    "test.com",
    "mailchimp.com",
    "klaviyo.com",
  ]);

  const deobfuscate = (s: string): string => {
    return s
      .replace(/\[at\]/gi, "@")
      .replace(/\(at\)/gi, "@")
      .replace(/\sat\s/gi, "@")
      .replace(/\[dot\]/gi, ".")
      .replace(/\(dot\)/gi, ".")
      .replace(/\sdot\s/gi, ".");
  };

  const collectEmailsFromPage = async (
    url: string,
    attemptLabel: string = "homepage",
  ): Promise<Set<string>> => {
    const found = new Set<string>();
    const page = await browser.newPage();
    try {
      await new Promise((resolve) => setTimeout(resolve, RATE_DELAY.emailPage));
      await setupPage(page, false);
      const navResult = await page
        .goto(url, { waitUntil: "networkidle2", timeout: 15000 })
        .catch(() => null);
      if (!navResult) {
        console.error(`[extractEmails] Navigation failed for ${url}`);
        return found;
      }
      await new Promise((r) => setTimeout(r, 2000));

      const emails = await page.evaluate((regexSrc: string) => {
        const results = new Set<string>();
        const regex = new RegExp(regexSrc, "g");
        const bodyText = document.body?.innerText || "";
        let match: RegExpExecArray | null;
        while ((match = regex.exec(bodyText)) !== null) {
          results.add(match[0].toLowerCase());
        }
        const anchors = document.querySelectorAll('a[href^="mailto:"]');
        anchors.forEach((a) => {
          const addr = (a as HTMLAnchorElement).href
            .replace("mailto:", "")
            .split("?")[0]
            .trim()
            .toLowerCase();
          if (addr && addr.includes("@")) results.add(addr);
        });
        return [...results];
      }, EMAIL_REGEX.source);

      const isJunkEmail = (e: string): boolean => {
        const [local, domain] = e.split("@");
        if (!local || !domain) return true;
        if (SKIP_LOCALS.has(local)) return true;
        if (SKIP_DOMAINS.has(domain)) return true;
        if ([...SKIP_DOMAINS].some((d) => domain.endsWith("." + d)))
          return true;
        return false;
      };

      for (const e of emails) {
        const cleaned = deobfuscate(e);
        if (
          cleaned.includes("@") &&
          cleaned.includes(".") &&
          !isJunkEmail(cleaned)
        ) {
          found.add(cleaned);
        }
      }

      if (found.size === 0) {
        const rawHtml = await page.content();
        const matches = rawHtml.match(EMAIL_REGEX);
        if (matches) {
          for (const m of matches) {
            const cleaned = deobfuscate(m.toLowerCase());
            if (
              cleaned.includes("@") &&
              cleaned.includes(".") &&
              !isJunkEmail(cleaned)
            ) {
              found.add(cleaned);
            }
          }
        }
      }
    } catch (err) {
      console.error(
        `[extractEmails] Error on ${attemptLabel}:`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      await page.close().catch(() => {});
    }
    return found;
  };

  try {
    const allEmails = new Set<string>();
    let homepageEmails = await collectEmailsFromPage(websiteUrl, "homepage");
    for (const e of homepageEmails) allEmails.add(e);

    if (allEmails.size === 0) {
      console.error(
        `[extractEmails] No emails found on homepage for ${websiteUrl}, retrying...`,
      );
      homepageEmails = await collectEmailsFromPage(
        websiteUrl,
        "homepage-retry",
      );
      for (const e of homepageEmails) allEmails.add(e);
    }

    if (allEmails.size === 0) return "";

    const websiteDomain = (() => {
      try {
        return new URL(websiteUrl).hostname.replace("www.", "").toLowerCase();
      } catch {
        return "";
      }
    })();

    const sorted = [...allEmails].sort((a, b) => {
      const aDomain = a.split("@")[1] || "";
      const bDomain = b.split("@")[1] || "";
      const aMatch =
        aDomain === websiteDomain
          ? 0
          : aDomain.endsWith("." + websiteDomain)
            ? 1
            : 2;
      const bMatch =
        bDomain === websiteDomain
          ? 0
          : bDomain.endsWith("." + websiteDomain)
            ? 1
            : 2;
      if (aMatch !== bMatch) return aMatch - bMatch;
      const priorityPrefixes = [
        "info",
        "hello",
        "contact",
        "book",
        "reserv",
        "book",
        "appoint",
        "inquir",
        "support",
        "sales",
        "admin",
        "office",
        "hello",
        "hi",
      ];
      const aPrio = priorityPrefixes.some((p) => a.split("@")[0].startsWith(p))
        ? 0
        : 1;
      const bPrio = priorityPrefixes.some((p) => b.split("@")[0].startsWith(p))
        ? 0
        : 1;
      if (aPrio !== bPrio) return aPrio - bPrio;
      return a.localeCompare(b);
    });

    return sorted.slice(0, 3).join(", ");
  } catch {
    return "";
  }
}

async function exhaustivelyScroll(
  page: Page,
  limit: number = 9999,
): Promise<void> {
  await page.evaluate(async (maxCards: number) => {
    const feed = document.querySelector('[role="feed"]');
    if (!feed) return;
    let prevCount = document.querySelectorAll(".Nv2PK").length;
    let staleRounds = 0;
    while (true) {
      if (document.querySelectorAll(".Nv2PK").length >= maxCards) break;
      feed.scrollBy({ top: 3000, behavior: "smooth" });
      await new Promise((r) => setTimeout(r, 1500));
      // Check for "end of list" indicator
      const bodyText = document.body.innerText;
      if (/You've reached the end of the list/i.test(bodyText)) break;
      const newCount = document.querySelectorAll(".Nv2PK").length;
      if (newCount === prevCount) {
        staleRounds++;
        if (staleRounds >= 10) break;
      } else {
        staleRounds = 0;
      }
      prevCount = newCount;
    }
  }, limit);
  await new Promise((r) => setTimeout(r, 2000));
}

function extractCityFromAddress(address: string): string {
  if (!address) return "";
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return "";
  let last = parts.length - 1;
  const countries = new Set([
    "usa",
    "united states",
    "uk",
    "united kingdom",
    "australia",
    "canada",
    "saudi arabia",
    "new zealand",
  ]);
  if (countries.has(parts[last].toLowerCase())) last--;
  if (last < 1) return "";
  // Try parts[last] first: handles "Tuggerah NSW 2259" or "IL 62701" where city+state+postcode are one segment
  const lastPart = parts[last];
  const m1 = lastPart.match(
    /^(.+?)\s+(?:[A-Z]{2,3}\s+\d{3,5}(?:-\d{4})?|[A-Z]{1,2}\d)/,
  );
  if (m1) return m1[1].trim();
  // Standard multi-segment: city is parts[last-1] (e.g. "Springfield" in "Main St, Springfield, IL 62701, USA")
  const candidate = parts[last - 1];
  const m2 = candidate.match(
    /^(.+?)\s+(?:[A-Z]{2}\s+\d{5}(?:-\d{4})?|[A-Z]{1,2}\d)/,
  );
  return m2 ? m2[1].trim() : candidate;
}

async function scrapeQueryResults(
  browser: Browser,
  query: string,
  limit: number,
  onResult?: (place: PlaceResult) => void,
  countryCode: string = "us",
  filteredCategory: string = "",
  keyword: string = "",
): Promise<PlaceResult[]> {
  const page = await browser.newPage();
  try {
    await setupPage(page);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      (window as any).chrome = { runtime: {} };
      (navigator as any).plugins = [1, 2, 3, 4, 5];
      (navigator as any).languages = ["en-US", "en"];
    });

    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.google.com/maps/search/${encodedQuery}/?hl=en&gl=${countryCode}`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await handleConsent(page);
    await new Promise((r) => setTimeout(r, 2000));

    await page
      .waitForSelector('[role="feed"]', { timeout: 10000 })
      .catch(() => null);
    await page.waitForSelector(".Nv2PK", { timeout: 8000 }).catch(() => null);
    await new Promise((r) => setTimeout(r, 800));

    await exhaustivelyScroll(page, limit);

    const cardData = await page.evaluate((maxCards: number) => {
      function parseReviewNum(raw: string): number | null {
        const cleaned = raw.replace(/[()]/g, "").trim();
        const m = cleaned.match(/^([\d.,]+)\s*([kKmM])?$/i);
        if (!m) return null;
        let num = m[1];
        if (/^\d{1,3}(\.\d{3})+$/.test(num)) num = num.replace(/\./g, "");
        else num = num.replace(/,/g, "");
        let n = parseFloat(num);
        if (m[2]?.toLowerCase() === "k") n *= 1000;
        else if (m[2]?.toLowerCase() === "m") n *= 1000000;
        return !isNaN(n) && n > 0 ? Math.round(n) : null;
      }
      function parseReviewFromLabel(label: string): number | null {
        const m = label.match(/([\d.,]+)\s*([kKmM])?\s*reviews?/i);
        if (!m) return null;
        let num = m[1];
        if (/^\d{1,3}(\.\d{3})+$/.test(num)) num = num.replace(/\./g, "");
        else num = num.replace(/,/g, "");
        let n = parseFloat(num);
        if (m[2]?.toLowerCase() === "k") n *= 1000;
        else if (m[2]?.toLowerCase() === "m") n *= 1000000;
        return !isNaN(n) && n > 0 ? Math.round(n) : null;
      }
      const allCards = document.querySelectorAll(".Nv2PK");
      const cards = Array.from(allCards).slice(0, maxCards);
      const results: Array<{
        name: string;
        rating: number | null;
        reviewCount: number | null;
        address: string;
        category: string;
        placeUrl: string;
      }> = [];

      cards.forEach((card) => {
        const el = card as HTMLElement;
        const name =
          (
            el.querySelector(".qBF1Pd") as HTMLElement | null
          )?.textContent?.trim() ||
          (
            el.querySelector(".fontHeadlineSmall") as HTMLElement | null
          )?.textContent?.trim() ||
          "";
        if (!name) return;

        const anchor = card.querySelector("a[href]");
        const href = anchor?.getAttribute("href") || "";
        const placeUrl = href.includes("/maps/")
          ? href.startsWith("http")
            ? href
            : `https://www.google.com${href}`
          : "";

        let rating: number | null = null;
        const ratingEl = el.querySelector(".MW4etd") as HTMLElement | null;
        if (ratingEl) {
          const m = (ratingEl.textContent || "").match(/(\d[.,]\d)/);
          if (m) rating = parseFloat(m[1].replace(",", "."));
        }

        let reviewCount: number | null = null;
        const reviewEl = el.querySelector(".UY7F9d") as HTMLElement | null;
        if (reviewEl) {
          const rc = parseReviewNum(reviewEl.textContent || "");
          if (rc !== null) reviewCount = rc;
        }
        if (reviewCount === null) {
          el.querySelectorAll("[aria-label]").forEach((child) => {
            if (reviewCount !== null) return;
            const lbl = (child as HTMLElement).getAttribute("aria-label") || "";
            const rc = parseReviewFromLabel(lbl);
            if (rc !== null) reviewCount = rc;
          });
        }

        // Try to extract address/category from card secondary text
        let address = "";
        let category = "";
        const bodyLines = el.querySelectorAll(".W4Efsd");
        bodyLines.forEach((line) => {
          const raw = (line as HTMLElement).textContent?.trim() || "";
          if (!raw) return;
          // Each .W4Efsd may contain multiple parts separated by "·"
          const parts = raw
            .split("·")
            .map((p) => p.trim())
            .filter(Boolean);
          for (const txt of parts) {
            if (!txt) continue;
            // Skip pure rating like "4.7"
            if (/^\d[.,]\d$/.test(txt)) continue;
            // Skip open/close status
            if (/^(Closed|Open|Opens|Closes|Open\b|Closed\b)/.test(txt))
              continue;
            // Skip business hours text (e.g. "Sunday, Open 24 hours, Copy open hours")
            if (
              /\bhours?\b/i.test(txt) ||
              /Copy open/i.test(txt) ||
              /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(txt)
            )
              continue;
            // Skip field-label prefixes (e.g. "Phone: +1 518-897-3281")
            if (
              /^(phone|tel|fax|mobile|cell|email|website|url)[\s:]*/i.test(txt)
            )
              continue;
            // Address: has digits, letters, and spaces (excludes phone numbers and bare URLs)
            if (
              !address &&
              /\d/.test(txt) &&
              /[a-zA-Z]/.test(txt) &&
              /\s/.test(txt) &&
              txt.length > 8
            ) {
              // Clean trailing open/closed status
              let clean = txt;
              clean = clean.replace(/([a-z])([A-Z][a-z])/g, "$1 $2");
              clean = clean.replace(/Closed\s*$/i, "").trim();
              clean = clean.replace(/Open\s*$/i, "").trim();
              clean = clean.replace(/(Opens|Closes)\s+\d.+/i, "").trim();
              clean = clean.replace(/,\s*$/, "").trim();
              if (clean.length > 5) address = clean;
              continue;
            }
            // Category: reasonable length text without digits
            if (
              !category &&
              txt.length > 2 &&
              txt.length < 40 &&
              !/\d/.test(txt)
            ) {
              category = txt;
            }
          }
        });
        // Fallback: if no address found, check for any address-like element
        if (!address) {
          const addrEl = el.querySelector(
            "[data-tooltip]",
          ) as HTMLElement | null;
          if (addrEl) {
            const raw = addrEl.getAttribute("data-tooltip") || "";
            const parts = raw
              .split("·")
              .map((p) => p.trim())
              .filter(Boolean);
            for (const txt of parts) {
              if (
                /\d/.test(txt) &&
                /[a-zA-Z]/.test(txt) &&
                /\s/.test(txt) &&
                txt.length > 8
              ) {
                let clean = txt;
                clean = clean.replace(/([a-z])([A-Z][a-z])/g, "$1 $2");
                clean = clean.replace(/Closed\s*$/i, "").trim();
                clean = clean.replace(/Open\s*$/i, "").trim();
                clean = clean.replace(/(Opens|Closes)\s+\d.+/i, "").trim();
                clean = clean.replace(/,\s*$/, "").trim();
                if (clean.length > 5) address = clean;
                break;
              }
            }
          }
        }

        results.push({
          name,
          rating,
          reviewCount,
          address,
          category,
          placeUrl,
        });
      });

      return results;
    }, limit);

    await page.close();

    const results: PlaceResult[] = [];
    for (const card of cardData) {
      const rootDomain = "";
      const city = extractCityFromAddress(card.address);
      const place: PlaceResult = {
        name: card.name,
        address: card.address,
        rating: card.rating,
        reviewCount: card.reviewCount,
        category: card.category,
        phone: "",
        email: "",
        website: "",
        rootDomain,
        coordinates: null,
        placeUrl: card.placeUrl,
        city,
        filteredCategory,
        keyword,
      };
      results.push(place);
      if (onResult) onResult(place);
    }

    return results;
  } catch (err) {
    console.error(
      "[scrapeQueryResults] Error:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  } finally {
    if (!page.isClosed()) await page.close().catch(() => {});
  }
}

export const startScrape = server$(async function (
  query: string,
  maxResults: number = 500,
  countryCode: string = "us",
  filteredCategory: string = "",
  locationFilter: string = "",
  filterByLocation: boolean = true,
): Promise<string> {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session: ScrapeSession = {
    query,
    places: [],
    totalResults: 0,
    status: "running",
    progress: "Starting...",
    error: null,
    _lastSnapshot: "",
  };
  sessions.set(sessionId, session);

  // Enforce concurrency cap
  const activeCount = [...sessions.values()].filter(
    (s) => s.status === "running",
  ).length;
  if (activeCount > MAX_CONCURRENT_SESSIONS) {
    session.status = "error";
    session.error = `Too many active scrapes (${activeCount}). Please wait for one to finish. Max: ${MAX_CONCURRENT_SESSIONS}`;
    session.progress = "Limit reached";
    return sessionId;
  }

  const limit = Math.min(maxResults, 9999);
  const seen = new Set<string>();

  (async () => {
    let browser: Browser | null = null;
    try {
      browser = await getBrowser();
      session.progress = "Navigating to Google Maps...";

      await scrapeQueryResults(
        browser,
        query,
        limit,
        (place) => {
          const key = place.placeUrl || place.name.toLowerCase().trim();
          if (!seen.has(key)) {
            seen.add(key);
            session.places.push(place);
            session.progress = `Extracting... ${session.places.length} leads found`;
          }
        },
        countryCode,
        filteredCategory,
        "",
      );

      session.totalResults = session.places.length;

      // Phase 2: Auto-enrich all results
      const toEnrich = session.places.filter(
        (p) => p.placeUrl && (!p.phone || !p.website),
      );
      session.progress = `Enriching details for ${toEnrich.length} results...`;
      let enrichedCount = 0;
      let skippedCount = 0;
      for (let i = 0; i < session.places.length; i++) {
        if (session.status !== "running" || !sessions.has(sessionId)) break;
        const place = session.places[i];
        if (place.phone && place.website) {
          skippedCount++;
          continue;
        }
        if (!place.placeUrl) {
          skippedCount++;
          continue;
        }
        if (!isValidGoogleMapsUrl(place.placeUrl)) {
          console.warn(
            "[startScrape] Skipping invalid URL:",
            place.placeUrl.substring(0, 80),
          );
          skippedCount++;
          continue;
        }
        try {
          const result = await enrichPlaceDetail(browser, place.placeUrl);
          if (Object.keys(result).length > 0) {
            session.places[i] = { ...place, ...result };
            enrichedCount++;
          } else {
            skippedCount++;
          }
        } catch (err) {
          console.error(
            "[startScrape] Enrichment failed for:",
            place.placeUrl.substring(0, 80),
            err instanceof Error ? err.message : String(err),
          );
          skippedCount++;
        }
        session.progress = `Enriching ${i + 1}/${toEnrich.length} — ${enrichedCount} done, ${skippedCount} skipped`;
        await new Promise((resolve) =>
          setTimeout(resolve, RATE_DELAY.detailPage),
        );
      }

      // Filter by city after enrichment
      if (filterByLocation && locationFilter) {
        const before = session.places.length;
        session.places = session.places.filter((p) => {
          if (!p.address) return true;
          const city = extractCityFromAddress(p.address).toLowerCase();
          return !city || city.includes(locationFilter.toLowerCase());
        });
        console.log(
          `[startScrape] Location filter (${locationFilter}): ${before} → ${session.places.length}`,
        );
      } else if (!filterByLocation) {
        console.log(`[startScrape] Location filter skipped (disabled)`);
      }

      // Dedup by rootDomain after enrichment
      const beforeDomainDedup = session.places.length;
      session.places = dedupByRootDomain(session.places);
      console.log(
        `[startScrape] rootDomain dedup: ${beforeDomainDedup} → ${session.places.length}`,
      );

      // Filter out leads with no website
      const beforeWebsiteFilter = session.places.length;
      session.places = session.places.filter((p) => !!p.website?.trim());
      console.log(
        `[startScrape] website filter: ${beforeWebsiteFilter} → ${session.places.length}`,
      );

      // Hard cap at maxResults
      if (session.places.length > maxResults) {
        session.places = session.places.slice(0, maxResults);
        console.log(`[startScrape] capped to maxResults: ${maxResults}`);
      }

      session.status = "done";
      session.progress = `Done — ${session.places.length} leads extracted`;
    } catch (error: unknown) {
      session.status = "error";
      session.error =
        error instanceof Error ? error.message : "Unknown error occurred";
      session.progress = `Error: ${session.error}`;
      console.error("[startScrape] Error:", session.error);
    }
  })();

  return sessionId;
});

export const startBatchScrape = server$(async function (
  keywords: string[],
  towns: string[],
  stateName: string,
  maxResults: number = 500,
  countryCode: string = "us",
  countrySuffix: string = "",
  filteredCategory: string = "",
  filterByLocation: boolean = true,
): Promise<string> {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const label =
    keywords.length === 1
      ? keywords[0]
      : `${keywords[0]} (+${keywords.length - 1} variations)`;
  const locationDesc = countrySuffix
    ? `${stateName}, ${countrySuffix}`
    : stateName;
  const session: ScrapeSession = {
    query: `${label} across ${towns.length} towns in ${locationDesc}`,
    places: [],
    totalResults: 0,
    status: "running",
    progress: `Starting batch scrape for ${towns.length} towns...`,
    error: null,
    _lastSnapshot: "",
  };
  sessions.set(sessionId, session);

  // Enforce concurrency cap
  const activeCount = [...sessions.values()].filter(
    (s) => s.status === "running",
  ).length;
  if (activeCount > MAX_CONCURRENT_SESSIONS) {
    session.status = "error";
    session.error = `Too many active scrapes (${activeCount}). Please wait for one to finish. Max: ${MAX_CONCURRENT_SESSIONS}`;
    session.progress = "Limit reached";
    return sessionId;
  }

  const CONCURRENCY = 3;
  const perSearchLimit = Math.min(120, Math.max(maxResults, 20));
  const seen = new Set<string>();
  let townsCompleted = 0;

  (async () => {
    try {
      await ensureBrowsers(BROWSERS_COUNT);

      let searchIndex = 0;
      const totalSearches = towns.length * keywords.length;

      for (let i = 0; i < towns.length; i += CONCURRENCY) {
        if (session.status !== "running" || !sessions.has(sessionId)) break;
        if (session.places.length >= maxResults) break;

        const batchTowns = towns.slice(
          i,
          Math.min(i + CONCURRENCY, towns.length),
        );

        const searchPromises: Promise<PlaceResult[]>[] = [];
        for (let ti = 0; ti < batchTowns.length; ti++) {
          const town = batchTowns[ti];
          const townBrowserIdx = ti % browsers.length;
          // Process keywords for this town sequentially with delays
          const townPromise = (async () => {
            const results: PlaceResult[] = [];
            for (let ki = 0; ki < keywords.length; ki++) {
              const kw = keywords[ki];
              const suffix = countrySuffix ? `, ${countrySuffix}` : "";
              const townQuery = `${kw} in ${town}, ${stateName}${suffix}`;
              const br = browsers[townBrowserIdx] || browsers[0];
              const addPlace = (place: PlaceResult) => {
                const key = place.placeUrl || place.name.toLowerCase().trim();
                if (!seen.has(key)) {
                  seen.add(key);
                  session.places.push(place);
                  session.progress = `Searching ${searchIndex}/${totalSearches} — ${session.places.length} leads found...`;
                }
              };
              const r = await scrapeQueryResults(
                br,
                townQuery,
                perSearchLimit,
                (place) => addPlace(place),
                countryCode,
                filteredCategory,
                kw,
              );
              console.log(`[batch] "${kw}" in "${town}" → ${r.length} raw`);
              searchIndex++;
              session.progress = `Searching ${searchIndex}/${totalSearches} — ${session.places.length} leads found...`;
              results.push(...r);
              if (ki < keywords.length - 1) {
                await new Promise((resolve) =>
                  setTimeout(resolve, RATE_DELAY.betweenKeywords),
                );
              }
            }
            return results;
          })();
          searchPromises.push(townPromise);
        }

        await Promise.all(searchPromises);

        townsCompleted += batchTowns.length;
        session.progress = `Scraped ${townsCompleted}/${towns.length} towns — ${session.places.length} unique leads so far...`;

        if (session.places.length >= maxResults) break;

        // Delay between town batches
        if (i + CONCURRENCY < towns.length) {
          await new Promise((resolve) =>
            setTimeout(resolve, RATE_DELAY.betweenTowns),
          );
        }
      }

      session.places = session.places.slice(0, maxResults);

      // Phase 2: Auto-enrich all results
      const toEnrich = session.places.filter(
        (p) => p.placeUrl && (!p.phone || !p.website),
      );
      session.progress = `Enriching details for ${toEnrich.length} results...`;
      let enrichedCount = 0;
      let skippedCount = 0;
      for (let i = 0; i < session.places.length; i++) {
        if (session.status !== "running" || !sessions.has(sessionId)) break;
        const place = session.places[i];
        if (place.phone && place.website) {
          skippedCount++;
          continue;
        }
        if (!place.placeUrl) {
          skippedCount++;
          continue;
        }
        if (!isValidGoogleMapsUrl(place.placeUrl)) {
          console.warn(
            "[startBatchScrape] Skipping invalid URL:",
            place.placeUrl.substring(0, 80),
          );
          skippedCount++;
          continue;
        }
        const br = browsers[i % browsers.length] || browsers[0];
        try {
          const result = await enrichPlaceDetail(br, place.placeUrl);
          if (Object.keys(result).length > 0) {
            session.places[i] = { ...place, ...result };
            enrichedCount++;
          } else {
            skippedCount++;
          }
        } catch (err) {
          console.error(
            "[startBatchScrape] Enrichment failed for:",
            place.placeUrl.substring(0, 80),
            err instanceof Error ? err.message : String(err),
          );
          skippedCount++;
        }
        session.progress = `Enriching ${i + 1}/${toEnrich.length} — ${enrichedCount} done, ${skippedCount} skipped`;
        await new Promise((resolve) =>
          setTimeout(resolve, RATE_DELAY.detailPage),
        );
      }

      // Filter by city after enrichment (single-town searches only)
      if (filterByLocation && towns.length === 1 && towns[0] !== "__ALL__") {
        const targetTown = towns[0].toLowerCase();
        const before = session.places.length;
        session.places = session.places.filter((p) => {
          if (!p.address) return true;
          const city = extractCityFromAddress(p.address).toLowerCase();
          return !city || city.includes(targetTown);
        });
        console.log(
          `[startBatchScrape] Location filter (${towns[0]}): ${before} → ${session.places.length}`,
        );
      } else if (!filterByLocation) {
        console.log(`[startBatchScrape] Location filter skipped (disabled)`);
      }

      // Dedup by rootDomain after enrichment
      const beforeDomainDedup = session.places.length;
      session.places = dedupByRootDomain(session.places);
      console.log(
        `[startBatchScrape] rootDomain dedup: ${beforeDomainDedup} → ${session.places.length}`,
      );

      // Filter out leads with no website
      const beforeWebsiteFilter = session.places.length;
      session.places = session.places.filter((p) => !!p.website?.trim());
      console.log(
        `[startBatchScrape] website filter: ${beforeWebsiteFilter} → ${session.places.length}`,
      );

      session.totalResults = session.places.length;
      session.status = "done";
      session.progress = `Done — ${session.places.length} unique leads from ${townsCompleted} towns`;
    } catch (error: unknown) {
      session.status = "error";
      session.error =
        error instanceof Error ? error.message : "Unknown error occurred";
      session.progress = `Error: ${session.error}`;
      console.error("[startBatchScrape] Error:", session.error);
    } finally {
      await closeAllBrowsers();
    }
  })();

  return sessionId;
});

export const pollScrape = server$(async function (
  sessionId: string,
  since: number = 0,
): Promise<ScrapeResult | null> {
  const session = sessions.get(sessionId);
  if (!session) return null;

  // Fast snapshot: JSON length of places array as a lightweight change detector
  const currentSnapshot = `${session.places.length}:${session.progress}`;

  // If nothing changed since last poll and client passed a since flag, return lightweight
  if (
    since > 0 &&
    currentSnapshot === session._lastSnapshot &&
    session.status !== "error"
  ) {
    return {
      places: [],
      query: session.query,
      totalResults: session.totalResults || session.places.length,
      error: null,
      status: session.status,
      progress: session.progress,
    };
  }

  session._lastSnapshot = currentSnapshot;
  return {
    places: [...session.places],
    query: session.query,
    totalResults: session.totalResults || session.places.length,
    error: session.status === "error" ? session.error : null,
    status: session.status,
    progress: session.progress,
  };
});

export const destroyScrape = server$(async function (
  sessionId: string,
): Promise<void> {
  const session = sessions.get(sessionId);
  if (session) {
    session.status = "error";
    session.error = "Cancelled by user";
    session.progress = "Cancelled";
  }
  sessions.delete(sessionId);
});

export const extractEmailForWebsite = server$(async function (
  websiteUrl: string,
): Promise<string> {
  let browser: Browser | null = null;
  try {
    await ensureBrowsers(1);
    browser = browsers[0];
    if (!browser) browser = await launchBrowser();
    return await extractEmails(browser, websiteUrl);
  } catch {
    return "";
  }
});

export const fetchPlaceDetail = server$(async function (
  sessionId: string,
  placeUrl: string,
): Promise<PlaceResult | null> {
  const session = sessions.get(sessionId);
  if (!session) {
    console.warn("[fetchPlaceDetail] Session not found:", sessionId);
    return null;
  }
  const idx = session.places.findIndex((p) => p.placeUrl === placeUrl);
  if (idx < 0) {
    console.warn(
      "[fetchPlaceDetail] Place URL not found:",
      placeUrl.substring(0, 80),
    );
    return null;
  }

  let browser: Browser | null = null;
  try {
    await ensureBrowsers(1);
    browser = browsers[0];
    if (!browser) browser = await launchBrowser();
    const enriched = await enrichPlaceDetail(browser, placeUrl);
    const keys = Object.keys(enriched).filter(
      (k) => enriched[k as keyof typeof enriched],
    );
    console.log(
      "[fetchPlaceDetail] Enriched fields:",
      keys.join(", ") || "none",
    );
    if (keys.length === 0) return session.places[idx];
    session.places[idx] = { ...session.places[idx], ...enriched };
    return session.places[idx];
  } catch (err) {
    console.error(
      "[fetchPlaceDetail] Error:",
      err instanceof Error ? err.message : String(err),
    );
    return session.places[idx];
  }
});

export const extractPlaceFromUrl = server$(
  async (placeUrl: string): Promise<PlaceResult | null> => {
    await ensureBrowsers(1);
    let browser = browsers[0];
    if (!browser || !browser.connected) browser = await launchBrowser();
    const result = await enrichPlaceDetail(browser, placeUrl);
    const keys = Object.keys(result).filter(
      (k) => result[k as keyof typeof result],
    );
    if (keys.length === 0) return null;
    return {
      name: "",
      address: "",
      rating: null,
      reviewCount: null,
      category: "",
      phone: "",
      email: "",
      website: "",
      rootDomain: "",
      coordinates: null,
      placeUrl,
      city: "",
      filteredCategory: "",
      keyword: "",
      ...result,
    } as PlaceResult;
  },
);

function dedupByRootDomain(places: PlaceResult[]): PlaceResult[] {
  const seenDomains = new Set<string>();
  return places.filter((p) => {
    const domain = p.rootDomain?.toLowerCase().trim();
    if (!domain) return true;
    if (seenDomains.has(domain)) return false;
    seenDomains.add(domain);
    return true;
  });
}

export function exportToCSV(places: PlaceResult[]): string {
  const headers = [
    "Name",
    "Address",
    "City",
    "Rating",
    "Review Count",
    "Category",
    "Filtered Category",
    "Keyword",
    "Phone",
    "Email",
    "Website",
    "Root Domain",
    "Latitude",
    "Longitude",
    "Place URL",
  ];
  const rows = places.map((p) => [
    escapeCSV(p.name),
    escapeCSV(p.address),
    escapeCSV(p.city),
    p.rating?.toString() || "",
    p.reviewCount?.toString() || "",
    escapeCSV(p.category),
    escapeCSV(p.filteredCategory),
    escapeCSV(p.keyword),
    escapeCSV(p.phone),
    escapeCSV(p.email),
    escapeCSV(p.website),
    escapeCSV(p.rootDomain),
    p.coordinates?.lat?.toString() || "",
    p.coordinates?.lng?.toString() || "",
    escapeCSV(p.placeUrl),
  ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n"))
    return `"${value.replace(/"/g, '""')}"`;
  return value;
}

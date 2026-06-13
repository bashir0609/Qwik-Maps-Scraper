# Google Maps Scraper — Full Specification

## 1. Purpose

A web app that scrapes Google Maps for business data (name, address, rating, reviews, category, phone, email, website, coordinates, place URL). Supports multi-country searches with region/town filtering, multi-category selection, batch mode across towns, CSV export, and automatic detail enrichment after card collection.

## 2. Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | Qwik v1.20 + Qwik City |
| Runtime | Node.js >= 22 |
| Scraping | Puppeteer v25 (headless Chromium, 3-browser pool) |
| Email extraction | `fetch` + regex (no browser needed) |
| CSS | Custom CSS dark theme (~1400 lines in `src/global.css`) |
| Bundler | Vite v7 |
| Deployment | Docker (Node 22-slim + Chromium), Railway/Render |
| Linting | ESLint + Qwik plugin |

## 3. Project Structure

```
src/
├── types.ts                     # PlaceResult, ScrapeResult interfaces
├── entry.ssr.tsx                # SSR entry point
├── root.tsx                     # Root layout + Navbar + RouterOutlet
├── global.css                   # All styles (~1400 lines, dark theme)
├── routes/
│   ├── index.tsx               # Main scraper page
│   ├── details/index.tsx       # Single URL extractor
│   └── places-api/index.tsx    # Google Places API alternative
├── components/
│   ├── header/header.tsx        # Hero header
│   ├── navbar/navbar.tsx        # Top nav (Scraper | Places API | URL Extractor)
│   ├── router-head/router-head.tsx
│   ├── search-bar/search-bar.tsx # Country→Region→Town dropdowns, multi-category popover
│   ├── results-table/results-table.tsx # Table view with pagination, copy, fetch
│   └── place-card/place-card.tsx # Card view with copy, fetch, email buttons
├── data/
│   ├── locations.ts             # 4 countries, 93 regions, hundreds of towns
│   └── categories.ts            # 25 business categories with keyword variations
└── utils/
    ├── scrape.ts                # Core scraping engine (~1937 lines)
    └── places-api.ts            # Google Places API integration
server.ts                        # Production entry point
```

## 4. Data Models (`src/types.ts`)

```ts
interface PlaceResult {
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number | null;
  category: string;
  phone: string;
  email: string;
  website: string;
  rootDomain: string;        // TLD-aware extraction (handles co.uk, com.au, etc.)
  coordinates: { lat: number; lng: number } | null;
  placeUrl: string;
  city: string;
  filteredCategory: string;  // User's selected category
  keyword: string;           // The variation that found this result
}

interface ScrapeResult {
  places: PlaceResult[];
  query: string;
  totalResults: number;
  error: string | null;
  status: "running" | "done" | "error";
  progress: string;
}
```

## 5. Core Scraping Engine (`src/utils/scrape.ts`)

### 5.1 Architecture

- **In-memory sessions** (`Map<string, ScrapeSession>`) — 30-min TTL, 60-min orphan cleanup
- **Browser pool** (`Browser[]`, 3 instances, round-robin with health checks)
- **Temp dir tracking** — `browserTempDirs[]` cleaned on shutdown
- **Concurrency cap** — `MAX_CONCURRENT_SESSIONS = 5`
- **Lightweight polling** — snapshot-based change detection to skip unchanged data
- **Server$ functions** — Qwik's server-only execution boundary
- **Graceful shutdown** — SIGINT/exit handlers close browsers + clean temp dirs

### 5.2 Browser Configuration

```ts
puppeteer.launch({
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,  // Docker: /usr/bin/chromium
  protocolTimeout: 120000,
  userDataDir: `/tmp/puppeteer-{timestamp}-{random}`,    // Tracked & cleaned on exit
  args: [
    "--no-sandbox", "--disable-setuid-sandbox",
    "--disable-dev-shm-usage", "--disable-gpu",
    "--window-size=1920,1080", "--lang=en-US,en",
    "--disable-blink-features=AutomationControlled",
    "--incognito", "--disable-third-party-cookies",
    "--disk-cache-size=0",
  ],
});
```

### 5.3 Page Setup (`setupPage`)

- Viewport: 1920×1080, Chrome 126 UA
- Blocks: google-analytics, googletagmanager, doubleclick, facebook/tr, intercom, mixpanel, hotjar
- When `blockStyles=true`: also blocks stylesheets, fonts, non-Google images
- Request interception: `request.abort()` for blocked, `request.continue()` for allowed

### 5.4 Two-Phase Scraping

#### Phase 1 — Card Collection (`scrapeQueryResults`)

1. Navigate to `google.com/maps/search/{query}?hl=en&gl={code}`
2. Handle consent popup (6 selectors, including frame traversal)
3. Wait for `[role="feed"]` and `.Nv2PK` selectors
4. Scroll: `feed.scrollBy({ top: 3000, behavior: "smooth" })` + 1500ms wait
5. Stop condition: "You've reached the end of the list" in body text, or 10 stale rounds
6. Extract per-card: name (`.qBF1Pd`/`.fontHeadlineSmall`), rating (`.MW4etd`), reviews (`.UY7F9d`), address/category (`.W4Efsd` split by `·`), place URL
7. `perSearchLimit = Math.min(120, Math.max(maxResults, 20))`

#### Phase 2 — Auto Enrichment (`enrichPlaceDetail` → `scrapeDetailPage`)

1. Opens new page, applies stealth patches (webdriver, chrome.runtime, plugins, languages)
2. Navigate: `waitUntil: "domcontentloaded"`, 45s timeout
3. Handle consent, wait for h1 (8s timeout), 1s wait
4. Extract via `page.evaluate`:
   - **Name**: `h1.DUwDvf` or `h1`
   - **Category**: `button[jsaction*="pancat"]` → badge → parent siblings → `.Io6YTe`
   - **Rating/Reviews**: aria-label regex, `.MW4etd`, `.UY7F9d`
   - **Address**: `.Io6YTe`, aria-label patterns, data-tooltip
   - **Phone**: `a[href^="tel:"]`, `.Io6YTe`, data-tooltip, aria-label
   - **Website**: `a[href]` with website label, excluding third-party (opentable, yelp, tripadvisor, booking.com, etc.)
   - **Website cleaning**: strip www, remove utm_*/ref params, remove menu/booking paths
   - **Coordinates**: from URL `@(-?\d+\.\d+),(-?\d+\.\d+)`
5. **2 retries** with error logging, 45s timeout
6. Returns null on all failures

### 5.5 Email Extraction (`extractEmails`) — **fetch + regex, no browser**

1. `fetch(url, { signal: AbortController, timeout: 10s })` with custom User-Agent
2. Regex `EMAIL_REGEX` on full HTML response text
3. Extract `mailto:` links from HTML
4. Deobfuscate: `[at]→@`, `(at)→@`, `[dot]→.`, `(dot)→.`
5. **Junk filtering**:
   - SKIP_LOCALS: noreply, webmaster, admin, bootstrap, filler, placeholder, email, etc.
   - SKIP_DOMAINS: sentry.io, wixpress.com, godaddy.com, wix.com, squarespace.com, etc.
   - Version-like domains: reject `/^\d+(\.\d+)+$/` (e.g., `bootstrap@5.1.0`)
   - No valid TLD: reject domains without `.[a-zA-Z]{2,}` suffix
6. One retry if nothing found (500ms gap)
7. Sort by: domain match priority → business prefix (info, contact, sales, etc.) → alphabetical
8. Return top 3 emails, comma-separated

### 5.6 Post-Enrichment Pipeline

After all results enriched, applied sequentially:
1. **City filter** — keep only results matching selected town (if enabled)
2. **Root domain dedup** — keep first result per `rootDomain`
3. **Website filter** — remove results without a website
4. **Cap** — trim to `maxResults`

### 5.7 Server$ Functions

| Function | Signature | Notes |
|----------|-----------|-------|
| `startScrape` | `(query, maxResults, countryCode, filteredCategory, locationFilter, filterByLocation)` → sessionId | Single search + auto-enrich |
| `startBatchScrape` | `(keywords[], towns[], stateName, maxResults, countryCode, countrySuffix, filteredCategory, filterByLocation)` → sessionId | 3 towns concurrent, round-robin browsers |
| `pollScrape` | `(sessionId, since=0)` → ScrapeResult | `since>0` enables lightweight polling (empty places when unchanged) |
| `destroyScrape` | `(sessionId)` → void | Cancels running session |
| `fetchPlaceDetail` | `(sessionId, placeUrl)` → PlaceResult | On-demand detail extraction |
| `extractEmailForWebsite` | `(websiteUrl)` → string | Simple fetch+regex, no browser |
| `extractPlaceFromUrl` | `(placeUrl)` → PlaceResult | Single URL extraction (for /details route) |

### 5.8 Constants

```ts
BROWSERS_COUNT = 3
MAX_CONCURRENT_SESSIONS = 5
CONCURRENCY (batch towns per loop) = 3
perSearchLimit = Math.min(120, Math.max(maxResults, 20))
SESSION_TTL = 30 minutes (cleanup every 60s)
ORPHANED_SESSION_MAX_AGE = 60 minutes
RATE_DELAY = {
  betweenKeywords: 1000,  // 1s between keyword searches
  betweenTowns: 2000,     // 2s between town batches
  detailPage: 500,        // 500ms before detail page enrichment
}
```

## 6. Location & Category Data

### 6.1 Locations (`src/data/locations.ts`)

4 countries with regions and towns:
- **United States**: 40 states, each with priority flag and town list
- **United Kingdom**: 33 regions
- **Australia**: 8 states
- **Saudi Arabia**: 12 provinces

Region interface: `{ name, abbr, priority, towns[] }`

### 6.2 Categories (`src/data/categories.ts`)

25 business categories, each with 3-8 keyword variations:
- Restaurants & Cafes, Salons & Barbershops, Pharmacies, Supermarkets, Clinics, Car Services, Gyms, Laundry, Real Estate, Banks, Opticals, Flower Shops, Tailoring, Home Services, Furniture, Event Halls, Travel Agencies, IT Services, Education, Pet Shops, Tattoo Studios, Book Shops, Art Supply, Gift Stores, Museums

## 7. UI Components

### 7.1 SearchBar
- Country → Region (priority-sorted) → Town dropdowns
- "All towns" option triggers batch mode
- Multi-category popover with checkboxes, chip display for selected
- Max results input, city filter toggle
- Keywords auto-populated from selected categories

### 7.2 ResultsTable
- 15 columns with copy-to-clipboard on every cell
- Pagination: 50 per page, smart ellipsis for >7 pages
- Inline "Fetch Details" and "Fetch Email" buttons
- Email column shows `mailto:` links when found

### 7.3 PlaceCard
- Card layout with rating stars, category badge, keyword label
- Copy buttons on every field
- Fetch Details / Fetch Email buttons where applicable
- Coordinates display

### 7.4 Main Page (`index.tsx`)
- State: `results`, `isLoading`, `viewMode`, `progressMsg`, `sessionIdRef`, `extractedEmails`, `loadingEmails`, `fetchDetailLoading`
- 2-second polling loop with lightweight snapshot optimization
- Event delegation for Fetch Details / Fetch Email clicks
- CSV export with formatted filename: `{date} - {category} - {town} - {region}.csv`

## 8. CSV Export

15 columns: Name, Address, City, Rating, Review Count, Category, Filtered Category, Keyword, Phone, Email, Website, Root Domain, Latitude, Longitude, Place URL

Proper CSV escaping: double-quote fields containing commas, quotes, or newlines; double internal quotes.

## 9. Deployment

### Docker
```dockerfile
FROM node:22-slim
RUN apt-get install chromium + international fonts
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

### Environment Variables
| Variable | Purpose | Default |
|----------|---------|---------|
| `PUPPETEER_SKIP_DOWNLOAD` | Skip Chromium download | `true` |
| `PUPPETEER_EXECUTABLE_PATH` | System Chromium path | `/usr/bin/chromium` |
| `PORT` | Server port | `8080` |
| `HOST` | Server host | `0.0.0.0` |
| `GOOGLE_API_KEY` | Places API key (optional) | — |

### Production
```bash
npm run build && npm run build.server && npm start
```

### Development
```bash
# Windows
set PUPPETEER_SKIP_DOWNLOAD=true && set PUPPETEER_EXECUTABLE_PATH=C:\...\chrome.exe && npm run dev

# Linux/macOS
npm run dev
```

## 10. Key Design Decisions

### Why fetch+regex for emails (not Puppeteer)
- 3-5x faster (1-2s vs 3-5s per site)
- No browser resource consumption
- Same accuracy for homepage email extraction
- AbortController provides timeout safety

### Why in-memory sessions (not a job queue)
- Simplicity — no Redis/DB dependency
- Session TTL + orphan cleanup handles leaks
- Suitable for single-instance Railway/Render deployment
- Sessions survive as long as the Node process

### Why snapshot-based polling
- `_lastSnapshot = "${places.length}:${progress}"` 
- When unchanged between polls, return lightweight response (empty places)
- Client preserves existing results, only updates status/progress
- Reduces JSON serialization overhead by ~90% during enrichment

## 11. Known Issues

- **Google rate limiting**: Extended scraping may trigger CAPTCHAs. Use conservative delays.
- **In-memory state**: Server restart loses in-progress sessions.
- **CSS monolithic**: All styles in single file — no scoping. Migrate to CSS modules for scale.
- **`server.ts` not in tsconfig**: Compiled by Vite SSR build, not tsc. Keep it out of `include`.
- **Duplicate domains during enrichment**: Expected — cleaned by `dedupByRootDomain()` post-enrichment.

# Google Maps Scraper — Full Specification for Recreation
Project dir:
"C:\Users\Islah4\Desktop\Apps\Qwik"

## 1. Purpose

A web app that scrapes Google Maps for business data (name, address, rating, reviews, category, phone, email, website, coordinates, place URL). Supports multi-country searches with region/town filtering, multi-category selection, batch mode across towns, CSV export, and automatic detail enrichment after card collection.

## 2. Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | Qwik v1.20 + Qwik City |
| Runtime | Node.js >= 22 |
| Scraping | Puppeteer v25 (headless Chromium) |
| CSS | Custom CSS (dark theme, ~1150 lines in `src/global.css`) |
| Bundler | Vite v7 |
| Deployment | Docker (Node 22-slim + Chromium), Railway/Render |
| Linting | ESLint + Qwik plugin |

## 3. Project Structure

```
src/
├── types.ts                    # PlaceResult, ScrapeResult interfaces
├── entry.ssr.tsx               # SSR entry point
├── root.tsx                    # Root layout
├── global.css                  # All styles (~1150 lines)
├── routes/
│   └── index.tsx              # Main page (all state, handlers, layout)
├── components/
│   ├── header/header.tsx       # Page header
│   ├── router-head/            # HTML head meta
│   ├── search-bar/search-bar.tsx # Search form with filters
│   ├── results-table/results-table.tsx # Table view
│   └── place-card/place-card.tsx # Card view
├── data/
│   ├── locations.ts            # 4 countries, regions, towns
│   └── categories.ts           # 25 business categories with keywords
└── utils/
    └── scrape.ts               # Core scraping engine (~880 lines)
```

## 4. Data Models (`src/types.ts`)

```ts
interface PlaceResult {
  name: string;              // Business name
  address: string;           // Full address
  rating: number | null;     // 1-5 rating
  reviewCount: number | null;// Number of reviews
  category: string;          // Google Maps category (scraped)
  phone: string;             // Phone number
  email: string;             // Email (homepage-only extraction)
  website: string;           // Business website URL
  rootDomain: string;        // Extracted root domain
  coordinates: { lat: number; lng: number } | null;
  placeUrl: string;          // Full Google Maps URL
  city: string;              // City extracted from address
  filteredCategory: string;  // User-selected category label
  keyword: string;           // The keyword variation that found this result
}

interface ScrapeResult {
  places: PlaceResult[];
  query: string;             // Search query string
  totalResults: number;
  error: string | null;
  status: "running" | "done" | "error";
  progress: string;          // Human-readable progress message
}
```

## 5. Core Scraping Engine (`src/utils/scrape.ts`)

### 5.1 Architecture
- **In-memory sessions** (`Map<string, ScrapeSession>`) — 30-minute TTL auto-cleanup
- **Browser pool** (`Browser[]`) — shared across searches
- **Server$ functions** — Qwik's server-only execution boundary

### 5.2 Browser Configuration

```ts
puppeteer.launch({
  headless: true,
  protocolTimeout: 120000,
  userDataDir: `/tmp/puppeteer-{timestamp}-{random}`,
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
```

### 5.3 Page Setup

```ts
setupPage(page, blockStyles = true):
  - Viewport: 1920x1080
  - User-Agent: Chrome 126 on Windows
  - Block ads/trackers (google-analytics, googletagmanager, doubleclick, facebook/tr)
  - When blockStyles: also blocks stylesheet, font, and non-Google image resources (`!url.includes("google") && !url.includes("gstatic")`)
  - ⚠️ /analytics/i pattern is too broad — blocks legitimate business URLs
```

### 5.4 Scraping Functions

#### `scrapeQueryResults()` — PHASE 1: Card-Only Collection (~10s)
1. Navigate to `https://www.google.com/maps/search/{query}/?hl=en&gl={code}`
2. Handle consent popup (Accept all button)
3. Wait for `[role="feed"]` and `.Nv2PK` selectors
4. Scroll feed via `exhaustivelyScroll()` — `scrollBy(3000px)` + 1500ms wait, stops on `"You've reached the end of the list"` text in body, stale-card-count fallback at 10 rounds
5. Extract per-card data via `page.evaluate`:
   - Name: `.qBF1Pd` or `.fontHeadlineSmall`
   - Rating: `.MW4etd` regex `(\d[.,]\d)`
   - Reviews: `.UY7F9d` regex `[(]([\d.,]+)[)]`
   - Place URL: `a[href]` → if absolute (`startsWith("http")`) use as-is, else `https://www.google.com{href}`
   - Address: from `.W4Efsd` elements, split by `·`, filter:
     - Pure rating text (`/^\d[.,]\d$/`)
     - Status text (`/^(Closed|Open|Opens|Closes)/`)
     - Has digits + longer than 8 chars → address
     - Clean: camelCase split `([a-z])([A-Z][a-z])` → `$1 $2`, strip Closed/Open, strip `Opens|Closes \d.+`
   - Category: from same elements, 3-40 chars, no digits
6. Returns PlaceResult[] with whatever card data was found, NO detail page visits
7. `perSearchLimit = Math.min(30, Math.max(maxResults, 20))`

#### `scrapeDetailPage(browser, href, retries=1, timeoutMs=30000)` — Detail Page Extraction
1. Opens new page, applies stealth patches:
   - `Object.defineProperty(navigator, "webdriver", { get: () => false })`
   - `window.chrome = { runtime: {} }`
   - `navigator.plugins = [1, 2, 3, 4, 5]`
   - `navigator.languages = ["en-US", "en"]`
2. Navigate to place URL (`waitUntil: "domcontentloaded"`, configurable timeout)
3. Handle consent popup on detail page
4. Wait for h1 (8s timeout)
5. 1s post-nav wait
6. Extract via `page.evaluate`:
   - Name: `h1.DUwDvf` or `h1`
   - Category: `button[jsaction*="pancat"]`, then badge, then parent siblings, then `.Io6YTe` neighbor
   - Rating: `aria-label` regex, `.MW4etd` text
   - Reviews: `aria-label` regex, `.UY7F9d` text
   - Address: `.Io6YTe` elements, `aria-label` patterns, `data-tooltip` attributes
   - Phone: `a[href^="tel:"]`, `.Io6YTe`, `data-tooltip`, `aria-label`
   - Website: `a[href]` with website aria-label or domain text, excluding third-party hosts (opentable, yelp, tripadvisor, etc.)
   - Website cleaning: strip `www.`, remove tracking params (utm_*, ref), remove menu/booking paths
   - Coordinates: from URL `@(-?\d+\.\d+),(-?\d+\.\d+)` pattern
7. Retry logic: up to `retries` attempts, with error logging
8. Returns null on all failures

#### `enrichPlaceDetail(browser, placeUrl)` — PHASE 2: On-Demand
- Calls `scrapeDetailPage(browser, placeUrl, 2, 45000)` — 2 retries, 45s timeout
- Extracts website, rootDomain (via `extractRootDomain`), city (via `extractCityFromAddress`)
- Calls `extractEmails(browser, website)` if website found
- Returns `Partial<PlaceResult>`

#### `extractEmails(browser, websiteUrl)` — Homepage Only
1. Opens new page with `setupPage(page, false)` — CSS NOT blocked
2. Navigation: `waitUntil: "networkidle2"`, timeout: 15000ms
3. Post-nav wait: 2000ms
4. `page.evaluate`: regex on `body.innerText` + collect `a[href^="mailto:"]` links
5. Deobfuscate: `[at]`→`@`, `(at)`→`@`, `[dot]`→`.`, `(dot)`→`.`
6. Fallback: if evaluate returns nothing, scan `page.content()` raw HTML with same regex
7. Filter out: noreply, webmaster, no-reply, mailer-daemon, postmaster, abuse, admin
8. Retry homepage once if empty (no contact pages visited)
9. Sort: by domain match → priority prefix (info, hello, contact, book, reserv, appoint, inquir, support, sales, admin, office) → alphabetical
10. Return top 3 emails, comma-separated

#### `extractRootDomain(urlStr)` — TLD-aware root domain extraction
Custom multi-part TLD detection (co.uk, com.au, org.uk, etc.)

#### `extractCityFromAddress(address)`
1. Split by comma, trim, filter empty
2. Remove trailing country from known set (usa, uk, australia, saudi arabia, canada)
3. Take `parts[last-1]` as candidate
4. Strip state abbreviation + ZIP pattern: `^(.+?)\s+(?:[A-Z]{2}\s+\d{5}|[A-Z]{1,2}\d)`
5. Return cleaned city name

#### ~~matchesLocation~~ — Removed
Location filtering is handled by Google's search query. Card addresses don't contain city names, so the function was dropping 95% of valid results. Replaced by `placeUrl` deduplication.

### 5.5 Server$ Functions

#### `startScrape(query, maxResults=500, countryCode="us", locationFilter="", filteredCategory="")` → sessionId
- Creates session
- Gets browser via `getBrowser()`
- Calls `scrapeQueryResults()` once
- **Phase 2 auto-enrichment**: visits each result's detail page sequentially (1 at a time, 500ms gap). Skips results with phone+website already present. Progress: `"Enriching 47/243 — 45 done"`.
- Browser NOT closed after completion (survives for enrichment)
- Deduplication: `seen` Set, key = `placeUrl || name.toLowerCase()`

#### `startBatchScrape(keywords[], towns[], stateName, maxResults, countryCode, countrySuffix, filteredCategory)` → sessionId
- Creates session
- `ensureBrowsers(3)` — creates 3 browsers
- CONCURRENCY = 3 towns per batch
- For each town × keyword: calls `scrapeQueryResults()` with round-robin browser
- Deduplication: `seen` Set, key = `placeUrl || name.toLowerCase()`
- **Phase 2 auto-enrichment**: all results enriched sequentially (1 at a time, round-robin browsers, 500ms gap). Skips already-enriched results.
- `closeAllBrowsers()` in finally block
- Per-keyword logging: `console.log("[batch] \"{kw}\" in \"{town}\" → {n} raw")`

#### `pollScrape(sessionId)` → ScrapeResult | null
Returns session snapshot: `{ places: [...], query, totalResults, error, status, progress }`

#### `destroyScrape(sessionId)`
Deletes session from Map

#### `fetchPlaceDetail(sessionId, placeUrl)` → PlaceResult | null
- Finds session, finds place by placeUrl
- `ensureBrowsers(1)` — ensures browser exists
- Calls `enrichPlaceDetail(browser, placeUrl)`
- Merges enriched data into `session.places[idx]`
- Error logging for session-not-found, place-not-found, enrichment failures

#### `extractEmailForWebsite(websiteUrl)` → string
- `ensureBrowsers(1)` + `extractEmails(browser, websiteUrl)`

#### `exportToCSV(places[])` → string
14 columns: Name, Address, City, Rating, Review Count, Category, Filtered Category, Keyword, Phone, Email, Website, Root Domain, Latitude, Longitude, Place URL. CSV escape with double-quotes for commas/quotes/newlines.

### 5.6 Constants
```ts
BROWSERS_COUNT = 3
CONCURRENCY (batch towns per loop) = 3
perSearchLimit = Math.min(30, Math.max(maxResults, 20))
SESSION_TTL = 30 minutes (time-based cleanup interval runs every 60s)
RATE_DELAY = {
  betweenKeywords: 1000,  // 1s between keyword searches in same town
  betweenTowns: 2000,     // 2s between town batches
  detailPage: 500,        // 500ms before detail page enrichment
  emailPage: 500,         // 500ms before email extraction page load
}
```

---

## 6. Location & Category Data

### 6.1 Locations (`src/data/locations.ts`)

Interface:
```ts
interface RegionLocation { name: string; abbr: string; priority: number; towns: string[]; }
interface CountryLocation { name: string; code: string; suffix: string; regions: RegionLocation[]; }
```

Countries:
- **US** (`code: "us"`): 40 states, each with 5-100+ towns
- **UK** (`code: "uk"`, `suffix: "UK"`): 33 regions (London, Greater Manchester, Scotland, Wales, Northern Ireland, etc.)
- **Australia** (`code: "au"`, `suffix: "Australia"`): 8 states/territories
- **Saudi Arabia** (`code: "sa"`, `suffix: "Saudi Arabia"`): 12 provinces

Functions:
- `getAllRegions(countryCode)` → priority regions first (sorted by priority), then alphabetical
- `getCountry(countryCode)` → full country object or undefined

### 6.2 Categories (`src/data/categories.ts`)

Interface:
```ts
interface CategoryKeywords { label: string; keywords: string[]; }
```

25 categories with 2-9 keywords each. Example entry:
```ts
{ label: "Restaurants & Cafes", keywords: ["restaurant", "cafe", "coffee shop", "dining", "fast food"] }
```

## 7. UI Components

### 7.1 SearchBar (`src/components/search-bar/search-bar.tsx`)

**Layout:**
```
🔍 [keywords input] [US ▼] [Category] [Region ▼] [Town ▼] Max:[999] [Scrape]
Tip: Select a country, pick a category & region, then scrape.
```

**Signals:**
- `query`, `maxResults: 999`, `selectedCountry: "us"`, `selectedRegion: ""`, `selectedTown: ""`
- `selectedCategories: string[]` — multi-category array
- `popoverOpen: boolean` — category popover toggle
- `regionOptions` — initialized with `getAllRegions("us")` (NOT empty, to show on load)
- `townOptions`

**Category Chips UI:**
- 0 selected: `[+ Category]` trigger button
- 1 selected: `[Restaurants ✕]` with individual remove
- 2+ selected: `[Restaurants +2]` showing first + count, click opens popover, ✕ clears all
- Popover: absolute-positioned panel with backdrop, checkboxes for all 25 categories, scrollable max 280px

**Keyword Sync:**
`useTask$` tracks `selectedCategories` and auto-populates query input with all keywords joined by " / "

**Search Modes (handleSubmit):**
1. **All towns batch**: `{category} across {n} towns in {region}` — all keywords × all towns
2. **Single town + keywords**: `{category} in {town}, {region}` — batch with 1 town
3. **Free text**: passes query directly

**SearchParams passed to parent:**
```ts
interface SearchParams {
  query, maxResults, isBatch?, allKeywords?, towns?, stateName?,
  countryCode?, countrySuffix?, locationFilter?, filteredCategory?,
  regionName?, regionAbbr?
}
```

### 7.2 ResultsTable (`src/components/results-table/results-table.tsx`)

**Columns (15):**
`# | Name | [Details] | Category | Keyword | City | Filtered Category | Rating | Reviews | Address | Phone | Email | Website | Root Domain | Source`

**Features:**
- Pagination: 50 rows/page, prev/next + page numbers with ellipsis
- Copy buttons on: Name, Category, Keyword, City, Filtered Category, Address, Phone, Email, Website
- Bootstrap copy SVG icon, green flash on copy (1200ms)
- Fetch Details button: appears when `placeUrl && (!phone || !website)`. Uses `data-fetch-detail` attribute
- Fetch Email button: appears when website exists but no email. Uses `data-fetch-email` attribute
- Loading spinners for both fetch operations
- Email: mailto link when available
- Website: trimmed to 30 chars

### 7.3 PlaceCard (`src/components/place-card/place-card.tsx`)

**Fields displayed:**
- Name (h3 + copy button)
- Rating (stars + numeric + review count)
- Fetch Details button (data-fetch-detail, when phone/website missing)
- Category badge (accent color)
- City (map pin icon)
- Filtered Category (tag icon)
- Keyword badge (green)
- Address (location icon)
- Phone (phone icon)
- Email section: mailto link + copy / Fetch Email button / spinner
- Website (link icon, clickable)
- Coordinates (lat/lng display)
- View on Maps link

### 7.4 Main Page (`src/routes/index.tsx`)

**Signals:**
- `results: ScrapeResult | null`
- `isLoading`, `viewMode: "cards" | "table"`, `progressMsg`
- `sessionIdRef: string` — preserved for enrichment
- `extractedEmails: Record<string,string>` — email cache
- `loadingEmails: Record<string,boolean>` — per-URL loading state
- `lastCategory`, `lastTown`, `lastRegionName`, `lastRegionAbbr` — CSV filename parts
- `fetchDetailLoading: Record<string,boolean>` — per-URL detail loading state

**Handlers:**
- `pollForResults(sid)` — 2s interval, stops on done/error (session NOT destroyed)
- `handleSearch(params)` → `startScrape()` or `startBatchScrape()`
- `handleExportCSV()` → merges emails, filename: `{date} - {cat} - {town} - {region} [abbr].csv`
- `handleClearResults()` → resets all state + emails
- `handleCancel()` → `destroyScrape(sid)` + stops loading

**CRITICAL: Global Click Delegates (useOnDocument):**
```ts
useOnDocument('click', $(async (event) => {
  // [data-fetch-detail] → calls fetchPlaceDetail() inline
  // [data-fetch-email]  → calls extractEmailForWebsite() inline
  // Both with try/catch/finally for loading state management
}));
```
Buttons use `data-fetch-detail={placeUrl}` and `data-fetch-email={websiteUrl}` attributes.
QRL `onClick$` was abandoned because QRL-calling-QRL fails silently.

**Layout Sections:**
- Welcome state (icon + description + feature chips)
- Loading state (spinner)
- Error banner (red)
- Progress banner (purple, spinner + message + cancel button)
- Results section (header with count/query + view toggle + export + clear + results)
- Footer

---

## 8. CSV Export

**Filename:** `{YYYY-MM-DD} - {Category} - {Town} - {Region} [{Abbr}].csv`
Example: `2025-05-25 - Restaurants & Cafes - Albany - New York [NY].csv`

**Columns (14):** Name, Address, City, Rating, Review Count, Category, Filtered Category, Keyword, Phone, Email, Website, Root Domain, Latitude, Longitude, Place URL

Email column merges `extractedEmails[website]` if scraped email is empty.

---

## 9. Styling System

**Dark theme CSS variables:**
```css
--bg-primary: #0f0f23; --bg-secondary: #1a1a3e; --bg-card: #1e1e42; --bg-input: #161638;
--text-primary: #e8e8f0; --text-secondary: #a0a0c0; --text-muted: #6a6a8e;
--accent: #6c63ff; --accent-hover: #7d75ff; --success: #4caf50; --error: #ff5252;
--border: rgba(108, 99, 255, 0.2); --radius: 12px; --radius-sm: 8px;
```

**Key classes:**
- `.search-input-wrapper` — flex row, dark bg, `overflow: visible`
- `.location-select-group` — flex row, `gap: 0`
- `.category-chips-row` — flex wrap, relative position (for popover)
- `.category-chip` — accent-bordered tag
- `.category-popover` — absolute dropdown, `z-index: 100`, `max-height: 280px`, scrollable
- `.popover-backdrop` — fixed fullscreen, `z-index: 99`
- `.results-table` — full-width dark table
- `.copy-btn` — inline 24x24 transparent icon, 35% opacity, accent hover, green `.copied`
- `.fetch-email-btn` — accent-border button
- `.email-spinner` — 14px border spinner
- `.cancel-btn` — red-border button, right-aligned
- `.fetch-email-btn` — shared button class for both Fetch Details and Fetch Email

---

## 10. Deployment

### Dockerfile
```dockerfile
FROM node:22-slim
# Install Chromium + fonts (Arabic, CJK, Noto)
ENV PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY package*.json ./ → npm install → COPY . → npm run build && npm run build.server → npm prune --omit=dev
EXPOSE 8080
CMD ["node", "server/server.js"]
```

### Server (`server.ts`)
```ts
import { createQwikCity } from "@builder.io/qwik-city/middleware/node";
createServer(createQwikCity({ render, qwikCityPlan })).listen(PORT);
```

### Railway Config
```toml
[build] builder = "DOCKERFILE"
[deploy] healthcheckPath = "/", healthcheckTimeout = 300, restartPolicyType = "ON_FAILURE"
```

---

## 11. Qwik QRL Serialization — THE CRITICAL ISSUE

**Qwik's `$()` functions (QRLs) cannot call other `$()` functions.** This is by design — QRLs are lazily loaded and serialized independently.

### What Works
```tsx
onClick$={() => signal.value = newValue}          // Direct signal mutation
$(() => { regularFunction(signal.value) })         // $() calling regular function
useOnDocument('click', $(() => { ... }))            // Global event delegate
```

### What Silently Fails (No Error)
```tsx
useTask$(() => { another$fn() })                   // "function not defined" at runtime
onClick$={() => another$fn(value)}                 // Button does nothing
useOnDocument('click', $(() => { $fn(url) }))      // Handler silently dropped
```

### The Fix Used Here
- All buttons use `data-*` attributes (`data-fetch-detail`, `data-fetch-email`)
- A single `useOnDocument('click', $(async (event) => {...}))` handler catches all clicks
- The handler logic is INLINED directly (no calling other `$()` functions)
- This bypasses the entire QRL-calling-QRL problem

---

## 12. Known Issues & Lessons for Recreation

### Critical Design Flaws
1. **QRL serialization breaks button handlers** — Any framework that doesn't have QRL-like serialization boundaries (React, Vue, Svelte, vanilla JS) would avoid this entire class of bugs.
2. **`/analytics/i` block pattern** — Too broad. Matches legitimate business URLs. Use specific host blocking only.
3. **In-memory sessions** — Lost on server restart. No persistence.

### Resolved Issues (Solutions to Preserve)
1. **Region dropdown empty on load** → Initialize signal with default data, not empty array
2. **Email extraction failing** → Use `networkidle2`, longer timeout, CSS enabled, raw HTML fallback
3. **Dedup by name drops chain locations** → Dedup on `placeUrl` (unique per physical location)
4. **Session destroyed before enrichment** → Don't destroy session on scrape completion, let TTL handle cleanup
5. **Card data extraction messy** → Split text on `·` separator, filter by pattern
6. **Address status appended** → CamelCase split + status word stripping
7. **Browser unresponsive** → Health check via `browser.version()`, auto-replace dead browsers
8. **Double URL prefix on placeUrl** → Card `href` may be absolute (`https://www.google.com/maps/place/...`). Unconditionally prepending `https://www.google.com` creates `https://www.google.comhttps://www.google.com/...`. Fix: check `href.startsWith("http")` before prepending. This was silently breaking Fetch Details (ERR_NAME_NOT_RESOLVED on detail page enrichment).
9. **Fetch Details/Email QRL deadlock** → QRL-calling-QRL fails silently. Fix: `useOnDocument` + `data-*` attributes with inlined logic. Abandon per-element `onClick$`.
10. **Scroll used artificial iteration caps** → Fixed iteration budgets caused either too-short scrolls (miss results) or too-deep (DOM recycles). Fix: `exhaustivelyScroll()` uses `while(true)` checking `body.innerText` for `"You've reached the end of the list"`. Stale-card-count fallback at 10 rounds. No max iterations, no math formula. Google tells us when it's done. Scroll delay increased from 600ms to 1500ms for human-like pacing.
11. **Rate limiting** → Concurrent keyword searches without delays trigger bot detection. Fix: sequential keywords per town with 1s gap, 2s between town batches, 500ms before detail enrichment, 500ms before email extraction. Configurable via `RATE_DELAY` constants.
12. **Images blocked at browser level** → `--blink-settings=imagesEnabled=false` blocked images on ALL pages including Google Maps search. Made the search page look bot-like during scrolling. Fix: removed browser-level flag entirely. `setupPage` request interception only blocks non-Google images (`!url.includes("google") && !url.includes("gstatic")`), so map tiles, thumbnails, and business photos load normally. Email extraction uses `setupPage(page, false)` — no image blocking at all.
13. **Phase 1 location filter dropped 95% of results** → Google Maps search cards don't contain city names in address snippets. `matchesLocation(place.address, "Albany")` fails for cards showing "652 Albany Shaker Rd" without "Albany, NY" in the snippet. Fix: removed `matchesLocation` function entirely. Removed `locationFilter` parameter from `startScrape`. The Google search query `"restaurant in Albany, New York"` already geo-filters results.
14. **Scroll delay was too fast** → 600ms between scrolls looked bot-like with multiple concurrent searches. Fix: increased to 1500ms. Combined with end-of-list detection, Google images loading, and rate-limited keyword sequencing, the crawl is now much harder to detect.
15. **Phase 2 detail enrichment was manual** → User had to click Fetch Details on every result. Fix: auto-enrichment loop runs after Phase 1 completes. All results are processed sequentially (1 at a time, 500ms gap). Progress shown as `"Enriching 47/243 — 45 done"`. Skips results that already have phone AND website. Cancel-safe (checks `session.status`).

### Recommended Architecture for Recreation
1. **Don't use Qwik** — Use React, Vue, Svelte, or any framework without serialization boundaries
2. **Server-sent events (SSE)** for real-time progress instead of polling
3. **Separate browser context per operation** — Don't share browser pools
4. **Persist session data** — Use file-based or database storage
5. **Request-level resource blocking** — Not browser-level flags

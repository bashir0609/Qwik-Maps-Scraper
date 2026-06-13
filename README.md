# Google Maps Scraper

Extract business data from Google Maps — names, addresses, ratings, reviews, phone numbers, emails, websites, categories, and coordinates. Multi-country support with batch search across towns and categories.

## Features

- **4 countries**: United States (40 states), United Kingdom (33 regions), Australia (8 states), Saudi Arabia (12 provinces)
- **26 business categories**: Restaurants, salons, clinics, pharmacies, gyms, car services, real estate, and more — each with keyword variations
- **Multi-category search**: Select multiple categories with popover chips, all keyword variations combined
- **Two-phase scraping**: Phase 1 (fast, ~30-60s) collects card-level data. Phase 2 (automatic, ~3-5 min) enriches all results with detail page data
- **Batch mode**: Search every town in a region × all selected keyword variations concurrently
- **Automatic detail enrichment**: Address, phone, website, and more extracted from detail pages — no manual clicking needed
- **Optional email extraction**: One-click per result, homepage-only extraction with retry logic
- **Dark theme UI**: Card view and table view with pagination, copy-to-clipboard buttons, CSV export
- **CSV export**: 15 columns with formatted filename `{date} - {category} - {town} - {region}.csv`
- **Docker deployment**: Ready for Railway/Render with Node 22 + Chromium + international fonts

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Qwik + Qwik City |
| Scraping | Puppeteer (headless Chromium) |
| Styling | Custom CSS (dark theme) |
| Bundler | Vite |
| Deployment | Docker (Node 22-slim) |

## Getting Started

### Prerequisites

- Node.js >= 22
- npm

### Install

```bash
# Linux/macOS/Docker
npm install

# Windows (skip Chromium download — use system Chrome instead)
set PUPPETEER_SKIP_DOWNLOAD=true
npm install
```

> **Windows users:** Set `PUPPETEER_EXECUTABLE_PATH` to your Chrome path before running:
> ```bash
> set PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
> ```

### Development

```bash
npm run dev
```

Opens at `http://localhost:5173`. Development mode runs slower than production — scraping times will be longer.

### Production Build

```bash
npm run build
npm start
```

### Docker

```bash
docker build -t maps-scraper .
docker run -p 8080:8080 maps-scraper
```

Or deploy to Railway/Render using the included `Dockerfile` and `railway.toml`.

### Clean Cache

```bash
npm run clean
```

Clears `dist/`, `server/`, and build cache.

## How It Works

### Phase 1 — Card Collection

1. Navigates to `https://www.google.com/maps/search/{query}`
2. Handles consent popup
3. Scrolls until Google shows "You've reached the end of the list"
4. Collects card data: name, rating, review count, address snippet, category, place URL
5. Returns results immediately (~30-60s for 5 keywords)

### Phase 2 — Auto Enrichment

1. Each result's detail page is visited sequentially (1 at a time, 500ms gap)
2. Extracts: full address, phone, website, coordinates
3. Progress shown as "Enriching 47/243 — 45 done"
4. Skips results that already have phone and website
5. Results update in real-time via 2-second polling

### Email Extraction

- Click **[Fetch Email]** on any result
- Visits the business website homepage only
- Uses `networkidle2` wait strategy with raw HTML fallback
- Deobfuscates common patterns ([at]→@, [dot]→.)
- Returns up to 3 emails sorted by relevance

### Crawl Configuration

| Setting | Value |
|---------|-------|
| Browsers | 3 instances, shared pool |
| Scroll delay | 1500ms between scrolls |
| Scroll end | "You've reached the end of the list" text detection |
| Keyword sequencing | 1 at a time, 1000ms gap |
| Town batches | 3 concurrent, 2000ms between batches |
| Detail enrichment | 1 at a time, 500ms gap |
| Email extraction | 1 at a time, 500ms gap |
| User agent | Chrome 126 on Windows 10 |
| Images | Google images load, non-Google blocked |

## Data Columns

| Column | Source |
|--------|--------|
| Name | Google Maps card |
| Address | Detail page (Phase 2) |
| City | Extracted from address |
| Rating | Google Maps card |
| Review Count | Google Maps card |
| Category | Google Maps card/detail |
| Filtered Category | User's category selection |
| Keyword | The variation that found this result |
| Phone | Detail page (Phase 2) |
| Email | On-demand extraction |
| Website | Detail page (Phase 2) |
| Root Domain | Extracted from website URL |
| Latitude | Detail page URL |
| Longitude | Detail page URL |
| Place URL | Google Maps link |

## Project Structure

```
src/
├── types.ts                    # PlaceResult, ScrapeResult
├── entry.ssr.tsx               # SSR entry
├── root.tsx                    # Root layout
├── global.css                  # Dark theme styles
├── routes/
│   ├── index.tsx              # Main scraper page
│   ├── details/               # Place detail route
│   └── places-api/            # Google Places API alternative
├── components/
│   ├── header/header.tsx
│   ├── navbar/navbar.tsx
│   ├── search-bar/search-bar.tsx
│   ├── results-table/results-table.tsx
│   ├── place-card/place-card.tsx
│   └── router-head/router-head.tsx
├── data/
│   ├── locations.ts            # 4 countries, regions, towns
│   └── categories.ts           # 26 categories with keywords
└── utils/
    ├── scrape.ts               # Scraping engine (~1937 lines)
    └── places-api.ts           # Google Places API integration
server.ts                       # Production entry point
```

## Deployment

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PUPPETEER_SKIP_DOWNLOAD` | Skip bundled Chromium download | `true` |
| `PUPPETEER_EXECUTABLE_PATH` | System Chromium path | `/usr/bin/chromium` |
| `PORT` | Server port | `8080` |
| `HOST` | Server host | `0.0.0.0` |
| `GOOGLE_API_KEY` | Google Places API key (optional) | — |

## License

For educational purposes only.

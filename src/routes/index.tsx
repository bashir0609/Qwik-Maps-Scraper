import { component$, useSignal, useOnDocument, $ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { SearchBar } from "../components/search-bar/search-bar";
import { PlaceCard } from "../components/place-card/place-card";
import { ResultsTable } from "../components/results-table/results-table";
import {
  startScrape,
  startBatchScrape,
  pollScrape,
  destroyScrape,
  exportToCSV,
  extractEmailForWebsite,
  fetchPlaceDetail,
} from "../utils/scrape";
import type { ScrapeResult } from "../types";

const POLL_INTERVAL = 2000;

export default component$(() => {
  const results = useSignal<ScrapeResult | null>(null);
  const isLoading = useSignal(false);
  const viewMode = useSignal<"cards" | "table">("cards");
  const progressMsg = useSignal("");
  const sessionIdRef = useSignal<string>("");
  const extractedEmails = useSignal<Record<string, string>>({});
  const loadingEmails = useSignal<Record<string, boolean>>({});
  const lastCategory = useSignal("");
  const lastTown = useSignal("");
  const lastRegionName = useSignal("");
  const lastRegionAbbr = useSignal("");

  const pollForResults = $(async (sid: string) => {
    let firstPoll = true;
    while (sessionIdRef.value === sid) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      if (sessionIdRef.value !== sid) break;
      // firstPoll=false → since=1 signals server to skip unchanged data
      const current = await pollScrape(sid, firstPoll ? 0 : 1);
      if (!current) {
        isLoading.value = false;
        progressMsg.value = "";
        return;
      }

      if (current.places && Array.isArray(current.places)) {
        const safePlaces = current.places.map((p) => ({
          name: p?.name || "",
          address: p?.address || "",
          rating: typeof p?.rating === "number" ? p.rating : null,
          reviewCount:
            typeof p?.reviewCount === "number" ? p.reviewCount : null,
          category: p?.category || "",
          phone: p?.phone || "",
          email: p?.email || "",
          website: p?.website || "",
          rootDomain: p?.rootDomain || "",
          coordinates:
            p?.coordinates &&
            typeof p.coordinates.lat === "number" &&
            typeof p.coordinates.lng === "number"
              ? { lat: p.coordinates.lat, lng: p.coordinates.lng }
              : null,
          placeUrl: p?.placeUrl || "",
          city: p?.city || "",
          filteredCategory: p?.filteredCategory || "",
          keyword: p?.keyword || "",
        }));
        results.value = {
          places: safePlaces,
          query: current.query || "",
          totalResults:
            typeof current.totalResults === "number" ? current.totalResults : 0,
          error: current.error || null,
          status: current.status || "running",
          progress: current.progress || "",
        };
      } else {
        results.value = { ...current, places: [] };
      }
      progressMsg.value =
        current.progress || `Found ${current.places?.length || 0} leads...`;

      firstPoll = false;

      if (current.status === "done" || current.status === "error") {
        isLoading.value = false;
        progressMsg.value = "";
        sessionIdRef.value = "";
        return;
      }
    }
  });

  const handleSearch = $(
    async (params: {
      query: string;
      maxResults: number;
      isBatch?: boolean;
      allKeywords?: string[];
      towns?: string[];
      stateName?: string;
      countryCode?: string;
      countrySuffix?: string;
      filteredCategory?: string;
      regionName?: string;
      regionAbbr?: string;
      locationFilter?: string;
      filterByLocation?: boolean;
    }) => {
      const {
        query,
        maxResults,
        isBatch,
        allKeywords,
        towns,
        stateName,
        countryCode,
        countrySuffix,
        filteredCategory,
        regionName,
        regionAbbr,
        locationFilter,
        filterByLocation,
      } = params;
      isLoading.value = true;
      results.value = null;
      progressMsg.value = "Starting scraper...";

      lastCategory.value = filteredCategory || query;
      lastTown.value =
        towns && towns.length === 1
          ? towns[0]
          : towns && towns.length > 1
            ? "All towns"
            : "";
      lastRegionName.value = regionName || stateName || "";
      lastRegionAbbr.value = regionAbbr || "";
      try {
        let sid: string;
        if (isBatch && allKeywords && towns && stateName) {
          progressMsg.value = `Scraping ${towns.length} towns × ${allKeywords.length} keyword(s)...`;
          sid = await startBatchScrape(
            allKeywords,
            towns,
            stateName,
            maxResults,
            countryCode || "us",
            countrySuffix || "",
            filteredCategory || "",
            filterByLocation !== false,
          );
        } else {
          progressMsg.value = "Navigating to Google Maps...";
          sid = await startScrape(
            query,
            maxResults,
            countryCode || "us",
            filteredCategory || "",
            locationFilter || "",
            filterByLocation !== false,
          );
        }
        sessionIdRef.value = sid;
        pollForResults(sid);
      } catch (error: unknown) {
        results.value = {
          places: [],
          query: query || "",
          totalResults: 0,
          error: error instanceof Error ? error.message : "Unknown error",
          status: "error",
          progress: "",
        };
        isLoading.value = false;
        progressMsg.value = "";
      }
    },
  );

  const handleExportCSV = $(() => {
    if (!results.value?.places.length) return;
    const merged = results.value.places.map((p) => ({
      ...p,
      email: p.email || extractedEmails.value[p.website] || "",
    }));
    const csv = exportToCSV(merged);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;

    const date = new Date().toISOString().slice(0, 10);
    const parts: string[] = [date];
    if (lastCategory.value) parts.push(lastCategory.value);
    if (lastTown.value) parts.push(lastTown.value);
    const region = lastRegionAbbr.value
      ? `${lastRegionName.value} [${lastRegionAbbr.value}]`
      : lastRegionName.value;
    if (region) parts.push(region);
    link.download =
      (parts.length > 0 ? parts.join(" - ") : "maps-scraper-export") + ".csv";

    link.click();
    URL.revokeObjectURL(url);
  });

  const handleClearResults = $(() => {
    results.value = null;
    progressMsg.value = "";
    extractedEmails.value = {};
    loadingEmails.value = {};
  });

  const handleCancel = $(async () => {
    isLoading.value = false;
    progressMsg.value = "";
    if (sessionIdRef.value) {
      await destroyScrape(sessionIdRef.value);
      sessionIdRef.value = "";
    }
  });

  const fetchDetailLoading = useSignal<Record<string, boolean>>({});

  useOnDocument(
    "click",
    $(async (event) => {
      // Fetch Details click
      const detailBtn = (event.target as HTMLElement).closest(
        "[data-fetch-detail]",
      ) as HTMLElement | null;
      if (detailBtn) {
        const placeUrl = detailBtn.getAttribute("data-fetch-detail");
        if (
          !placeUrl ||
          !sessionIdRef.value ||
          fetchDetailLoading.value[placeUrl]
        )
          return;
        fetchDetailLoading.value = {
          ...fetchDetailLoading.value,
          [placeUrl]: true,
        };
        try {
          const enriched = await fetchPlaceDetail(sessionIdRef.value, placeUrl);
          if (
            enriched &&
            results.value &&
            Array.isArray(results.value.places)
          ) {
            const idx = results.value.places.findIndex(
              (p) => p.placeUrl === placeUrl,
            );
            if (idx >= 0) {
              const existing = results.value.places[idx];
              const mergedPlace = {
                name: enriched.name || existing.name,
                address: enriched.address || existing.address,
                rating:
                  typeof enriched.rating === "number"
                    ? enriched.rating
                    : existing.rating,
                reviewCount:
                  typeof enriched.reviewCount === "number"
                    ? enriched.reviewCount
                    : existing.reviewCount,
                category: enriched.category || existing.category,
                phone: enriched.phone || existing.phone,
                email: enriched.email || existing.email,
                website: enriched.website || existing.website,
                rootDomain: enriched.rootDomain || existing.rootDomain,
                coordinates:
                  enriched.coordinates &&
                  typeof enriched.coordinates.lat === "number" &&
                  typeof enriched.coordinates.lng === "number"
                    ? {
                        lat: enriched.coordinates.lat,
                        lng: enriched.coordinates.lng,
                      }
                    : existing.coordinates,
                placeUrl: enriched.placeUrl || existing.placeUrl,
                city: enriched.city || existing.city,
                filteredCategory:
                  enriched.filteredCategory || existing.filteredCategory,
                keyword: enriched.keyword || existing.keyword,
              };
              results.value = {
                ...results.value,
                places: results.value.places.map((p, i) =>
                  i === idx ? mergedPlace : p,
                ),
              };
            }
          }
        } catch (err) {
          console.error(
            "[fetchDetail]",
            err instanceof Error ? err.message : String(err),
          );
        } finally {
          fetchDetailLoading.value = Object.fromEntries(
            Object.entries(fetchDetailLoading.value).filter(
              ([k]) => k !== placeUrl,
            ),
          );
        }
        return;
      }
      // Fetch Email click
      const emailBtn = (event.target as HTMLElement).closest(
        "[data-fetch-email]",
      ) as HTMLElement | null;
      if (emailBtn) {
        const websiteUrl = emailBtn.getAttribute("data-fetch-email");
        if (!websiteUrl || loadingEmails.value[websiteUrl]) return;
        loadingEmails.value = { ...loadingEmails.value, [websiteUrl]: true };
        try {
          const email = await extractEmailForWebsite(websiteUrl);
          extractedEmails.value = {
            ...extractedEmails.value,
            [websiteUrl]: email,
          };
        } catch (err) {
          console.error(
            "[fetchEmail]",
            err instanceof Error ? err.message : String(err),
          );
        } finally {
          loadingEmails.value = Object.fromEntries(
            Object.entries(loadingEmails.value).filter(
              ([k]) => k !== websiteUrl,
            ),
          );
        }
        return;
      }
    }),
  );

  return (
    <div class="app">
      <main class="main">
        <SearchBar onSearch={handleSearch} isLoading={isLoading.value} />

        {results.value?.error && (
          <div class="error-banner">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span>{results.value.error}</span>
          </div>
        )}

        {isLoading.value && progressMsg.value && (
          <div class="progress-banner">
            <div class="spinner-small" />
            <span>{progressMsg.value}</span>
            {results.value?.places.length ? (
              <span class="progress-count">
                {" "}
                &mdash; {results.value.places.length} leads found
              </span>
            ) : null}
            <button class="cancel-btn" onClick$={handleCancel}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Cancel
            </button>
          </div>
        )}

        {results.value &&
          Array.isArray(results.value.places) &&
          results.value.places.length > 0 && (
            <div class="results-section">
              <div class="results-header">
                <div class="results-info">
                  <h2>
                    {isLoading.value
                      ? `${results.value.places.length} leads (scraping...)`
                      : `${results.value.totalResults > 0 ? results.value.totalResults.toLocaleString() : results.value.places.length} results`}
                  </h2>
                  <span class="results-query">for "{results.value.query}"</span>
                </div>

                <div class="results-actions">
                  <div class="view-toggle">
                    <button
                      class={`toggle-btn ${viewMode.value === "cards" ? "active" : ""}`}
                      onClick$={() => {
                        viewMode.value = "cards";
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <rect x="3" y="3" width="7" height="7" />
                        <rect x="14" y="3" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" />
                        <rect x="14" y="14" width="7" height="7" />
                      </svg>
                      Cards
                    </button>
                    <button
                      class={`toggle-btn ${viewMode.value === "table" ? "active" : ""}`}
                      onClick$={() => {
                        viewMode.value = "table";
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <line x1="3" y1="6" x2="21" y2="6" />
                        <line x1="3" y1="12" x2="21" y2="12" />
                        <line x1="3" y1="18" x2="21" y2="18" />
                      </svg>
                      Table
                    </button>
                  </div>
                  <button
                    class="export-btn"
                    onClick$={handleExportCSV}
                    disabled={isLoading.value}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export CSV
                  </button>
                  <button
                    class="clear-btn"
                    onClick$={handleClearResults}
                    disabled={isLoading.value}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M3 6h1v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6h1" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                      <path d="M4 6h16" />
                    </svg>
                    Clear Results
                  </button>
                </div>
              </div>

              {viewMode.value === "cards" ? (
                <div class="cards-grid">
                  {results.value.places.map((place, index) => (
                    <PlaceCard
                      key={place?.placeUrl || index}
                      place={place}
                      index={index}
                      extractedEmails={extractedEmails.value}
                      loadingEmails={loadingEmails.value}
                      fetchDetailLoading={fetchDetailLoading.value}
                    />
                  ))}
                </div>
              ) : (
                <ResultsTable
                  places={results.value.places}
                  extractedEmails={extractedEmails.value}
                  loadingEmails={loadingEmails.value}
                  fetchDetailLoading={fetchDetailLoading.value}
                />
              )}
            </div>
          )}

        {isLoading.value && !results.value && !progressMsg.value && (
          <div class="loading-state">
            <div class="loading-spinner" />
            <p>Scraping Google Maps with headless browser...</p>
            <p class="loading-hint">Visiting each result for full details</p>
          </div>
        )}

        {!results.value && !isLoading.value && (
          <div class="welcome">
            <div class="welcome-icon">
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <h2>Google Maps Data Scraper</h2>
            <p>
              Search for businesses, extract contact info, ratings, addresses,
              and more. Results stream in as they're found.
            </p>
            <div class="features">
              <div class="feature">
                <span class="feature-icon">📊</span>
                <span>Business Data</span>
              </div>
              <div class="feature">
                <span class="feature-icon">⭐</span>
                <span>Ratings & Reviews</span>
              </div>
              <div class="feature">
                <span class="feature-icon">📞</span>
                <span>Contact Info</span>
              </div>
              <div class="feature">
                <span class="feature-icon">📁</span>
                <span>CSV Export</span>
              </div>
            </div>
          </div>
        )}
      </main>
      <footer class="footer">
        <div class="footer-inner">
          <div class="footer-brand">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span>Maps Scraper Pro</span>
          </div>
          <div class="footer-links">
            <a href="#">Documentation</a>
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Support</a>
          </div>
          <div class="footer-copy">
            © {new Date().getFullYear()} Maps Scraper Pro. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Google Maps Scraper - Extract Business Data",
  meta: [
    {
      name: "description",
      content:
        "Scrape business data from Google Maps including names, addresses, ratings, and contact information.",
    },
  ],
};

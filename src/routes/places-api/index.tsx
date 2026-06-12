import { component$, useSignal, $ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { PlaceCard } from "../../components/place-card/place-card";
import { ResultsTable } from "../../components/results-table/results-table";
import { searchPlacesText } from "../../utils/places-api";
import type { PlaceResult } from "../../types";
import { countries, getAllRegions } from "../../data/locations";
import { categories } from "../../data/categories";

interface SearchParams {
  query: string;
  location: string;
  keywords: string[];
  regionName: string;
  regionAbbr: string;
}

export default component$(() => {
  const results = useSignal<PlaceResult[]>([]);
  const isLoading = useSignal(false);
  const viewMode = useSignal<"cards" | "table">("cards");
  const progressMsg = useSignal("");
  const errorMsg = useSignal("");
  const nextPageToken = useSignal<string | undefined>(undefined);
  const hasMore = useSignal(false);

  const selectedCountry = useSignal("us");
  const selectedRegion = useSignal("");
  const selectedTown = useSignal("");
  const selectedCategories = useSignal<string[]>([]);
  const popoverOpen = useSignal(false);
  const regionOptions = useSignal<{ name: string; abbr: string; priority: number; towns: string[] }[]>(getAllRegions("us"));
  const townOptions = useSignal<string[]>([]);

  const updateRegions = $((countryCode: string) => {
    selectedCountry.value = countryCode;
    selectedRegion.value = "";
    selectedTown.value = "";
    regionOptions.value = getAllRegions(countryCode);
    townOptions.value = [];
  });

  const updateTown = $((regionName: string) => {
    selectedRegion.value = regionName;
    selectedTown.value = "";
    const regions = regionOptions.value;
    const region = regions.find((r) => r.name === regionName);
    townOptions.value = region ? region.towns : [];
  });

  const toggleCategory = $((catLabel: string) => {
    const idx = selectedCategories.value.indexOf(catLabel);
    if (idx >= 0) {
      selectedCategories.value = selectedCategories.value.filter((c) => c !== catLabel);
    } else {
      selectedCategories.value = [...selectedCategories.value, catLabel];
    }
  });

  const removeCategory = $((catLabel: string) => {
    selectedCategories.value = selectedCategories.value.filter((c) => c !== catLabel);
  });

  const handleSearch = $(async () => {
    if (selectedCategories.value.length === 0 && !selectedTown.value) {
      errorMsg.value = "Please select a category or enter a location";
      return;
    }

    isLoading.value = true;
    errorMsg.value = "";
    progressMsg.value = "Searching...";
    results.value = [];
    nextPageToken.value = undefined;
    hasMore.value = false;

    const country = countries.find((c) => c.code === selectedCountry.value);
    const suffix = country?.suffix || "";
    const location = selectedTown.value
      ? `${selectedTown.value}, ${selectedRegion.value}${suffix ? `, ${suffix}` : ""}`
      : `${selectedRegion.value}${suffix ? `, ${suffix}` : ""}`;

    const catLabels = selectedCategories.value;
    const keywords = catLabels.length > 0
      ? categories.filter((c) => catLabels.includes(c.label)).flatMap((c) => c.keywords)
      : [];

    const query = catLabels.join(" + ") || "businesses";
    const params: SearchParams = {
      query,
      location,
      keywords,
      regionName: selectedRegion.value,
      regionAbbr: regionOptions.value.find((r) => r.name === selectedRegion.value)?.abbr || "",
    };

    try {
      const result = await searchPlacesText(params.query, params.location, params.keywords);

      if (result.error) {
        errorMsg.value = result.error;
        progressMsg.value = "";
      } else {
        results.value = result.places.map((p) => ({
          name: p?.name || "",
          address: p?.address || "",
          rating: typeof p?.rating === "number" ? p.rating : null,
          reviewCount: typeof p?.reviewCount === "number" ? p.reviewCount : null,
          category: p?.category || "",
          phone: p?.phone || "",
          email: p?.email || "",
          website: p?.website || "",
          rootDomain: p?.rootDomain || "",
          coordinates: p?.coordinates && typeof p.coordinates.lat === "number" && typeof p.coordinates.lng === "number"
            ? { lat: p.coordinates.lat, lng: p.coordinates.lng } : null,
          placeUrl: p?.placeUrl || "",
          city: p?.city || "",
          filteredCategory: p?.filteredCategory || "",
          keyword: p?.keyword || "",
        }));
        nextPageToken.value = result.nextPageToken;
        hasMore.value = !!result.nextPageToken;
        progressMsg.value = result.places.length > 0
          ? `Found ${result.places.length} results`
          : "No results found";
      }
    } catch (err) {
      errorMsg.value = err instanceof Error ? err.message : "Search failed";
      progressMsg.value = "";
    } finally {
      isLoading.value = false;
    }
  });

  const handleLoadMore = $(async () => {
    if (!nextPageToken.value || isLoading.value) return;

    isLoading.value = true;
    progressMsg.value = "Loading more...";

    const country = countries.find((c) => c.code === selectedCountry.value);
    const suffix = country?.suffix || "";
    const location = selectedTown.value
      ? `${selectedTown.value}, ${selectedRegion.value}${suffix ? `, ${suffix}` : ""}`
      : `${selectedRegion.value}${suffix ? `, ${suffix}` : ""}`;

    const catLabels = selectedCategories.value;
    const keywords = catLabels.length > 0
      ? categories.filter((c) => catLabels.includes(c.label)).flatMap((c) => c.keywords)
      : [];

    const query = catLabels.join(" + ") || "businesses";

    try {
      const result = await searchPlacesText(query, location, keywords, nextPageToken.value);

      if (!result.error && result.places.length > 0) {
        const newPlaces = result.places.map((p) => ({
          name: p?.name || "",
          address: p?.address || "",
          rating: typeof p?.rating === "number" ? p.rating : null,
          reviewCount: typeof p?.reviewCount === "number" ? p.reviewCount : null,
          category: p?.category || "",
          phone: p?.phone || "",
          email: p?.email || "",
          website: p?.website || "",
          rootDomain: p?.rootDomain || "",
          coordinates: p?.coordinates && typeof p.coordinates.lat === "number" && typeof p.coordinates.lng === "number"
            ? { lat: p.coordinates.lat, lng: p.coordinates.lng } : null,
          placeUrl: p?.placeUrl || "",
          city: p?.city || "",
          filteredCategory: p?.filteredCategory || "",
          keyword: p?.keyword || "",
        }));
        results.value = [...results.value, ...newPlaces];
        nextPageToken.value = result.nextPageToken;
        hasMore.value = !!result.nextPageToken;
        progressMsg.value = `Loaded ${results.value.length} results`;
      } else {
        hasMore.value = false;
        progressMsg.value = `Showing ${results.value.length} results`;
      }
    } catch (err) {
      console.error("[places-api] Load more error:", err);
    } finally {
      isLoading.value = false;
    }
  });

  const handleClearResults = $(() => {
    results.value = [];
    progressMsg.value = "";
    errorMsg.value = "";
    nextPageToken.value = undefined;
    hasMore.value = false;
  });

  return (
    <div class="app">
      <main class="main">
        <div class="search-bar">
          <div class="search-form">
            <div class="search-input-wrapper">
              <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <div class="location-controls" style="flex: 1;">
                <div class="location-select-group">
                  <select
                    class="location-select location-select-country"
                    disabled={isLoading.value}
                    value={selectedCountry.value}
                    onChange$={(e) => {
                      const val = (e.target as HTMLSelectElement).value;
                      updateRegions(val);
                    }}
                  >
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                  <div class="category-chips-row">
                    {selectedCategories.value.length === 0 && (
                      <span class="category-chip category-trigger-chip" onClick$={() => { popoverOpen.value = !popoverOpen.value; }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Category
                      </span>
                    )}
                    {selectedCategories.value.length === 1 && (
                      <span class="category-chip">
                        {selectedCategories.value[0]}
                        <button type="button" class="category-chip-remove" onClick$={() => removeCategory(selectedCategories.value[0])} title="Remove">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </span>
                    )}
                    {selectedCategories.value.length > 1 && (
                      <span class="category-chip" onClick$={() => { popoverOpen.value = !popoverOpen.value; }}>
                        {selectedCategories.value[0]} +{selectedCategories.value.length - 1}
                        <button type="button" class="category-chip-remove" onClick$={(e) => { e.stopPropagation(); selectedCategories.value = []; }} title="Clear all">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </span>
                    )}
                    {popoverOpen.value && (
                      <>
                        <div class="popover-backdrop" onClick$={() => { popoverOpen.value = false; }} />
                        <div class="category-popover">
                          {categories.map((c) => {
                            const checked = selectedCategories.value.includes(c.label);
                            return (
                              <label key={c.label} class="category-popover-item">
                                <input type="checkbox" checked={checked} onChange$={() => toggleCategory(c.label)} />
                                <span>{c.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                  <select
                    class="location-select"
                    disabled={isLoading.value || !selectedCountry.value}
                    value={selectedRegion.value}
                    onChange$={(e) => {
                      const val = (e.target as HTMLSelectElement).value;
                      updateTown(val);
                    }}
                  >
                    <option value="">Region</option>
                    <optgroup label="Priority">
                      {regionOptions.value.filter((r) => r.priority > 0).map((r) => (
                        <option key={r.name} value={r.name}>{r.abbr ? `${r.name} (${r.abbr})` : r.name}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Other">
                      {regionOptions.value.filter((r) => r.priority === 0).map((r) => (
                        <option key={r.name} value={r.name}>{r.abbr ? `${r.name} (${r.abbr})` : r.name}</option>
                      ))}
                    </optgroup>
                  </select>
                  <select
                    class="location-select"
                    disabled={isLoading.value || !selectedRegion.value}
                    value={selectedTown.value}
                    onChange$={(e) => { selectedTown.value = (e.target as HTMLSelectElement).value; }}
                  >
                    <option value="">Town</option>
                    {townOptions.value.map((town) => (
                      <option key={town} value={town}>{town}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button type="button" disabled={isLoading.value} class="search-button" onClick$={handleSearch}>
                {isLoading.value ? <span class="spinner" /> : "Search"}
              </button>
            </div>
          </div>
          <div class="search-hints">
            <span class="hints-label">Tip:</span>
            <span class="hints-text">Select a category and region/town, then search. Leave town empty to search an entire region.</span>
          </div>
        </div>

        {errorMsg.value && (
          <div class="error-banner">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span>{errorMsg.value}</span>
          </div>
        )}

        {progressMsg.value && !errorMsg.value && (
          <div class="progress-banner">
            {isLoading.value && <div class="spinner-small" />}
            <span>{progressMsg.value}</span>
            {results.value.length > 0 && (
              <button class="clear-btn" style="margin-left: auto;" onClick$={handleClearResults}>
                Clear
              </button>
            )}
          </div>
        )}

        {results.value.length > 0 && (
          <div class="results-section">
            <div class="results-header">
              <div class="results-info">
                <h2>{results.value.length} results</h2>
              </div>

              <div class="results-actions">
                <div class="view-toggle">
                  <button
                    class={`toggle-btn ${viewMode.value === "cards" ? "active" : ""}`}
                    onClick$={() => { viewMode.value = "cards"; }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                    </svg>
                    Cards
                  </button>
                  <button
                    class={`toggle-btn ${viewMode.value === "table" ? "active" : ""}`}
                    onClick$={() => { viewMode.value = "table"; }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                    Table
                  </button>
                </div>
              </div>
            </div>

            {viewMode.value === "cards" ? (
              <div class="cards-grid">
                {results.value.map((place, index) => (
                  <PlaceCard
                    key={place.placeUrl || index}
                    place={place}
                    index={index}
                    extractedEmails={{}}
                    loadingEmails={{}}
                    fetchDetailLoading={{}}
                  />
                ))}
              </div>
            ) : (
              <ResultsTable
                places={results.value}
                extractedEmails={{}}
                loadingEmails={{}}
                fetchDetailLoading={{}}
              />
            )}

            {hasMore.value && (
              <div class="load-more-container">
                <button class="load-more-btn" disabled={isLoading.value} onClick$={handleLoadMore}>
                  {isLoading.value ? "Loading..." : "Load More"}
                </button>
              </div>
            )}
          </div>
        )}

        {!results.value.length && !isLoading.value && !errorMsg.value && (
          <div class="welcome">
            <div class="welcome-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <h2>Google Places API Search</h2>
            <p>Search for businesses using Google Places API. Select a category and location to find places with their details.</p>
            <div class="features">
              <div class="feature"><span class="feature-icon">📍</span><span>Location-based Search</span></div>
              <div class="feature"><span class="feature-icon">⭐</span><span>Ratings & Reviews</span></div>
              <div class="feature"><span class="feature-icon">📞</span><span>Contact Info</span></div>
              <div class="feature"><span class="feature-icon">🌐</span><span>Website Links</span></div>
            </div>
          </div>
        )}
      </main>
      <footer class="footer"><p>Built with Qwik | Data sourced from Google Places API</p></footer>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Google Places API Search",
  meta: [{ name: "description", content: "Search for businesses using Google Places API with ratings, contact info, and more." }],
};

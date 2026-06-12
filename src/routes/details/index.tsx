import { component$, useSignal, useStore, $ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { PlaceCard } from "../../components/place-card/place-card";
import { extractPlaceFromUrl } from "../../utils/scrape";
import type { PlaceResult } from "../../types";

export default component$(() => {
  const placeUrl = useSignal("");
  const singleLoading = useSignal(false);
  const singleError = useSignal("");
  const extractedEmails = useStore<Record<string, string>>({});
  const loadingEmails = useStore<Record<string, boolean>>({});
  const placeData = useStore<Partial<PlaceResult>>({});

  const handleExtractSingle = $(async () => {
    const url = placeUrl.value.trim();
    if (!url || !url.includes("google.com/maps/place")) {
      singleError.value = "Please enter a valid Google Maps place URL";
      return;
    }
    singleLoading.value = true;
    singleError.value = "";
    try {
      const result = await extractPlaceFromUrl(url);
      if (result) {
        placeData.name = result?.name || "";
        placeData.address = result?.address || "";
        placeData.rating = typeof result?.rating === "number" ? result.rating : null;
        placeData.reviewCount = typeof result?.reviewCount === "number" ? result.reviewCount : null;
        placeData.category = result?.category || "";
        placeData.phone = result?.phone || "";
        placeData.email = result?.email || "";
        placeData.website = result?.website || "";
        placeData.rootDomain = result?.rootDomain || "";
        placeData.coordinates = result?.coordinates && typeof result.coordinates.lat === "number" && typeof result.coordinates.lng === "number"
          ? { lat: result.coordinates.lat, lng: result.coordinates.lng } : null;
        placeData.placeUrl = result?.placeUrl || "";
        placeData.city = result?.city || "";
        placeData.filteredCategory = result?.filteredCategory || "";
        placeData.keyword = result?.keyword || "";
      } else {
        singleError.value = "Failed to extract data. Check the URL and try again.";
      }
    } catch (err) {
      singleError.value = err instanceof Error ? err.message : "Extraction failed";
    } finally {
      singleLoading.value = false;
    }
  });

  return (
    <div class="app">
      <main class="main">
        <div class="details-page">
          <h2 class="details-heading">Extract Details from Google Maps URL</h2>

          <div class="details-section">
            <h3>Paste a Google Maps place URL to extract business details</h3>
            <div class="details-input-row">
              <input
                type="text"
                class="details-url-input"
                placeholder="https://www.google.com/maps/place/..."
                bind:value={placeUrl}
                disabled={singleLoading.value}
              />
              <button
                class="search-button"
                onClick$={handleExtractSingle}
                disabled={singleLoading.value || !placeUrl.value}
              >
                {singleLoading.value ? "Extracting..." : "Extract"}
              </button>
            </div>
            {singleError.value && (
              <div class="error-banner">
                <span>{singleError.value}</span>
              </div>
            )}
            {placeData.name && (
              <div class="details-result">
                <PlaceCard
                  place={placeData as PlaceResult}
                  index={0}
                  extractedEmails={extractedEmails}
                  loadingEmails={loadingEmails}
                  fetchDetailLoading={{}}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Extract from URL — Google Maps Scraper",
};

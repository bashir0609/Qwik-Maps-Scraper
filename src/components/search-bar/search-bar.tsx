import { component$, $, useSignal, useTask$, type QRL } from "@builder.io/qwik";
import { countries, getAllRegions } from "../../data/locations";
import { categories } from "../../data/categories";

interface SearchParams {
  query: string;
  maxResults: number;
  isBatch?: boolean;
  allKeywords?: string[];
  towns?: string[];
  stateName?: string;
  countryCode?: string;
  countrySuffix?: string;
  locationFilter?: string;
  filterByLocation?: boolean;
  filteredCategory?: string;
  regionName?: string;
  regionAbbr?: string;
}

interface SearchBarProps {
  onSearch: QRL<(params: SearchParams) => void>;
  isLoading: boolean;
}

export const SearchBar = component$(({ onSearch, isLoading }: SearchBarProps) => {
  const query = useSignal("");
  const maxResults = useSignal(999);
  const selectedCountry = useSignal("us");
  const selectedRegion = useSignal("");
  const selectedTown = useSignal("");
  const selectedCategories = useSignal<string[]>([]);
  const popoverOpen = useSignal(false);
  const regionOptions = useSignal<{ name: string; abbr: string; priority: number; towns: string[] }[]>(getAllRegions("us"));
  const townOptions = useSignal<string[]>([]);
  const filterByLocation = useSignal(true);

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

  useTask$(({ track }) => {
    track(() => selectedCategories.value);
    const cats = selectedCategories.value;
    if (cats.length === 0) {
      query.value = "";
      return;
    }
    const selectedData = categories.filter((c) => cats.includes(c.label));
    const allKeywords = selectedData.flatMap((c) => c.keywords);
    query.value = allKeywords.join(" / ");
  });

  const handleSubmit = $(() => {
    const q = query.value.trim();
    if (!q && !selectedTown.value && selectedCategories.value.length === 0) return;

    const catLabels = selectedCategories.value;
    const filteredCat = catLabels.join(", ");
    const selectedCats = catLabels.length > 0
      ? categories.filter((c) => catLabels.includes(c.label))
      : [];
    const allKw = selectedCats.length > 0
      ? selectedCats.flatMap((c) => c.keywords)
      : (q ? [q] : []);

    const country = countries.find((c) => c.code === selectedCountry.value);
    const suffix = country?.suffix || "";
    const regions = regionOptions.value;
    const region = regions.find((r) => r.name === selectedRegion.value);
    const displayName = catLabels.length > 0 ? catLabels.join(" + ") : (q || "businesses");

    if (selectedTown.value === "__ALL__" && region) {
      const keywords = allKw.length > 0 ? allKw : (q ? [q] : ["businesses"]);
      const locationDesc = suffix ? `${region.name}, ${suffix}` : region.name;
      onSearch({
        query: `${displayName} across ${region.towns.length} towns in ${locationDesc}`,
        maxResults: maxResults.value,
        isBatch: true,
        allKeywords: keywords,
        towns: region.towns,
        stateName: region.name,
        countryCode: selectedCountry.value,
        countrySuffix: suffix,
        filteredCategory: filteredCat,
        filterByLocation: filterByLocation.value,
        regionName: region.name,
        regionAbbr: region.abbr,
      });
      return;
    }

    let searchQuery = q;
    const suffixStr = suffix ? `, ${suffix}` : "";

    if (selectedTown.value && selectedTown.value !== "__ALL__" && region) {
      if (allKw.length > 1) {
        onSearch({
          query: `${displayName} in ${selectedTown.value}, ${region.name}${suffixStr}`,
          maxResults: maxResults.value,
          isBatch: true,
          allKeywords: allKw,
          towns: [selectedTown.value],
          stateName: region.name,
          countryCode: selectedCountry.value,
          countrySuffix: suffix,
          locationFilter: selectedTown.value,
          filterByLocation: filterByLocation.value,
          filteredCategory: filteredCat,
          regionName: region.name,
          regionAbbr: region.abbr,
        });
        return;
      }
      const townSuffix = `${selectedTown.value}, ${region.name}${suffixStr}`;
      if (searchQuery) {
        searchQuery = `${searchQuery} in ${townSuffix}`;
      } else {
        searchQuery = townSuffix;
      }
    }

    if (searchQuery || allKw.length > 0) {
      const finalQuery = searchQuery || displayName;
      onSearch({
        query: finalQuery,
        maxResults: maxResults.value,
        countryCode: selectedCountry.value,
        locationFilter: selectedTown.value && selectedTown.value !== "__ALL__" ? selectedTown.value : "",
        filterByLocation: filterByLocation.value,
        filteredCategory: filteredCat,
        regionName: region?.name || "",
        regionAbbr: region?.abbr || "",
      });
    }
  });

  const countryList = countries;

  return (
    <div class="search-bar">
      <form preventdefault:submit onSubmit$={handleSubmit} class="search-form">
        <div class="search-input-wrapper">
          <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Keywords (e.g. tattoo studios, plumbers, gyms)..."
            bind:value={query}
            disabled={isLoading}
            class="search-input"
          />
          <div class="location-controls">
            <div class="location-select-group">
              <select
                class="location-select location-select-country"
                disabled={isLoading}
                value={selectedCountry.value}
                onChange$={(e) => {
                  const val = (e.target as HTMLSelectElement).value;
                  updateRegions(val);
                }}
              >
                {countryList.map((c) => (
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
                disabled={isLoading || !selectedCountry.value}
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
                disabled={isLoading || !selectedRegion.value}
                value={selectedTown.value}
                onChange$={(e) => { selectedTown.value = (e.target as HTMLSelectElement).value; }}
              >
                <option value="">Town</option>
                <option value="__ALL__">All towns</option>
                {townOptions.value.map((town) => (
                  <option key={town} value={town}>{town}</option>
                ))}
              </select>
            </div>
            <div class="max-results-control">
              <label for="max-results" class="max-results-label">Max:</label>
              <input
                id="max-results"
                type="number"
                min="1"
                max="9999"
                value={maxResults.value}
                disabled={isLoading}
                class="max-results-input"
                onChange$={(e) => {
                  const val = parseInt((e.target as HTMLInputElement).value) || 500;
                  maxResults.value = Math.max(val, 1);
                }}
              />
            </div>
            <div class="location-filter-toggle-control">
              <span class="location-filter-toggle-label">City filter</span>
              <button
                type="button"
                disabled={isLoading}
                class={`location-filter-toggle ${filterByLocation.value ? "location-filter-toggle--on" : "location-filter-toggle--off"}`}
                onClick$={() => { filterByLocation.value = !filterByLocation.value; }}
                title={filterByLocation.value ? "City filter ON — results matched to selected town" : "City filter OFF — all results kept regardless of city"}
              >
                <span class="location-filter-toggle-thumb" />
              </button>
            </div>
          </div>
          <button type="submit" disabled={isLoading} class="search-button">
            {isLoading ? <span class="spinner" /> : "Scrape"}
          </button>
        </div>
      </form>
      <div class="search-hints">
        <span class="hints-label">Tip:</span>
        <span class="hints-text">Select a country, pick a category & region, then scrape. Use "All towns" to search every town in a region.</span>
      </div>
    </div>
  );
});
import { server$ } from "@builder.io/qwik-city";
import type { PlaceResult } from "../types";

const PLACES_API_BASE = "https://maps.googleapis.com/maps/api/place";

interface GooglePlaceSearchResult {
  place_id: string;
  name: string;
  formatted_address: string;
  rating?: number;
  types?: string[];
  geometry?: {
    location: {
      lat: number;
      lng: number;
    };
  };
  url?: string;
}

interface GooglePlaceDetailsResult {
  name: string;
  formatted_address: string;
  formatted_phone_number?: string;
  website?: string;
  rating?: number;
  types?: string[];
  geometry?: {
    location: {
      lat: number;
      lng: number;
    };
  };
  url?: string;
}

interface GoogleTextSearchResponse {
  results: GooglePlaceSearchResult[];
  status: string;
  next_page_token?: string;
}

interface GoogleDetailsResponse {
  result: GooglePlaceDetailsResult;
  status: string;
}

function extractRootDomain(urlStr: string): string {
  if (!urlStr) return "";
  try {
    const u = new URL(urlStr.startsWith("http") ? urlStr : `https://${urlStr}`);
    const host = u.hostname.replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join(".");
    return lastTwo;
  } catch {
    return "";
  }
}

function extractCityFromAddress(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  let last = parts.length - 1;
  const countries = new Set(["usa", "united states", "uk", "united kingdom", "australia", "canada", "saudi arabia"]);
  if (countries.has(parts[last].toLowerCase())) last--;
  if (last < 1) return "";
  const candidate = parts[last - 1];
  const m = candidate.match(/^(.+?)\s+(?:[A-Z]{2}\s+\d{5}(?:-\d{4})?|[A-Z]{1,2}\d)/);
  return m ? m[1].trim() : candidate;
}

function categoryFromTypes(types?: string[]): string {
  if (!types || types.length === 0) return "";
  const skipTypes = new Set(["point_of_interest", "establishment", "locality", "political"]);
  const category = types.find((t) => !skipTypes.has(t));
  return category ? category.replace(/_/g, " ") : types[0].replace(/_/g, " ");
}

export const searchPlacesText = server$(async function (
  query: string,
  location: string,
  keywords: string[],
  pageToken?: string
): Promise<{ places: PlaceResult[]; nextPageToken?: string; error?: string }> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { places: [], error: "Google Places API key not configured" };
  }

  try {
    const searchQuery = keywords.length > 0
      ? `${keywords.join(" ")} in ${location}`
      : `${query} in ${location}`;

    const params = new URLSearchParams({
      query: searchQuery,
      key: apiKey,
    });

    if (pageToken) {
      params.set("pagetoken", pageToken);
    }

    const url = `${PLACES_API_BASE}/textsearch/json?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      return { places: [], error: `API request failed: ${response.status}` };
    }

    const data: GoogleTextSearchResponse = await response.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return { places: [], error: `API returned status: ${data.status}` };
    }

    if (!data.results || data.results.length === 0) {
      return { places: [], nextPageToken: data.next_page_token };
    }

    const placeIds = data.results.map((p) => p.place_id).join("|");
    const detailsResults = await fetchPlaceDetailsBatch(placeIds, apiKey);

    const places: PlaceResult[] = data.results.map((result) => {
      const details = detailsResults.get(result.place_id);
      return {
        name: result.name || "",
        address: result.formatted_address || "",
        rating: result.rating ?? null,
        reviewCount: null,
        category: categoryFromTypes(result.types) || (details?.types ? categoryFromTypes(details.types) : ""),
        phone: details?.formatted_phone_number || "",
        email: "",
        website: details?.website || "",
        rootDomain: details?.website ? extractRootDomain(details.website) : "",
        coordinates: result.geometry?.location
          ? { lat: result.geometry.location.lat, lng: result.geometry.location.lng }
          : (details?.geometry?.location ? { lat: details.geometry.location.lat, lng: details.geometry.location.lng } : null),
        placeUrl: result.url || `https://www.google.com/maps/place/?q=place_id:${result.place_id}`,
        city: extractCityFromAddress(result.formatted_address || ""),
        filteredCategory: keywords.length > 0 ? keywords.join(", ") : query,
        keyword: query,
      };
    });

    return {
      places,
      nextPageToken: data.next_page_token,
    };
  } catch (err) {
    console.error("[places-api] searchPlacesText error:", err);
    return { places: [], error: err instanceof Error ? err.message : "Unknown error" };
  }
});

async function fetchPlaceDetailsBatch(
  placeIds: string,
  apiKey: string
): Promise<Map<string, GooglePlaceDetailsResult>> {
  const results = new Map<string, GooglePlaceDetailsResult>();

  const ids = placeIds.split("|");
  const batchSize = 10;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const placeIdParam = batch.join("|");

    const params = new URLSearchParams({
      place_id: placeIdParam,
      fields: "name,formatted_address,formatted_phone_number,website,rating,type,geometry",
      key: apiKey,
    });

    try {
      const url = `${PLACES_API_BASE}/details/json?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) continue;

      const data: GoogleDetailsResponse = await response.json();

      if (data.result) {
        results.set(batch[0], data.result);
      }
    } catch (err) {
      console.error("[places-api] fetchPlaceDetailsBatch error:", err);
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  return results;
}

export const getPlaceDetails = server$(async function (
  placeId: string
): Promise<Partial<PlaceResult> | null> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: "name,formatted_address,formatted_phone_number,website,rating,type,geometry",
      key: apiKey,
    });

    const url = `${PLACES_API_BASE}/details/json?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data: GoogleDetailsResponse = await response.json();

    if (data.status !== "OK" || !data.result) {
      return null;
    }

    const result = data.result;
    return {
      name: result.name,
      address: result.formatted_address,
      rating: result.rating ?? null,
      category: categoryFromTypes(result.types),
      phone: result.formatted_phone_number || "",
      email: "",
      website: result.website || "",
      rootDomain: result.website ? extractRootDomain(result.website) : "",
      coordinates: result.geometry?.location
        ? { lat: result.geometry.location.lat, lng: result.geometry.location.lng }
        : null,
      placeUrl: result.url || `https://www.google.com/maps/place/?q=place_id:${placeId}`,
      city: extractCityFromAddress(result.formatted_address || ""),
    };
  } catch (err) {
    console.error("[places-api] getPlaceDetails error:", err);
    return null;
  }
});

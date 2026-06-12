export interface PlaceResult {
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number | null;
  category: string;
  phone: string;
  email: string;
  website: string;
  rootDomain: string;
  coordinates: { lat: number; lng: number } | null;
  placeUrl: string;
  city: string;
  filteredCategory: string;
  keyword: string;
}

export interface ScrapeResult {
  places: PlaceResult[];
  query: string;
  totalResults: number;
  error: string | null;
  status: "running" | "done" | "error";
  progress: string;
}
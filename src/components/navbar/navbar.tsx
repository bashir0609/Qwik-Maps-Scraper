import { component$ } from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

export const Navbar = component$(() => {
  const loc = useLocation();
  const isHome = loc.url.pathname === "/";
  const isDetails = loc.url.pathname.startsWith("/details");
  const isPlacesApi = loc.url.pathname.startsWith("/places-api");

  return (
    <nav class="navbar">
      <a href="/" class="navbar-brand">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        Maps Scraper Pro
        <span class="navbar-badge">v2.0</span>
      </a>
      <div class="navbar-links">
        <a href="/" class={`navbar-link${isHome ? " active" : ""}`}>Scraper</a>
        <a href="/places-api/" class={`navbar-link${isPlacesApi ? " active" : ""}`}>Places API</a>
        <a href="/details/" class={`navbar-link${isDetails ? " active" : ""}`}>URL Extractor</a>
      </div>
    </nav>
  );
});

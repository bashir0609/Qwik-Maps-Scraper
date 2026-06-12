import { component$, useSignal, $ } from "@builder.io/qwik";
import type { PlaceResult } from "../../types";

const copySvg = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z"/>
  </svg>
);

interface PlaceCardProps {
  place: PlaceResult;
  index: number;
  extractedEmails?: Record<string, string>;
  loadingEmails?: Record<string, boolean>;
  fetchDetailLoading?: Record<string, boolean>;
}

export const PlaceCard = component$(({ place, index, extractedEmails = {}, loadingEmails = {}, fetchDetailLoading = {} }: PlaceCardProps) => {
  const copiedCell = useSignal("");
  const stars = place.rating
    ? "★".repeat(Math.round(place.rating)) + "☆".repeat(5 - Math.round(place.rating))
    : "";

  const doCopy = $((text: string, cellId: string) => {
    navigator.clipboard.writeText(text);
    copiedCell.value = cellId;
    setTimeout(() => { copiedCell.value = ""; }, 1200);
  });

  const copyBtnClass = (cellId: string) => `copy-btn${copiedCell.value === cellId ? " copied" : ""}`;

  return (
    <div class="place-card" style={{ "--delay": `${index * 0.05}s` }}>
      <div class="place-card-header">
        <h3 class="place-name">{place.name}
          <button class={copyBtnClass("name")} onClick$={() => doCopy(place.name, "name")} title="Copy">{copySvg}</button>
        </h3>
        {place.rating && (
          <div class="place-rating">
            <span class="stars">{stars}</span>
            <span class="rating-value">{place.rating}</span>
            {place.reviewCount && (
              <span class="review-count">({place.reviewCount})</span>
            )}
          </div>
        )}
        {place.placeUrl && (!place.phone || !place.website) ? (
          fetchDetailLoading[place.placeUrl] ? (
            <span class="email-spinner" style="margin-top: 0.4rem;" />
          ) : (
            <button class="fetch-email-btn" data-fetch-detail={place.placeUrl} title="Extract details" style="margin-top: 0.4rem;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              Fetch Details
            </button>
          )
        ) : null}
      </div>

      {place.category && (
        <span class="place-category">{place.category}
          <button class={copyBtnClass("cat")} onClick$={() => doCopy(place.category, "cat")} title="Copy">{copySvg}</button>
        </span>
      )}

      {place.city && (
        <div class="place-detail">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span>{place.city}</span>
          <button class={copyBtnClass("city")} onClick$={() => doCopy(place.city, "city")} title="Copy">{copySvg}</button>
        </div>
      )}

      {place.filteredCategory && (
        <div class="place-detail">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7V4h16v3" />
            <path d="M9 20h6" />
            <path d="M12 4v16" />
          </svg>
          <span>{place.filteredCategory}</span>
          <button class={copyBtnClass("fcat")} onClick$={() => doCopy(place.filteredCategory, "fcat")} title="Copy">{copySvg}</button>
        </div>
      )}

      {place.keyword && (
        <span class="place-keyword">{place.keyword}
          <button class={copyBtnClass("kw")} onClick$={() => doCopy(place.keyword, "kw")} title="Copy">{copySvg}</button>
        </span>
      )}

      {place.address && (
        <div class="place-detail">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span>{place.address}</span>
          <button class={copyBtnClass("adr")} onClick$={() => doCopy(place.address, "adr")} title="Copy">{copySvg}</button>
        </div>
      )}

      {place.phone && (
        <div class="place-detail">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span>{place.phone}</span>
          <button class={copyBtnClass("ph")} onClick$={() => doCopy(place.phone, "ph")} title="Copy">{copySvg}</button>
        </div>
      )}

      {(() => {
        const email = place.email || extractedEmails[place.website] || "";
        if (email) {
          return (
            <div class="place-detail">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <a href={`mailto:${email.split(",")[0].trim()}`} class="place-link email-link">
                {email}
              </a>
              <button class={copyBtnClass("em")} onClick$={() => doCopy(email.split(",")[0].trim(), "em")} title="Copy">{copySvg}</button>
            </div>
          );
        }
        if (place.website && !loadingEmails[place.website]) {
          return (
            <div class="place-detail">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <button class="fetch-email-btn" data-fetch-email={place.website} title="Extract email from website">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                Fetch Email
              </button>
            </div>
          );
        }
        if (loadingEmails[place.website]) {
          return (
            <div class="place-detail">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <span class="email-spinner" />
            </div>
          );
        }
        return null;
      })()}

      {place.website && (
        <div class="place-detail">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <a href={place.website} target="_blank" rel="noopener noreferrer" class="place-link">
            {place.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
          </a>
          <button class={copyBtnClass("web")} onClick$={() => doCopy(place.website, "web")} title="Copy">{copySvg}</button>
        </div>
      )}

      {place.coordinates && (
        <div class="place-detail coordinates">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span>
            {place.coordinates.lat.toFixed(4)}, {place.coordinates.lng.toFixed(4)}
          </span>
        </div>
      )}

      {place.placeUrl && (
        <div class="place-detail">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          <a href={place.placeUrl} target="_blank" rel="noopener noreferrer" class="place-link">
            View on Maps
          </a>
        </div>
      )}
    </div>
  );
});
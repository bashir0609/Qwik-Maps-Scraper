import { component$, useSignal, $ } from "@builder.io/qwik";
import type { PlaceResult } from "../../types";

const copySvg = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path fill-rule="evenodd" d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z"/>
  </svg>
);

interface ResultsTableProps {
  places: PlaceResult[];
  pageSize?: number;
  extractedEmails?: Record<string, string>;
  loadingEmails?: Record<string, boolean>;
  fetchDetailLoading?: Record<string, boolean>;
}

export const ResultsTable = component$(({ places, pageSize = 50, extractedEmails = {}, loadingEmails = {}, fetchDetailLoading = {} }: ResultsTableProps) => {
  const currentPage = useSignal(1);
  const copiedCell = useSignal("");
  const totalPages = Math.max(1, Math.ceil(places.length / pageSize));
  if (currentPage.value > totalPages) currentPage.value = totalPages;

  const start = (currentPage.value - 1) * pageSize;
  const end = Math.min(start + pageSize, places.length);
  const pagePlaces = places.slice(start, end);

  const pages: number[] = [];
  const cp = currentPage.value;
  const tp = totalPages;
  if (tp <= 7) {
    for (let i = 1; i <= tp; i++) pages.push(i);
  } else {
    pages.push(1);
    if (cp > 3) pages.push(-1);
    for (let i = Math.max(2, cp - 1); i <= Math.min(tp - 1, cp + 1); i++) pages.push(i);
    if (cp < tp - 2) pages.push(-1);
    pages.push(tp);
  }

  const doCopy = $((text: string, cellId: string) => {
    navigator.clipboard.writeText(text);
    copiedCell.value = cellId;
    setTimeout(() => { copiedCell.value = ""; }, 1200);
  });

  const copyBtnClass = (cellId: string) => `copy-btn${copiedCell.value === cellId ? " copied" : ""}`;

  return (
    <div>
      <div class="results-table-wrapper">
        <table class="results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th></th>
              <th>Category</th>
              <th>Keyword</th>
              <th>City</th>
              <th>Filtered Category</th>
              <th>Rating</th>
              <th>Reviews</th>
              <th>Address</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Website</th>
              <th>Root Domain</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {pagePlaces.map((place, i) => {
              const idx = start + i;
              const email = place.email || extractedEmails[place.website] || "";
              return (
              <tr key={place.placeUrl || idx}>
                <td class="index-cell">{idx + 1}</td>
                <td class="name-cell">{place.name}
                  <button class={copyBtnClass(`name-${idx}`)} onClick$={() => doCopy(place.name, `name-${idx}`)} title="Copy">{copySvg}</button>
                </td>
                <td>
                  {place.placeUrl && (!place.phone || !place.website) ? (
                    fetchDetailLoading[place.placeUrl] ? (
                      <span class="email-spinner" />
                    ) : (
                      <button class="fetch-email-btn" data-fetch-detail={place.placeUrl} title="Extract details">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        Details
                      </button>
                    )
                  ) : null}
                </td>
                <td>{place.category}
                  {place.category ? <button class={copyBtnClass(`cat-${idx}`)} onClick$={() => doCopy(place.category, `cat-${idx}`)} title="Copy">{copySvg}</button> : null}
                </td>
                <td>{place.keyword || "\u2014"}
                  {place.keyword ? <button class={copyBtnClass(`kw-${idx}`)} onClick$={() => doCopy(place.keyword, `kw-${idx}`)} title="Copy">{copySvg}</button> : null}
                </td>
                <td>{place.city || "\u2014"}
                  {place.city ? <button class={copyBtnClass(`city-${idx}`)} onClick$={() => doCopy(place.city, `city-${idx}`)} title="Copy">{copySvg}</button> : null}
                </td>
                <td>{place.filteredCategory || "\u2014"}
                  {place.filteredCategory ? <button class={copyBtnClass(`fcat-${idx}`)} onClick$={() => doCopy(place.filteredCategory, `fcat-${idx}`)} title="Copy">{copySvg}</button> : null}
                </td>
                <td class="rating-cell">
                  {place.rating ? (
                    <span class="table-rating">{place.rating}</span>
                  ) : (
                    <span class="no-data">&mdash;</span>
                  )}
                </td>
                <td>
                  {place.reviewCount ? place.reviewCount.toLocaleString() : "\u2014"}
                </td>
                <td class="address-cell">{place.address}
                  {place.address ? <button class={copyBtnClass(`adr-${idx}`)} onClick$={() => doCopy(place.address, `adr-${idx}`)} title="Copy">{copySvg}</button> : null}
                </td>
                <td>{place.phone || "\u2014"}
                  {place.phone ? <button class={copyBtnClass(`ph-${idx}`)} onClick$={() => doCopy(place.phone, `ph-${idx}`)} title="Copy">{copySvg}</button> : null}
                </td>
                <td>
                  {(() => {
                    if (email) {
                      return (
                        <>
                          <a href={`mailto:${email.split(",")[0].trim()}`} class="place-link email-link">{email}</a>
                          <button class={copyBtnClass(`em-${idx}`)} onClick$={() => doCopy(email.split(",")[0].trim(), `em-${idx}`)} title="Copy">{copySvg}</button>
                        </>
                      );
                    }
                    if (place.website && !loadingEmails[place.website]) {
                      return (
                        <button class="fetch-email-btn" data-fetch-email={place.website} title="Extract email from website">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                          Fetch
                        </button>
                      );
                    }
                    if (loadingEmails[place.website]) {
                      return <span class="email-spinner" />;
                    }
                    return "\u2014";
                  })()}
                </td>
                <td>
                  {place.website ? (
                    <>
                      <a href={place.website} target="_blank" rel="noopener noreferrer" class="place-link">
                        {place.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").substring(0, 30)}
                      </a>
                      <button class={copyBtnClass(`web-${idx}`)} onClick$={() => doCopy(place.website, `web-${idx}`)} title="Copy">{copySvg}</button>
                    </>
                  ) : (
                    "\u2014"
                  )}
                </td>
                <td>{place.rootDomain || "\u2014"}</td>
                <td>
                  {place.placeUrl ? (
                    <a href={place.placeUrl} target="_blank" rel="noopener noreferrer" class="place-link">
                      Maps
                    </a>
                  ) : (
                    "\u2014"
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {places.length > pageSize && (
        <div class="pagination">
          <button
            class="page-btn"
            disabled={currentPage.value <= 1}
            onClick$={() => { if (currentPage.value > 1) currentPage.value--; }}
          >
            &lsaquo; Prev
          </button>
          {pages.map((p) =>
            p === -1 ? (
              <span class="page-ellipsis" key="ellipsis">&hellip;</span>
            ) : (
              <button
                key={p}
                class={`page-num ${p === currentPage.value ? "active" : ""}`}
                onClick$={() => { currentPage.value = p; }}
              >
                {p}
              </button>
            )
          )}
          <button
            class="page-btn"
            disabled={currentPage.value >= totalPages}
            onClick$={() => { if (currentPage.value < totalPages) currentPage.value++; }}
          >
            Next &rsaquo;
          </button>
          <span class="page-info-inline">
            {start + 1}&ndash;{end} of {places.length}
          </span>
        </div>
      )}
    </div>
  );
});
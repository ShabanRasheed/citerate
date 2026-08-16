/**
 * Query table: filter, sort, expand. All client-side over rows that are already
 * in the DOM — 500 rows is small, and a filter that costs a round trip stops
 * being used. Row detail is the only fetch, and it is cached after the first open.
 */
const rowsOf = (table) => [...table.querySelectorAll("tr[data-row]")];

export default function table() {
  const table = document.querySelector("[data-query-table]");
  if (!table) return;

  const state = { text: "", cause: "", cluster: "", sort: "rate", dir: "asc" };
  const count = table.querySelector("[data-row-count]");

  const apply = () => {
    const rows = rowsOf(table);
    let shown = 0;

    rows.forEach((row) => {
      const matchText = !state.text || row.querySelector(".dt__q")?.textContent.toLowerCase().includes(state.text);
      const matchCause = !state.cause || row.dataset.cause === state.cause;
      const matchCluster = !state.cluster || row.dataset.cluster === state.cluster;
      const visible = matchText && matchCause && matchCluster;
      row.hidden = !visible;
      if (visible) shown += 1;

      // A detail row follows its parent's visibility.
      const detail = row.nextElementSibling;
      if (detail?.dataset.detailRow !== undefined) detail.hidden = !visible;
    });

    if (count) count.textContent = `${shown} of ${rows.length} queries`;
  };

  const sort = (key) => {
    const body = table.querySelector("tbody");
    if (!body) return;
    const dir = state.sort === key && state.dir === "asc" ? "desc" : "asc";
    state.sort = key;
    state.dir = dir;

    const rows = rowsOf(table);
    rows.sort((a, b) => {
      const read = (row) => {
        switch (key) {
          case "text": return row.querySelector(".dt__q")?.textContent.trim().toLowerCase() ?? "";
          case "cluster": return row.dataset.cluster ?? "";
          case "cause": return row.dataset.cause ?? "";
          case "rank": return Number(row.dataset.rank);
          case "runs": return Number(row.dataset.runs);
          default: return Number(row.dataset.rate);
        }
      };
      const av = read(a);
      const bv = read(b);
      const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });

    rows.forEach((row) => {
      const detail = row.nextElementSibling?.dataset?.detailRow !== undefined ? row.nextElementSibling : null;
      body.appendChild(row);
      if (detail) body.appendChild(detail);
    });

    table.querySelectorAll("th[data-sort]").forEach((th) => {
      th.setAttribute("aria-sort", th.dataset.sort === key ? (dir === "asc" ? "ascending" : "descending") : "none");
    });
  };

  table.querySelector("[data-filter]")?.addEventListener("input", (e) => {
    state.text = e.target.value.trim().toLowerCase();
    apply();
  });

  table.querySelector("[data-cluster-filter]")?.addEventListener("change", (e) => {
    state.cluster = e.target.value;
    apply();
  });

  table.querySelectorAll("[data-cause-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.cause = button.dataset.causeFilter;
      table.querySelectorAll("[data-cause-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      apply();
    });
  });

  table.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => sort(th.dataset.sort));
  });

  // The cause bar broadcasts filters; the table listens.
  document.addEventListener("citerate:filter", (e) => {
    state.cause = e.detail?.cause ?? "";
    apply();
  });

  // Row detail.
  const template = document.getElementById("row-detail-template");
  table.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-expand]");
    if (!button || !template) return;

    const row = button.closest("tr[data-row]");
    const queryId = button.dataset.expand;
    const open = button.getAttribute("aria-expanded") === "true";

    if (open) {
      row.nextElementSibling?.remove();
      button.setAttribute("aria-expanded", "false");
      row.dataset.open = "false";
      return;
    }

    const detail = template.content.cloneNode(true).firstElementChild;
    detail.id = `detail-${queryId}`;
    row.after(detail);
    button.setAttribute("aria-expanded", "true");
    row.dataset.open = "true";

    try {
      const res = await fetch(`/api/queries/${queryId}/evidence`, { headers: { accept: "application/json" } });
      const data = await res.json();
      detail.querySelector("[data-evidence]").innerHTML = render(data);
    } catch {
      detail.querySelector("[data-evidence]").textContent = "Could not load evidence. Reload and try again.";
    }
  });

  const render = (data) => {
    const engines = (data.observations || [])
      .map(
        (o) => `<div class="evidence__item">
          <span class="engine__name">${o.engine}</span>
          <span class="engine__rate">${Math.round(o.citation_rate * 100)}%</span>
          <span class="chart__note">${o.cited_runs}/${o.runs} runs${
            o.mention_runs ? ` · ${o.mention_runs} unlinked mention` : ""
          }</span>
          <span class="chart__note">organic ${o.organic_rank ? `#${o.organic_rank}` : "—"} · AIO ${
            o.aio_present ? "present" : "none"
          } · tech ${o.tech_pass ? "pass" : "fail"}</span>
        </div>`
      )
      .join("");

    const cited = (data.citations || [])
      .slice(0, 6)
      .map(
        (c) => `<div class="evidence__item">
          <span class="chart__note">run ${c.run_index + 1}${c.is_subject ? " · you" : ""}</span>
          <span class="t-data">${c.hostname}</span>
          ${c.excerpt ? `<span class="chart__note">“${c.excerpt}”</span>` : ""}
        </div>`
      )
      .join("");

    return engines + cited || '<span class="chart__note">No observations recorded for this query yet.</span>';
  };

  sort("rate");
  apply();
}

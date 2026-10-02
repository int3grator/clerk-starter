import { api, ApiError, errorMessage, query, tokenStore } from "./api.js";
import { closeDrawer, initDrawer, openDrawer } from "./drawer.js";
import { openRole } from "./chart-views.js";
import { actions as viewActions, views } from "./views.js";
import { esc, ROLE_LABELS } from "./util.js";

const CHART_KEY = "skalx-selected-chart";
const $ = (id) => document.getElementById(id);

const state = {
  session: null,
  charts: [],
  chartId: null,
  draft: null,
  viewing: null,
  view: "org",
  phaseId: null,
  query: "",
  onlyChanges: false,
};

let noticeTimer = null;

const ctx = {
  state,
  api,
  query,
  errorMessage,
  openDrawer,
  closeDrawer,
  document: () => state.viewing?.document ?? state.draft?.document ?? null,
  isReadOnly: () => Boolean(state.viewing),
  hasRole: (...roles) => roles.includes(state.session?.accessRole),
  canEdit: () => !state.viewing && Boolean(state.draft) && ["owner", "editor"].includes(state.session?.accessRole),
  render: () => render(),
  notify: (message, isError = false) => notify(message, isError),
  handleError: (error) => handleError(error),
  openRole: (roleId) => openRole(ctx, roleId),
  changeDraft: (path, options, message) => changeDraft(path, options, message),
  saveDocument: (mutate, message) => saveDocument(mutate, message),
  reloadDraft: () => reloadDraft(),
  // Shows an immutable version in the chart and table views without editing controls.
  viewVersion(version, snapshot) {
    state.viewing = { ...version, document: snapshot };
    state.view = "org";
    closeDrawer();
    render();
  },
  showDraft() {
    state.viewing = null;
    render();
  },
};

function notify(message, isError = false) {
  const box = $("notice");
  box.innerHTML = `<div class="${isError ? "err" : ""}">${esc(message)}</div>`;
  box.hidden = false;
  clearTimeout(noticeTimer);
  if (!isError) noticeTimer = setTimeout(() => { box.hidden = true; }, 5000);
}

// The server rejected a stale revision token. Local form input stays open until the user reloads.
function showConflict() {
  const box = $("notice");
  clearTimeout(noticeTimer);
  box.innerHTML = `<div class="err">Ciorna a fost modificată în altă sesiune. Modificarea ta nu a fost salvată, iar formularul a rămas deschis. <button class="btn" type="button" data-action="reload-draft">Reîncarcă ciorna</button></div>`;
  box.hidden = false;
}

function handleError(error) {
  if (error instanceof ApiError && error.status === 401) {
    signOutLocally("Sesiunea a expirat. Autentifică-te din nou.", true);
    return;
  }
  if (error instanceof ApiError && error.code === "aborted") {
    showConflict();
    return;
  }
  notify(errorMessage(error), true);
}

async function changeDraft(path, options = {}, successMessage = "Ciorna a fost actualizată.") {
  if (!state.draft) return false;
  const method = options.method ?? "POST";
  const params = { ...(options.params ?? {}) };
  let body;
  if (method === "DELETE") params.revisionToken = state.draft.revisionToken;
  else body = { ...(options.body ?? {}), revisionToken: state.draft.revisionToken };
  try {
    state.draft = await api(path + query(params), { method, body });
    notify(successMessage);
    render();
    return true;
  } catch (error) {
    handleError(error);
    return false;
  }
}

function saveDocument(mutate, successMessage) {
  if (!state.draft) return Promise.resolve(false);
  const next = structuredClone(state.draft.document);
  mutate(next);
  return changeDraft(`/charts/${state.chartId}/draft`, { method: "PUT", body: { document: next } }, successMessage);
}

async function reloadDraft() {
  if (!state.chartId) return;
  try {
    state.draft = await api(`/charts/${state.chartId}/draft`);
    $("notice").hidden = true;
    render();
  } catch (error) {
    handleError(error);
  }
}

async function selectChart(chartId) {
  state.chartId = chartId;
  state.draft = null;
  state.viewing = null;
  if (chartId) localStorage.setItem(CHART_KEY, chartId);
  else localStorage.removeItem(CHART_KEY);
  closeDrawer();
  render();
  if (chartId) await reloadDraft();
}

async function loadCharts(preferredId) {
  try {
    const { charts } = await api("/charts");
    state.charts = charts;
    const wanted = preferredId ?? localStorage.getItem(CHART_KEY);
    await selectChart(charts.find((chart) => chart.id === wanted)?.id ?? charts[0]?.id ?? null);
  } catch (error) {
    handleError(error);
  }
}

function renderHeader() {
  const doc = ctx.document();
  const chart = state.charts.find((entry) => entry.id === state.chartId);
  $("chart-select").innerHTML = state.charts
    .map((entry) => `<option value="${esc(entry.id)}"${entry.id === state.chartId ? " selected" : ""}>${esc(entry.name)}</option>`)
    .join("");
  $("chart-picker").hidden = state.charts.length === 0;
  $("new-chart").hidden = !ctx.hasRole("owner", "editor");
  $("chart-title").textContent = chart?.name ?? "SkalX Org Designer";
  if (doc) {
    const active = doc.roles.filter((role) => role.changeStatus !== "merged").length;
    $("lede").textContent = `Arhitectură țintă: ${doc.divisions.length} divizii, ${active} roluri. Apasă pe orice rol pentru detalii.`;
  } else {
    $("lede").textContent = state.charts.length > 0 ? "" : "Nu există încă nicio organigramă.";
  }
  $("tagline").textContent = doc?.tagline ?? "";
  $("tagline").hidden = !doc?.tagline;

  const banner = $("readonly-banner");
  banner.hidden = !state.viewing;
  if (state.viewing) {
    const status = state.viewing.statusLabel ?? state.viewing.status ?? "";
    banner.innerHTML = `<div class="warn">Vezi versiunea ${esc(state.viewing.number)}${status ? ` (${esc(status)})` : ""} în modul doar citire. <button class="btn" type="button" data-action="show-draft">Înapoi la ciornă</button></div>`;
  }
}

function renderToolbar(visible, active) {
  $("views").innerHTML = visible
    .map((view) => `<button type="button" data-view="${view.id}" aria-pressed="${view.id === state.view}">${esc(view.label)}</button>`)
    .join("");
  const doc = ctx.document();
  if (doc && !doc.phases.some((phase) => phase.id === state.phaseId)) state.phaseId = doc.phases.at(-1)?.id ?? null;
  const filters = Boolean(active?.usesFilters && doc);
  $("phase-group").hidden = !filters;
  $("q").hidden = !filters;
  $("only-wrap").hidden = !filters;
  $("phases").innerHTML = doc
    ? doc.phases
        .map((phase, index) => `<button type="button" data-phase="${esc(phase.id)}" aria-pressed="${phase.id === state.phaseId}"${phase.description ? ` title="${esc(phase.description)}"` : ""}>${index + 1} ${esc(phase.name)}</button>`)
        .join("")
    : "";
}

function emptyChartState() {
  if (state.chartId && !state.draft) return `<div class="empty">Se încarcă organigrama…</div>`;
  if (ctx.hasRole("owner", "editor")) {
    return `<div class="empty">Nu există încă nicio organigramă.<br><button class="btn primary" type="button" data-action="new-chart">Creează prima organigramă</button></div>`;
  }
  return `<div class="empty">Nu există încă nicio organigramă. Cere unui Editor sau Owner să creeze una.</div>`;
}

function renderSections(visible, active) {
  const workspace = $("workspace");
  for (const view of views) {
    let section = $(`v-${view.id}`);
    if (!section) {
      section = document.createElement("section");
      section.className = "view";
      section.id = `v-${view.id}`;
      section.setAttribute("aria-label", view.label);
      workspace.append(section);
    }
    const isActive = view === active;
    section.classList.toggle("on", isActive);
    if (!visible.includes(view)) {
      section.innerHTML = "";
      continue;
    }
    if (!isActive && !view.renderAlways) continue;
    if (view.needsChart && !ctx.document()) {
      section.innerHTML = isActive ? emptyChartState() : "";
      continue;
    }
    view.render(ctx, section);
  }
}

function render() {
  if (!state.session) return;
  const visible = views.filter((view) => view.visible(ctx));
  if (!visible.some((view) => view.id === state.view)) state.view = visible[0]?.id ?? "org";
  const active = visible.find((view) => view.id === state.view);
  renderHeader();
  renderToolbar(visible, active);
  renderSections(visible, active);
}

function showSignIn(message = "", isError = false) {
  $("app").hidden = true;
  $("sign-in").hidden = false;
  const box = $("sign-in-message");
  box.textContent = message;
  box.className = `form-message${isError ? " error" : ""}`;
  $("username").focus();
}

async function enterApp() {
  $("sign-in").hidden = true;
  $("app").hidden = false;
  $("session-label").textContent = `${state.session.username} · ${ROLE_LABELS[state.session.accessRole] ?? state.session.accessRole}`;
  render();
  await loadCharts();
}

function signOutLocally(message, isError = false) {
  tokenStore.clear();
  Object.assign(state, { session: null, charts: [], chartId: null, draft: null, viewing: null });
  closeDrawer();
  showSignIn(message, isError);
}

function openNewChartForm() {
  if (!ctx.hasRole("owner", "editor")) return;
  openDrawer(
    `<h2 id="d-title">Organigramă nouă</h2>
<form class="form" id="new-chart-form">
<label class="field">Nume<input name="name" required maxlength="120" autofocus></label>
<div class="inline"><button class="btn primary" type="submit">Creează organigrama</button><button class="btn" type="button" data-close-drawer>Renunță</button></div>
</form>`,
    (drawer) => {
      drawer.querySelector("#new-chart-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = String(new FormData(event.target).get("name") ?? "").trim();
        try {
          const draft = await api("/charts", { method: "POST", body: { name } });
          closeDrawer();
          notify("Organigrama a fost creată.");
          await loadCharts(draft.chartId);
        } catch (error) {
          handleError(error);
        }
      });
    },
  );
}

const ownActions = {
  "new-chart": () => openNewChartForm(),
  "reload-draft": () => reloadDraft(),
  "show-draft": () => ctx.showDraft(),
};

function bindEvents() {
  initDrawer();

  $("sign-in-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("sign-in-message").textContent = "";
    try {
      const result = await api("/auth/sign-in", {
        method: "POST",
        auth: false,
        body: { username: $("username").value, password: $("password").value },
      });
      tokenStore.set(result.sessionToken);
      state.session = result.session;
      $("password").value = "";
      await enterApp();
    } catch (error) {
      showSignIn(errorMessage(error), true);
    }
  });

  $("sign-out").addEventListener("click", async () => {
    try {
      await api("/auth/sign-out", { method: "POST" });
    } catch {
      // The local token is removed below even if the server is unreachable.
    }
    signOutLocally("Te-ai deconectat.");
  });

  $("chart-select").addEventListener("change", (event) => selectChart(event.target.value));
  $("q").addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });
  $("only").addEventListener("change", (event) => {
    state.onlyChanges = event.target.checked;
    render();
  });

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      state.view = viewButton.dataset.view;
      render();
      return;
    }
    const phaseButton = event.target.closest("[data-phase]");
    if (phaseButton) {
      state.phaseId = phaseButton.dataset.phase;
      render();
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const handler = ownActions[actionButton.dataset.action] ?? viewActions[actionButton.dataset.action];
      if (handler) {
        event.preventDefault();
        handler(ctx, actionButton, event);
      }
      return;
    }
    const roleButton = event.target.closest("[data-role]");
    if (roleButton) ctx.openRole(roleButton.dataset.role);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches?.("tr[data-role]")) ctx.openRole(event.target.dataset.role);
  });
}

async function boot() {
  bindEvents();
  if (!tokenStore.get()) {
    showSignIn();
    return;
  }
  try {
    state.session = await api("/auth/session");
    await enterApp();
  } catch {
    tokenStore.clear();
    showSignIn();
  }
}

boot();

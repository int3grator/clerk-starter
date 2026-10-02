import { esc, lines, uid } from "./util.js";
import { CHANGE_LABELS, childrenOf, descendants } from "./model.js";

function canEdit(ctx) {
  if (ctx.canEdit()) return true;
  ctx.notify("Rolul tău de acces nu permite editarea ciornei.", true);
  return false;
}

function roleOptions(doc, selectedId, excluded, emptyLabel) {
  const options = doc.roles
    .filter((role) => !excluded.has(role.id))
    .map((role) => `<option value="${esc(role.id)}"${role.id === selectedId ? " selected" : ""}>${esc(role.title)}</option>`);
  return `<option value="">${esc(emptyLabel)}</option>${options.join("")}`;
}

function optionalValue(data, name) {
  const value = String(data.get(name) ?? "").trim();
  return value || undefined;
}

export function openRoleEditor(ctx, roleId, managerId) {
  if (!canEdit(ctx)) return;
  const doc = ctx.state.draft.document;
  const existing = roleId ? doc.roles.find((role) => role.id === roleId) : undefined;
  if (roleId && !existing) {
    ctx.notify("Rolul nu mai există în ciornă.", true);
    return;
  }
  const manager = managerId ? doc.roles.find((role) => role.id === managerId) : undefined;
  const role = existing ?? {
    id: uid(),
    title: "",
    divisionId: manager?.divisionId ?? doc.divisions[0]?.id ?? "",
    managerRoleId: manager?.id,
    responsibilities: [],
    deliverable: "",
    keyPerformanceIndicators: [],
    dedicatedPhaseId: doc.phases[0]?.id,
  };
  // A role cannot report to itself or to one of its own reports.
  const excluded = existing ? new Set([existing.id, ...descendants(doc, existing.id)]) : new Set();
  const divisionOptions = doc.divisions
    .map((division) => `<option value="${esc(division.id)}"${division.id === role.divisionId ? " selected" : ""}>${esc(division.name)}</option>`)
    .join("");
  const phaseOptions = doc.phases
    .map((phase, index) => `<option value="${esc(phase.id)}"${phase.id === role.dedicatedPhaseId ? " selected" : ""}>${index + 1}. ${esc(phase.name)}</option>`)
    .join("");
  const statusOptions = Object.entries(CHANGE_LABELS)
    .map(([value, label]) => `<option value="${value}"${value === role.changeStatus ? " selected" : ""}>${label}</option>`)
    .join("");

  ctx.openDrawer(
    `<h2 id="d-title">${existing ? `Editează ${esc(role.title)}` : "Rol nou"}</h2>
<form class="form" id="role-form">
<label class="field">Denumire<input name="title" value="${esc(role.title)}" required maxlength="160" autofocus></label>
<div class="row2"><label class="field">Denumire completă în engleză<input name="englishTitle" value="${esc(role.englishTitle ?? "")}"></label><label class="field">Denumire în română<input name="localTitle" value="${esc(role.localTitle ?? "")}"></label></div>
<div class="row2"><label class="field">Divizie<select name="divisionId" required>${divisionOptions}</select></label><label class="field">Raportează la<select name="managerRoleId">${roleOptions(doc, role.managerRoleId, excluded, "Fără manager (rol rădăcină)")}</select></label></div>
<label class="field">Rezultat livrat<textarea name="deliverable" rows="2">${esc(role.deliverable)}</textarea></label>
<label class="field">Rol și responsabilități<textarea name="responsibilities" rows="5">${esc(role.responsibilities.join("\n"))}</textarea><span class="hint">Câte o responsabilitate pe rând.</span></label>
<label class="field">KPI<textarea name="keyPerformanceIndicators" rows="5">${esc(role.keyPerformanceIndicators.join("\n"))}</textarea><span class="hint">Câte un KPI pe rând. Recomandat: cel mult ${doc.lintConfig.maxKeyPerformanceIndicators}.</span></label>
<div class="row2"><label class="field">Rol dedicat din faza<select name="dedicatedPhaseId">${phaseOptions}</select></label><label class="field">Acoperit până atunci de<select name="coveringRoleId">${roleOptions(doc, role.coveringRoleId, new Set([role.id]), "Niciun rol din organigramă")}</select></label></div>
<label class="field">Notă de acoperire<input name="coverageNote" value="${esc(role.coverageNote ?? "")}" placeholder="De exemplu: avocat extern"></label>
<div class="row2"><label class="field">Status modificare<select name="changeStatus"><option value="">Fără status</option>${statusOptions}</select></label><label class="field">Notă despre modificare<input name="changeNote" value="${esc(role.changeNote ?? "")}"></label></div>
<div class="inline"><button class="btn primary" type="submit">Salvează în ciornă</button><button class="btn" type="button" data-close-drawer>Renunță</button></div>
</form>`,
    (drawer) => {
      drawer.querySelector("#role-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(event.target);
        const updated = {
          id: role.id,
          title: String(data.get("title") ?? "").trim(),
          englishTitle: optionalValue(data, "englishTitle"),
          localTitle: optionalValue(data, "localTitle"),
          divisionId: String(data.get("divisionId") ?? ""),
          managerRoleId: optionalValue(data, "managerRoleId"),
          responsibilities: lines(data.get("responsibilities")),
          deliverable: String(data.get("deliverable") ?? "").trim(),
          keyPerformanceIndicators: lines(data.get("keyPerformanceIndicators")),
          dedicatedPhaseId: optionalValue(data, "dedicatedPhaseId"),
          coveringRoleId: optionalValue(data, "coveringRoleId"),
          coverageNote: optionalValue(data, "coverageNote"),
          changeStatus: optionalValue(data, "changeStatus"),
          changeNote: optionalValue(data, "changeNote"),
        };
        if (!updated.title) {
          ctx.notify("Denumirea rolului este obligatorie.", true);
          return;
        }
        const saved = await ctx.saveDocument((document) => {
          const index = document.roles.findIndex((entry) => entry.id === updated.id);
          if (index >= 0) document.roles[index] = updated;
          else document.roles.push(updated);
        }, existing ? "Rolul a fost actualizat în ciornă." : "Rolul a fost adăugat în ciornă.");
        if (saved) ctx.openRole(updated.id);
      });
    },
  );
}

export async function deleteRole(ctx, roleId) {
  if (!canEdit(ctx)) return;
  const doc = ctx.state.draft.document;
  const role = doc.roles.find((entry) => entry.id === roleId);
  if (!role) return;
  const blockers = [];
  const reports = childrenOf(doc, roleId);
  if (reports.length > 0) blockers.push(`are ${reports.length} subordonați direcți`);
  const owned = doc.divisions.filter((division) => division.ownerRoleId === roleId);
  if (owned.length > 0) blockers.push(`este owner pentru ${owned.map((division) => division.name).join(", ")}`);
  const covered = doc.roles.filter((entry) => entry.coveringRoleId === roleId);
  if (covered.length > 0) blockers.push(`acoperă ${covered.map((entry) => entry.title).join(", ")}`);
  if (blockers.length > 0) {
    ctx.notify(`Rolul „${role.title}” nu poate fi șters: ${blockers.join("; ")}. Mută aceste legături înainte de ștergere.`, true);
    return;
  }
  if (!window.confirm(`Ștergi rolul „${role.title}” din ciornă?`)) return;
  const saved = await ctx.saveDocument((document) => {
    document.roles = document.roles.filter((entry) => entry.id !== roleId);
  }, "Rolul a fost șters din ciornă.");
  if (saved) ctx.closeDrawer();
}

export function openDivisionList(ctx) {
  if (!canEdit(ctx)) return;
  const doc = ctx.state.draft.document;
  const items = doc.divisions
    .map((division) => {
      const owner = doc.roles.find((role) => role.id === division.ownerRoleId);
      const count = doc.roles.filter((role) => role.divisionId === division.id).length;
      return `<li><b>${esc(division.name)}</b><br><span class="small">Owner: ${esc(owner?.title ?? "fără owner")} · ${count} roluri</span><br><button class="linkbtn" type="button" data-action="edit-division" data-division="${esc(division.id)}">Editează</button></li>`;
    })
    .join("");
  ctx.openDrawer(`<h2 id="d-title">Diviziile</h2><ul class="chg-list">${items || "<li>Nu există divizii.</li>"}</ul><div class="edit-bar drawer-actions"><button class="btn primary" type="button" data-action="add-division">Adaugă divizie</button></div>`);
}

export function openDivisionEditor(ctx, divisionId) {
  if (!canEdit(ctx)) return;
  const doc = ctx.state.draft.document;
  const existing = divisionId ? doc.divisions.find((division) => division.id === divisionId) : undefined;
  const division = existing ?? { id: uid(), name: "" };
  const deleteButton = existing
    ? `<button class="btn danger" type="button" data-action="delete-division" data-division="${esc(division.id)}">Șterge divizia</button>`
    : "";
  ctx.openDrawer(
    `<h2 id="d-title">${existing ? `Editează divizia ${esc(division.name)}` : "Divizie nouă"}</h2>
<form class="form" id="division-form">
<label class="field">Nume<input name="name" value="${esc(division.name)}" required maxlength="120" autofocus></label>
<label class="field">Owner<select name="ownerRoleId">${roleOptions(doc, division.ownerRoleId, new Set(), "Fără owner")}</select><span class="hint">Owner-ul este rolul executiv care conduce divizia.</span></label>
<label class="field">Agenți AI în divizie<textarea name="aiAgents" rows="2">${esc(division.aiAgents ?? "")}</textarea></label>
<div class="inline"><button class="btn primary" type="submit">Salvează în ciornă</button>${deleteButton}<button class="btn" type="button" data-close-drawer>Renunță</button></div>
</form>`,
    (drawer) => {
      drawer.querySelector("#division-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(event.target);
        const updated = {
          id: division.id,
          name: String(data.get("name") ?? "").trim(),
          ownerRoleId: optionalValue(data, "ownerRoleId"),
          aiAgents: optionalValue(data, "aiAgents"),
        };
        if (!updated.name) {
          ctx.notify("Numele diviziei este obligatoriu.", true);
          return;
        }
        const saved = await ctx.saveDocument((document) => {
          const index = document.divisions.findIndex((entry) => entry.id === updated.id);
          if (index >= 0) document.divisions[index] = updated;
          else document.divisions.push(updated);
        }, existing ? "Divizia a fost actualizată în ciornă." : "Divizia a fost adăugată în ciornă.");
        if (saved) openDivisionList(ctx);
      });
    },
  );
}

export async function deleteDivision(ctx, divisionId) {
  if (!canEdit(ctx)) return;
  const doc = ctx.state.draft.document;
  const division = doc.divisions.find((entry) => entry.id === divisionId);
  if (!division) return;
  const members = doc.roles.filter((role) => role.divisionId === divisionId).length;
  if (members > 0) {
    ctx.notify(`Divizia „${division.name}” are ${members} roluri. Mută sau șterge rolurile înainte de ștergere.`, true);
    return;
  }
  if (!window.confirm(`Ștergi divizia „${division.name}” din ciornă?`)) return;
  const saved = await ctx.saveDocument((document) => {
    document.divisions = document.divisions.filter((entry) => entry.id !== divisionId);
  }, "Divizia a fost ștearsă din ciornă.");
  if (saved) openDivisionList(ctx);
}

export const actions = {
  "add-role": (ctx, element) => openRoleEditor(ctx, null, element.dataset.manager),
  "edit-role": (ctx, element) => openRoleEditor(ctx, element.dataset.roleId),
  "delete-role": (ctx, element) => deleteRole(ctx, element.dataset.roleId),
  "add-division": (ctx) => openDivisionEditor(ctx, null),
  "edit-division": (ctx, element) => openDivisionEditor(ctx, element.dataset.division),
  "delete-division": (ctx, element) => deleteDivision(ctx, element.dataset.division),
  "list-divisions": (ctx) => openDivisionList(ctx),
};

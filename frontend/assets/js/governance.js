import { esc, lines } from "./util.js";
import { badge } from "./chart-views.js";
import { isMerged, phasePosition, rolesInDivisionOrder } from "./model.js";

const TYPE_LABELS = {
  principle: "Principiu",
  ownershipMatrix: "Matrice de responsabilitate",
  cycle: "Ciclu",
  processFlow: "Flux de proces",
};

// The phase that an Owner wants to delete. Its roles are flagged in the coverage matrix until remapping.
let pendingPhaseDeletion = null;

const chartPath = (ctx, suffix = "") => `/charts/${encodeURIComponent(ctx.state.chartId)}${suffix}`;

function deniedForEditor(ctx) {
  if (ctx.canEdit()) return false;
  ctx.notify("Rolul tău de acces nu permite editarea ciornei.", true);
  return true;
}

function deniedForOwner(ctx) {
  if (ctx.canEdit() && ctx.hasRole("owner")) return false;
  ctx.notify("Doar un Owner poate modifica fazele.", true);
  return true;
}

// Same rule as the server: a rule without selected phases applies to every phase.
export function rulesForPhase(doc, phaseId) {
  return doc.rules.filter((rule) => rule.phaseIds.length === 0 || rule.phaseIds.includes(phaseId));
}

function phaseScope(doc, rule) {
  if (rule.phaseIds.length === 0) return "toate fazele";
  return rule.phaseIds
    .map((id) => {
      const index = doc.phases.findIndex((phase) => phase.id === id);
      return index < 0 ? null : `${index + 1}. ${doc.phases[index].name}`;
    })
    .filter(Boolean)
    .join(", ");
}

function paragraphs(text) {
  if (!text) return "";
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      const rows = lines(block);
      if (rows.length > 0 && rows.every((row) => /^[-•]\s+/.test(row))) {
        return `<ul>${rows.map((row) => `<li>${esc(row.replace(/^[-•]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      if (rows.length > 0 && rows.every((row) => /^\d+[.)]\s+/.test(row))) {
        return `<ol>${rows.map((row) => `<li>${esc(row.replace(/^\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
      }
      return `<p>${rows.map((row) => esc(row)).join("<br>")}</p>`;
    })
    .join("");
}

function ruleContent(rule) {
  if (rule.type === "principle") {
    return `${rule.statement ? `<p class="rule">${esc(rule.statement)}</p>` : ""}${paragraphs(rule.body)}`;
  }
  if (rule.type === "ownershipMatrix") {
    const columns = Math.max(1, Math.min(rule.ownership.length, 3));
    const cells = rule.ownership
      .map((column) => `<div><h4>${esc(column.owner)}</h4><ul>${column.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>`)
      .join("");
    return `<div class="split" style="grid-template-columns:repeat(${columns},1fr)">${cells}</div>${paragraphs(rule.body)}`;
  }
  if (rule.type === "cycle") {
    const columns = Math.max(1, Math.min(rule.stages.length, 4));
    const cells = rule.stages.map((stage) => `<div><b>${esc(stage.name)}</b><span>${esc(stage.owner)}</span></div>`).join("");
    return `<div class="cycle" style="grid-template-columns:repeat(${columns},1fr)">${cells}</div>${paragraphs(rule.body)}`;
  }
  if (rule.type === "processFlow") {
    const flows = rule.flows.map((flow) => `<div class="flow">${flow.steps.map((step) => `<span>${esc(step)}</span>`).join("<i>→</i>")}</div>`).join("");
    return `${paragraphs(rule.body)}${flows}`;
  }
  return paragraphs(rule.body);
}

function renderGovernance(ctx, section) {
  const doc = ctx.document();
  const editable = ctx.canEdit();
  const phaseIndex = doc.phases.findIndex((phase) => phase.id === ctx.state.phaseId);
  const phase = doc.phases[phaseIndex];
  const rules = rulesForPhase(doc, ctx.state.phaseId);
  const otherPhases = doc.rules.length - rules.length;
  const parts = [];
  if (editable) parts.push(`<div class="edit-bar"><button class="btn" type="button" data-action="add-rule">Adaugă regulă</button></div>`);
  if (phase) {
    const others = otherPhases > 0 ? ` ${otherPhases} reguli se aplică doar altor faze.` : "";
    parts.push(`<p class="small">Regulile pentru faza ${phaseIndex + 1}, ${esc(phase.name)}.${others}</p>`);
  }
  if (rules.length === 0) parts.push(`<div class="empty">Nu există reguli de guvernanță pentru faza selectată.</div>`);
  for (const rule of rules) {
    const tools = editable
      ? ` · <button class="linkbtn" type="button" data-action="edit-rule" data-rule="${esc(rule.id)}">editează</button> · <button class="linkbtn" type="button" data-action="delete-rule" data-rule="${esc(rule.id)}">șterge</button>`
      : "";
    parts.push(`<h2>${esc(rule.title)}</h2><p class="small gov-meta">${esc(TYPE_LABELS[rule.type] ?? rule.type)} · Se aplică în: ${esc(phaseScope(doc, rule))}${tools}</p>${ruleContent(rule)}`);
  }
  const changed = doc.roles.filter((role) => role.changeStatus);
  if (changed.length > 0) {
    const items = changed
      .map((role) => `<li>${badge(role)} <button type="button" data-role="${esc(role.id)}">${esc(role.title)}</button><br><span class="small">${esc(role.changeNote ?? "")}</span></li>`)
      .join("");
    parts.push(`<h2>Ce s-a schimbat (${changed.length})</h2><ul class="chg-list">${items}</ul>`);
  }
  section.innerHTML = `<div class="prose">${parts.join("")}</div>`;
}

function serializeOwnership(rule) {
  return rule.ownership.map((column) => [column.owner, ...column.items].join("\n")).join("\n\n");
}

function serializeStages(rule) {
  return rule.stages.map((stage) => (stage.owner ? `${stage.name} | ${stage.owner}` : stage.name)).join("\n");
}

function serializeFlows(rule) {
  return rule.flows.map((flow) => flow.steps.join(" → ")).join("\n");
}

function parseOwnership(text) {
  return String(text ?? "")
    .split(/\n\s*\n/)
    .map((block) => lines(block))
    .filter((rows) => rows.length > 0)
    .map(([owner, ...items]) => ({ owner, items }));
}

function parseStages(text) {
  return lines(text).map((line) => {
    const [name, ...owner] = line.split("|");
    return { name: name.trim(), owner: owner.join("|").trim() };
  });
}

function parseFlows(text) {
  return lines(text).map((line) => ({ steps: line.split(/\s*(?:→|->)\s*/).map((step) => step.trim()).filter(Boolean) }));
}

function openRuleEditor(ctx, ruleId) {
  if (deniedForEditor(ctx)) return;
  const doc = ctx.state.draft.document;
  const existing = ruleId ? doc.rules.find((rule) => rule.id === ruleId) : undefined;
  if (ruleId && !existing) {
    ctx.notify("Regula nu mai există în ciornă.", true);
    return;
  }
  const rule = existing ?? { type: "principle", title: "", ownership: [], stages: [], flows: [], phaseIds: [] };
  const typeOptions = Object.entries(TYPE_LABELS)
    .map(([value, label]) => `<option value="${value}"${value === rule.type ? " selected" : ""}>${label}</option>`)
    .join("");
  const phaseChecks = doc.phases
    .map((phase, index) => `<label class="chk"><input type="checkbox" name="phaseIds" value="${esc(phase.id)}"${rule.phaseIds.includes(phase.id) ? " checked" : ""}> ${index + 1}. ${esc(phase.name)}</label>`)
    .join("");

  ctx.openDrawer(
    `<h2 id="d-title">${existing ? "Editează regula" : "Regulă nouă"}</h2>
<form class="form" id="rule-form">
<div class="row2"><label class="field">Tip<select name="type">${typeOptions}</select></label><label class="field">Titlu<input name="title" value="${esc(rule.title)}" required maxlength="160" autofocus></label></div>
<fieldset class="field"><legend>Se aplică în fazele</legend><div class="checks">${phaseChecks}</div><span class="hint">Nicio fază bifată înseamnă toate fazele.</span></fieldset>
<label class="field" data-for="principle">Enunț<textarea name="statement" rows="3">${esc(rule.statement ?? "")}</textarea></label>
<label class="field" data-for="ownershipMatrix">Coloanele matricei<textarea name="ownership" rows="8">${esc(serializeOwnership(rule))}</textarea><span class="hint">Câte un bloc pentru fiecare owner, separat de un rând gol. Primul rând este owner-ul, rândurile următoare sunt responsabilitățile.</span></label>
<label class="field" data-for="cycle">Etapele ciclului<textarea name="stages" rows="5">${esc(serializeStages(rule))}</textarea><span class="hint">Câte o etapă pe rând, în formatul: Etapă | Owner.</span></label>
<label class="field" data-for="processFlow">Fluxuri<textarea name="flows" rows="4">${esc(serializeFlows(rule))}</textarea><span class="hint">Câte un flux pe rând, cu pașii separați prin →.</span></label>
<label class="field">Explicație<textarea name="body" rows="5">${esc(rule.body ?? "")}</textarea><span class="hint">Separă paragrafele cu un rând gol. Rândurile care încep cu „-” sau „1.” devin liste.</span></label>
<div class="inline"><button class="btn primary" type="submit">Salvează în ciornă</button><button class="btn" type="button" data-close-drawer>Renunță</button></div>
</form>`,
    (drawer) => {
      const form = drawer.querySelector("#rule-form");
      const typeSelect = form.querySelector('select[name="type"]');
      const sync = () => {
        form.querySelectorAll("[data-for]").forEach((field) => {
          field.hidden = field.dataset.for !== typeSelect.value;
        });
      };
      typeSelect.addEventListener("change", sync);
      sync();
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const type = String(data.get("type"));
        const input = {
          type,
          title: String(data.get("title") ?? "").trim(),
          statement: type === "principle" ? String(data.get("statement") ?? "").trim() : undefined,
          body: String(data.get("body") ?? "").trim(),
          ownership: type === "ownershipMatrix" ? parseOwnership(data.get("ownership")) : [],
          stages: type === "cycle" ? parseStages(data.get("stages")) : [],
          flows: type === "processFlow" ? parseFlows(data.get("flows")) : [],
          phaseIds: data.getAll("phaseIds").map(String),
        };
        const path = existing ? chartPath(ctx, `/rules/${encodeURIComponent(existing.id)}`) : chartPath(ctx, "/rules");
        const message = existing ? "Regula a fost actualizată în ciornă." : "Regula a fost adăugată în ciornă.";
        const saved = await ctx.changeDraft(path, { method: existing ? "PUT" : "POST", body: { rule: input } }, message);
        if (saved) ctx.closeDrawer();
      });
    },
  );
}

async function deleteRule(ctx, ruleId) {
  if (deniedForEditor(ctx)) return;
  const rule = ctx.state.draft.document.rules.find((entry) => entry.id === ruleId);
  if (!rule || !window.confirm(`Ștergi regula „${rule.title}” din ciornă?`)) return;
  await ctx.changeDraft(chartPath(ctx, `/rules/${encodeURIComponent(ruleId)}`), { method: "DELETE" }, "Regula a fost ștearsă din ciornă.");
}

function coverageState(doc, role) {
  if (phasePosition(doc, role.dedicatedPhaseId) === 0) return ["ok", "Activ din prima fază"];
  if (role.coveringRoleId) {
    const cover = doc.roles.find((entry) => entry.id === role.coveringRoleId);
    if (!cover || isMerged(cover) || phasePosition(doc, cover.dedicatedPhaseId) > 0) return ["err", "Acoperire inactivă"];
    return ["ok", "Acoperit"];
  }
  if (role.coverageNote) return ["warn", "Acoperire externă"];
  return ["err", "Fără acoperire"];
}

function matrixRow(doc, role, editable) {
  const division = doc.divisions.find((entry) => entry.id === role.divisionId);
  const disabled = editable ? "" : " disabled";
  const phaseOptions = doc.phases
    .map((phase, index) => `<option value="${esc(phase.id)}"${phase.id === role.dedicatedPhaseId ? " selected" : ""}>${index + 1}. ${esc(phase.name)}</option>`)
    .join("");
  const coverOptions = doc.roles
    .filter((entry) => entry.id !== role.id)
    .map((entry) => `<option value="${esc(entry.id)}"${entry.id === role.coveringRoleId ? " selected" : ""}>${esc(entry.title)}</option>`)
    .join("");
  const [tone, label] = coverageState(doc, role);
  const flagged = Boolean(pendingPhaseDeletion) && role.dedicatedPhaseId === pendingPhaseDeletion;
  const roleId = esc(role.id);
  return `<tr${flagged ? ' class="flag"' : ""}><td><button type="button" class="linkbtn" data-role="${roleId}">${esc(role.title)}</button></td><td class="small">${esc(division?.name ?? "")}</td><td><select data-coverage="dedicatedPhaseId" data-role-id="${roleId}" aria-label="Faza dedicată pentru ${esc(role.title)}"${disabled}>${phaseOptions}</select></td><td><select data-coverage="coveringRoleId" data-role-id="${roleId}" aria-label="Rolul care acoperă ${esc(role.title)}"${disabled}><option value="">—</option>${coverOptions}</select></td><td><input data-coverage="coverageNote" data-role-id="${roleId}" value="${esc(role.coverageNote ?? "")}" aria-label="Notă de acoperire pentru ${esc(role.title)}"${disabled}></td><td><span class="pill ${tone}">${esc(flagged ? "De remapat" : label)}</span></td></tr>`;
}

async function updateCoverage(ctx, roleId, changes) {
  const role = ctx.state.draft.document.roles.find((entry) => entry.id === roleId);
  if (!role) return;
  const body = {
    dedicatedPhaseId: role.dedicatedPhaseId ?? "",
    coveringRoleId: role.coveringRoleId ?? "",
    coverageNote: role.coverageNote ?? "",
    ...changes,
  };
  const saved = await ctx.changeDraft(chartPath(ctx, `/roles/${encodeURIComponent(roleId)}/coverage`), { method: "PATCH", body }, "Acoperirea rolului a fost actualizată.");
  if (!saved) ctx.render();
}

function renderPhases(ctx, section) {
  const doc = ctx.document();
  const ownerCanEdit = ctx.canEdit() && ctx.hasRole("owner");
  const editorCanEdit = ctx.canEdit();
  if (pendingPhaseDeletion && !doc.phases.some((phase) => phase.id === pendingPhaseDeletion)) pendingPhaseDeletion = null;

  const phaseRows = doc.phases
    .map((phase, index) => {
      const roleCount = doc.roles.filter((role) => role.dedicatedPhaseId === phase.id).length;
      const ruleCount = doc.rules.filter((rule) => rule.phaseIds.includes(phase.id)).length;
      const phaseId = esc(phase.id);
      const tools = ownerCanEdit
        ? `<td class="actions-cell"><button class="btn" type="button" data-action="edit-phase" data-phase-id="${phaseId}">Editează</button> <button class="btn" type="button" data-action="move-phase" data-phase-id="${phaseId}" data-direction="-1" aria-label="Mută mai devreme"${index === 0 ? " disabled" : ""}>↑</button> <button class="btn" type="button" data-action="move-phase" data-phase-id="${phaseId}" data-direction="1" aria-label="Mută mai târziu"${index === doc.phases.length - 1 ? " disabled" : ""}>↓</button> <button class="btn danger" type="button" data-action="delete-phase" data-phase-id="${phaseId}"${doc.phases.length <= 1 ? " disabled" : ""}>Șterge</button></td>`
        : "";
      return `<tr${phase.id === pendingPhaseDeletion ? ' class="flag"' : ""}><td>${index + 1}</td><td class="t-name">${esc(phase.name)}</td><td>${esc(phase.description ?? "")}</td><td>${roleCount}</td><td>${ruleCount}</td>${tools}</tr>`;
    })
    .join("");

  const ordered = doc.divisions.flatMap((division) => rolesInDivisionOrder(doc, division));
  const orphans = doc.roles.filter((role) => !ordered.includes(role));
  const matrixRows = [...ordered, ...orphans]
    .filter((role) => !isMerged(role))
    .map((role) => matrixRow(doc, role, editorCanEdit))
    .join("");
  const addButton = ownerCanEdit
    ? `<div class="edit-bar"><button class="btn" type="button" data-action="add-phase"${doc.phases.length >= 6 ? " disabled" : ""}>Adaugă fază</button></div>`
    : "";
  const note = ownerCanEdit
    ? "O organigramă are între una și șase faze. O fază folosită de roluri sau reguli se șterge doar după remapare."
    : "Doar un Owner poate modifica fazele.";

  section.innerHTML = `<div class="prose wide">
<h2>Faze de creștere</h2><p class="small">${note}</p>${addButton}
<div class="tbl-wrap"><table class="data"><thead><tr><th>Nr.</th><th>Fază</th><th>Descriere</th><th>Roluri dedicate</th><th>Reguli limitate</th>${ownerCanEdit ? "<th>Acțiuni</th>" : ""}</tr></thead><tbody>${phaseRows}</tbody></table></div>
<h2 class="section-gap">Acoperirea rolurilor pe faze</h2>
<p class="small">Un rol dedicat într-o fază ulterioară are nevoie de un rol activ care îl acoperă în fazele anterioare.</p>
<div class="tbl-wrap"><table class="data matrix"><thead><tr><th>Rol</th><th>Divizie</th><th>Rol dedicat din</th><th>Acoperit până atunci de</th><th>Notă de acoperire</th><th>Stare</th></tr></thead><tbody>${matrixRows || `<tr><td colspan="6">Nu există roluri.</td></tr>`}</tbody></table></div>
</div>`;

  if (editorCanEdit) {
    section.querySelectorAll("[data-coverage]").forEach((control) => {
      control.addEventListener("change", () => updateCoverage(ctx, control.dataset.roleId, { [control.dataset.coverage]: control.value }));
    });
  }
}

function openPhaseEditor(ctx, phaseId) {
  if (deniedForOwner(ctx)) return;
  const doc = ctx.state.draft.document;
  const existing = phaseId ? doc.phases.find((phase) => phase.id === phaseId) : undefined;
  if (!existing && doc.phases.length >= 6) {
    ctx.notify("O organigramă poate avea cel mult șase faze.", true);
    return;
  }
  ctx.openDrawer(
    `<h2 id="d-title">${existing ? "Editează faza" : "Fază nouă"}</h2>
<form class="form" id="phase-form">
<label class="field">Nume<input name="name" value="${esc(existing?.name ?? "")}" required maxlength="80" autofocus></label>
<label class="field">Descriere<input name="description" value="${esc(existing?.description ?? "")}" placeholder="De exemplu: 25–80 oameni"></label>
<div class="inline"><button class="btn primary" type="submit">Salvează în ciornă</button><button class="btn" type="button" data-close-drawer>Renunță</button></div>
</form>`,
    (drawer) => {
      drawer.querySelector("#phase-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(event.target);
        const body = { name: String(data.get("name") ?? "").trim(), description: String(data.get("description") ?? "").trim() };
        const saved = existing
          ? await ctx.changeDraft(chartPath(ctx, `/phases/${encodeURIComponent(existing.id)}`), { method: "PATCH", body }, "Faza a fost actualizată.")
          : await ctx.changeDraft(chartPath(ctx, "/phases"), { method: "POST", body }, "Faza a fost adăugată.");
        if (saved) ctx.closeDrawer();
      });
    },
  );
}

async function movePhase(ctx, phaseId, direction) {
  if (deniedForOwner(ctx)) return;
  const ids = ctx.state.draft.document.phases.map((phase) => phase.id);
  const index = ids.indexOf(phaseId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await ctx.changeDraft(chartPath(ctx, "/phase-order"), { method: "POST", body: { phaseIds: ids } }, "Ordinea fazelor a fost actualizată.");
}

async function deletePhase(ctx, phaseId) {
  if (deniedForOwner(ctx)) return;
  const doc = ctx.state.draft.document;
  const phase = doc.phases.find((entry) => entry.id === phaseId);
  if (!phase) return;
  if (doc.phases.length <= 1) {
    ctx.notify("Organigrama trebuie să păstreze cel puțin o fază.", true);
    return;
  }
  const roles = doc.roles.filter((role) => role.dedicatedPhaseId === phaseId);
  const rules = doc.rules.filter((rule) => rule.phaseIds.includes(phaseId));
  const path = chartPath(ctx, `/phases/${encodeURIComponent(phaseId)}`);
  if (roles.length === 0 && rules.length === 0) {
    if (!window.confirm(`Ștergi faza „${phase.name}”?`)) return;
    await ctx.changeDraft(path, { method: "DELETE" }, "Faza a fost ștearsă.");
    return;
  }

  pendingPhaseDeletion = phaseId;
  ctx.render();
  const targets = doc.phases
    .map((entry, index) => (entry.id === phaseId ? "" : `<option value="${esc(entry.id)}">${index + 1}. ${esc(entry.name)}</option>`))
    .join("");
  const roleList = roles.length > 0
    ? `<h3>Roluri afectate</h3><ul>${roles.map((role) => `<li><button type="button" class="linkbtn" data-role="${esc(role.id)}">${esc(role.title)}</button></li>`).join("")}</ul>`
    : "";
  const ruleList = rules.length > 0 ? `<h3>Reguli afectate</h3><ul>${rules.map((rule) => `<li>${esc(rule.title)}</li>`).join("")}</ul>` : "";
  ctx.openDrawer(
    `<h2 id="d-title">Remapează faza „${esc(phase.name)}”</h2>
<p>Faza este folosită de ${roles.length} roluri și ${rules.length} reguli. Alege faza în care trec înainte de ștergere. Rândurile afectate sunt marcate în matricea de acoperire.</p>
${roleList}${ruleList}
<form class="form" id="remap-form"><label class="field">Remapează la faza<select name="target">${targets}</select></label>
<div class="inline"><button class="btn danger" type="submit">Remapează și șterge faza</button><button class="btn" type="button" data-action="cancel-phase-deletion">Renunță</button></div></form>`,
    (drawer) => {
      drawer.querySelector("#remap-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const target = String(new FormData(event.target).get("target") ?? "");
        const saved = await ctx.changeDraft(path, { method: "DELETE", params: { remapToPhaseId: target } }, "Rolurile și regulile au fost remapate, iar faza a fost ștearsă.");
        if (saved) {
          pendingPhaseDeletion = null;
          ctx.closeDrawer();
          ctx.render();
        }
      });
    },
  );
}

export const governanceView = {
  id: "gov",
  label: "Reguli de guvernanță",
  usesFilters: true,
  needsChart: true,
  visible: () => true,
  render: renderGovernance,
};

export const phasesView = {
  id: "phases",
  label: "Faze și acoperire",
  usesFilters: false,
  needsChart: true,
  visible: () => true,
  render: renderPhases,
};

export const actions = {
  "add-rule": (ctx) => openRuleEditor(ctx, null),
  "edit-rule": (ctx, element) => openRuleEditor(ctx, element.dataset.rule),
  "delete-rule": (ctx, element) => deleteRule(ctx, element.dataset.rule),
  "add-phase": (ctx) => openPhaseEditor(ctx, null),
  "edit-phase": (ctx, element) => openPhaseEditor(ctx, element.dataset.phaseId),
  "move-phase": (ctx, element) => movePhase(ctx, element.dataset.phaseId, Number(element.dataset.direction)),
  "delete-phase": (ctx, element) => deletePhase(ctx, element.dataset.phaseId),
  "cancel-phase-deletion": (ctx) => {
    pendingPhaseDeletion = null;
    ctx.closeDrawer();
    ctx.render();
  },
};

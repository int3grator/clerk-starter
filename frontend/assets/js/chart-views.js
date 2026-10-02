import { esc, norm } from "./util.js";
import {
  CHANGE_LABELS,
  childrenOf,
  coverageLabel,
  isFuture,
  isMerged,
  phaseLabel,
  phaseNumber,
  rolesInDivisionOrder,
  rootRole,
  searchText,
} from "./model.js";

function matches(ctx, role) {
  const words = norm(ctx.state.query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = norm(searchText(role));
  return words.every((word) => haystack.includes(word));
}

export function isHidden(ctx, role) {
  return (ctx.state.onlyChanges && !role.changeStatus) || !matches(ctx, role);
}

function classes(ctx, doc, role) {
  const list = [];
  if (isMerged(role)) list.push("struck");
  if (isFuture(doc, role, ctx.state.phaseId)) list.push("future");
  if (isHidden(ctx, role)) list.push("dim");
  return list.join(" ");
}

export function badge(role) {
  if (!role.changeStatus) return "";
  const variant = role.changeStatus === "new" ? " new" : role.changeStatus === "merged" ? " merged" : "";
  return `<span class="badge${variant}">${esc(CHANGE_LABELS[role.changeStatus])}</span>`;
}

function meta(ctx, doc, role) {
  let html = badge(role);
  if (isFuture(doc, role, ctx.state.phaseId)) {
    const cover = coverageLabel(doc, role);
    html += `<span class="fut">Din faza ${phaseNumber(doc, role.dedicatedPhaseId)}${cover ? `, acoperit de ${esc(cover)}` : ""}</span>`;
  }
  return html;
}

function subtitle(role) {
  return `${role.englishTitle ? `${esc(role.englishTitle)}. ` : ""}${esc(role.localTitle ?? "")}`;
}

function execCard(ctx, doc, role) {
  return `<button type="button" class="exec ${classes(ctx, doc, role)}" data-role="${esc(role.id)}"><span class="et">${esc(role.title)}</span><span class="rro">${subtitle(role)}</span><span class="rout">${esc(role.deliverable)}</span><span class="meta">${meta(ctx, doc, role)}</span></button>`;
}

function teamList(ctx, doc, roleId, seen) {
  const team = childrenOf(doc, roleId).filter((member) => !seen.has(member.id));
  if (team.length === 0) return "";
  team.forEach((member) => seen.add(member.id));
  const items = team.map((member) => {
    const future = isFuture(doc, member, ctx.state.phaseId) ? ` <span class="fut">F${phaseNumber(doc, member.dedicatedPhaseId)}</span>` : "";
    return `<li><button type="button" class="tbtn ${classes(ctx, doc, member)}" data-role="${esc(member.id)}">${esc(member.title)}${badge(member)}${future}</button>${teamList(ctx, doc, member.id, seen)}</li>`;
  });
  return `<ul class="team">${items.join("")}</ul>`;
}

function headBlock(ctx, doc, role, seen) {
  seen.add(role.id);
  return `<div class="head"><button type="button" class="rbtn ${classes(ctx, doc, role)}" data-role="${esc(role.id)}"><span class="rt">${esc(role.title)}</span><span class="rro">${esc(role.localTitle ?? "")}</span><span class="rout">${esc(role.deliverable)}</span><span class="meta">${meta(ctx, doc, role)}</span></button>${teamList(ctx, doc, role.id, seen)}</div>`;
}

function editBar(ctx, doc) {
  if (!ctx.canEdit()) return "";
  const noDivisions = doc.divisions.length === 0 ? " disabled" : "";
  return `<div class="edit-bar"><button class="btn" type="button" data-action="add-role"${noDivisions}>Adaugă rol</button><button class="btn" type="button" data-action="add-division">Adaugă divizie</button><button class="btn" type="button" data-action="list-divisions"${noDivisions}>Diviziile</button></div>`;
}

function legend(root) {
  return `<div class="legend"><span><i class="sw" style="border:1.5px solid var(--ink)"></i>Executiv (raportează la ${esc(root?.title ?? "rolul rădăcină")})</span><span><i class="sw" style="background:var(--surface)"></i>Head of (nivel 2)</span><span><i class="sw" style="border-left:2px solid var(--line);border-radius:0"></i>Echipă (nivel 3)</span><span><i class="sw" style="border:1px dashed var(--future)"></i>Rol dedicat într-o fază ulterioară</span><span class="badge new">Nou</span><span class="badge">Modificat / Redenumit</span><span class="badge merged">Combinat</span></div>`;
}

function renderOrg(ctx, section) {
  const doc = ctx.document();
  if (doc.divisions.length === 0 && doc.roles.length === 0) {
    const hint = ctx.canEdit() ? " Adaugă o divizie, apoi rolul rădăcină." : "";
    section.innerHTML = `${editBar(ctx, doc)}<div class="empty">Organigrama nu are încă divizii sau roluri.${hint}</div>`;
    return;
  }

  const seen = new Set();
  const root = rootRole(doc);
  const rootDivision = root ? doc.divisions.find((division) => division.id === root.divisionId) : undefined;
  let html = editBar(ctx, doc);

  if (root) {
    seen.add(root.id);
    const side = childrenOf(doc, root.id).filter((role) => role.divisionId === root.divisionId);
    side.forEach((role) => seen.add(role.id));
    const sideHtml = side.length > 0 ? `<div class="side">${side.map((role) => headBlock(ctx, doc, role, seen)).join("")}</div>` : "";
    html += `<div class="ceo-row">${execCard(ctx, doc, root)}${sideHtml}</div><div class="stem"></div>`;
  }

  const columns = doc.divisions.filter((division) => division !== rootDivision);
  if (columns.length > 0) {
    const count = columns.length;
    html += `<div class="cols-wrap"><div class="rail" style="margin:0 ${(50 / count).toFixed(2)}%"></div><div class="cols" style="grid-template-columns:repeat(${count},minmax(224px,1fr));min-width:${count * 238}px">`;
    html += columns
      .map((division) => {
        const owner = doc.roles.find((role) => role.id === division.ownerRoleId);
        let body = `<div class="empty small">Divizia nu are owner.</div>`;
        if (owner && !seen.has(owner.id)) {
          seen.add(owner.id);
          const heads = childrenOf(doc, owner.id).filter((role) => !seen.has(role.id));
          heads.forEach((role) => seen.add(role.id));
          body = `${execCard(ctx, doc, owner)}<div class="kids">${heads.map((role) => headBlock(ctx, doc, role, seen)).join("")}</div>`;
        }
        const agents = division.aiAgents ? `<p class="ai"><b>Agenți AI în divizie:</b> ${esc(division.aiAgents)}</p>` : "";
        return `<section class="col"><p class="dname">${esc(division.name)}</p>${body}${agents}</section>`;
      })
      .join("");
    html += `</div></div>`;
  }

  // Roles outside the division hierarchy stay visible so that no draft data is hidden.
  const unplaced = doc.roles.filter((role) => !seen.has(role.id));
  if (unplaced.length > 0) {
    const cards = unplaced
      .map((role) => {
        const divisionName = doc.divisions.find((division) => division.id === role.divisionId)?.name ?? "";
        return `<button type="button" class="rbtn ${classes(ctx, doc, role)}" data-role="${esc(role.id)}"><span class="rt">${esc(role.title)}</span><span class="rro">${esc(divisionName)}</span><span class="meta">${meta(ctx, doc, role)}</span></button>`;
      })
      .join("");
    html += `<div class="unplaced"><p class="dname">Roluri care nu apar în ierarhia diviziilor</p><div class="kids">${cards}</div></div>`;
  }

  html += legend(root);
  section.innerHTML = html;
}

function renderTable(ctx, section) {
  const doc = ctx.document();
  const byId = new Map(doc.roles.map((role) => [role.id, role]));
  const groups = doc.divisions.map((division) => ({ name: division.name, roles: rolesInDivisionOrder(doc, division) }));
  const orphans = doc.roles.filter((role) => !doc.divisions.some((division) => division.id === role.divisionId));
  if (orphans.length > 0) groups.push({ name: "Fără divizie", roles: orphans });

  let rows = "";
  let count = 0;
  for (const group of groups) {
    let first = true;
    for (const role of group.roles) {
      if (isHidden(ctx, role)) continue;
      count += 1;
      const manager = role.managerRoleId ? byId.get(role.managerRoleId)?.title ?? "—" : "Board / acționari";
      const cover = coverageLabel(doc, role);
      const number = phaseNumber(doc, role.dedicatedPhaseId);
      const rowClass = [first ? "first" : "", isFuture(doc, role, ctx.state.phaseId) ? "future" : "", isMerged(role) ? "struck" : ""].filter(Boolean).join(" ");
      const responsibilities = role.responsibilities.length > 0 ? `<ul>${role.responsibilities.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "—";
      const kpis = role.keyPerformanceIndicators.length > 0 ? `<ul>${role.keyPerformanceIndicators.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "—";
      const phase = number ? `F${number}${cover ? `<br>înainte: ${esc(cover)}` : ""}` : "—";
      rows += `<tr class="${rowClass}" data-role="${esc(role.id)}" tabindex="0"><td class="t-div">${first ? esc(group.name) : ""}</td><td><span class="t-name">${esc(role.title)}</span><br><span class="small">${subtitle(role)}</span><br><span class="small">Raportează la: ${esc(manager)}</span><div class="meta">${meta(ctx, doc, role)}</div></td><td>${responsibilities}</td><td>${role.deliverable ? esc(role.deliverable) : "—"}</td><td>${kpis}</td><td class="small">${phase}</td></tr>`;
      first = false;
    }
  }
  const empty = `<tr><td colspan="6">Niciun rol nu corespunde filtrului. Șterge căutarea sau debifează „Doar modificările”.</td></tr>`;
  section.innerHTML = `<p class="t-count">${count} roluri afișate. Tabelul se tipărește pe o foaie A3 landscape (Ctrl/Cmd + P).</p><div class="tbl-wrap"><table><thead><tr><th>Divizie</th><th>Denumire rol</th><th>Rol și responsabilități</th><th>Rezultat livrat</th><th>KPI</th><th>Faza</th></tr></thead><tbody>${rows || empty}</tbody></table></div>`;
}

// Role detail panel, opened from the chart, the table, or a validation issue.
export function openRole(ctx, roleId) {
  const doc = ctx.document();
  const role = doc?.roles.find((entry) => entry.id === roleId);
  if (!role) {
    ctx.notify("Rolul nu există în documentul afișat.", true);
    return;
  }
  const division = doc.divisions.find((entry) => entry.id === role.divisionId);
  const manager = doc.roles.find((entry) => entry.id === role.managerRoleId);
  const reports = childrenOf(doc, role.id);
  const cover = coverageLabel(doc, role);
  const phase = phaseLabel(doc, role.dedicatedPhaseId);
  const actions = ctx.canEdit()
    ? `<div class="edit-bar drawer-actions"><button class="btn" type="button" data-action="edit-role" data-role-id="${esc(role.id)}">Editează rolul</button><button class="btn" type="button" data-action="add-role" data-manager="${esc(role.id)}">Adaugă subordonat</button><button class="btn danger" type="button" data-action="delete-role" data-role-id="${esc(role.id)}">Șterge rolul</button></div>`
    : "";
  const managerHtml = manager ? `<button type="button" class="linkbtn" data-role="${esc(manager.id)}">${esc(manager.title)}</button>` : "Board / acționari";
  const note = role.changeStatus ? `<div class="note"><b>${esc(CHANGE_LABELS[role.changeStatus])}.</b> ${esc(role.changeNote ?? "")}</div>` : "";
  const responsibilities = role.responsibilities.length > 0 ? `<ul>${role.responsibilities.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "<p>—</p>";
  const kpis = role.keyPerformanceIndicators.length > 0 ? `<h3>KPI</h3><ul>${role.keyPerformanceIndicators.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "";
  const reportList = reports.length > 0 ? `<h3>Subordonați direcți</h3><ul>${reports.map((report) => `<li><button type="button" class="linkbtn" data-role="${esc(report.id)}">${esc(report.title)}</button></li>`).join("")}</ul>` : "";
  ctx.openDrawer(`<p class="rro" style="margin:0">${esc(division?.name ?? "")}</p>
<h2 id="d-title">${esc(role.title)}</h2>
<p class="en">${subtitle(role)}</p>
<div class="meta">${badge(role)}</div>
<dl class="dl"><dt>Raportează la</dt><dd>${managerHtml}</dd><dt>Rol dedicat</dt><dd>${phase ? esc(phase) : "—"}</dd>${cover ? `<dt>Până atunci</dt><dd>acoperit de ${esc(cover)}</dd>` : ""}</dl>
${note}
<h3>Rezultat livrat</h3><p class="outp">${role.deliverable ? esc(role.deliverable) : "—"}</p>
<h3>Rol și responsabilități</h3>${responsibilities}
${kpis}
${reportList}
${actions}`);
}

export const orgView = {
  id: "org",
  label: "Organigramă",
  usesFilters: true,
  needsChart: true,
  visible: () => true,
  render: renderOrg,
};

export const tableView = {
  id: "table",
  label: "Tabel pe o foaie",
  usesFilters: true,
  needsChart: true,
  renderAlways: true,
  visible: () => true,
  render: renderTable,
};

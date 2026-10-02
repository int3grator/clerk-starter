// Read helpers for OrgChartDocument. Every view derives its data from the same document.
export const CHANGE_LABELS = { new: "Nou", modified: "Modificat", renamed: "Redenumit", merged: "Combinat" };

export const isMerged = (role) => role.changeStatus === "merged";

// A role without a dedicated phase is active from the first phase.
export function phasePosition(doc, phaseId) {
  if (!phaseId) return 0;
  const index = doc.phases.findIndex((phase) => phase.id === phaseId);
  return index < 0 ? 0 : index;
}

export function isFuture(doc, role, selectedPhaseId) {
  return !isMerged(role) && phasePosition(doc, role.dedicatedPhaseId) > phasePosition(doc, selectedPhaseId);
}

export function phaseNumber(doc, phaseId) {
  const index = doc.phases.findIndex((phase) => phase.id === phaseId);
  return index < 0 ? null : index + 1;
}

export function phaseLabel(doc, phaseId) {
  const index = doc.phases.findIndex((phase) => phase.id === phaseId);
  if (index < 0) return "";
  const phase = doc.phases[index];
  return `Faza ${index + 1}, ${phase.name}${phase.description ? ` (${phase.description})` : ""}`;
}

export function coverageLabel(doc, role) {
  if (role.coverageNote) return role.coverageNote;
  return doc.roles.find((entry) => entry.id === role.coveringRoleId)?.title ?? "";
}

export function childrenOf(doc, roleId) {
  return doc.roles.filter((role) => role.managerRoleId === roleId && role.id !== roleId);
}

export function rootRole(doc) {
  return doc.roles.find((role) => !role.managerRoleId && !isMerged(role)) ?? doc.roles.find((role) => !role.managerRoleId) ?? null;
}

export function descendants(doc, roleId) {
  const found = new Set();
  const pending = [roleId];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const child of childrenOf(doc, current)) {
      if (child.id !== roleId && !found.has(child.id)) {
        found.add(child.id);
        pending.push(child.id);
      }
    }
  }
  return found;
}

// Orders a division's roles by reporting line, starting with the division owner.
export function rolesInDivisionOrder(doc, division) {
  const members = doc.roles.filter((role) => role.divisionId === division.id);
  const ordered = [];
  const seen = new Set();
  const visit = (role) => {
    if (!role || seen.has(role.id) || role.divisionId !== division.id) return;
    seen.add(role.id);
    ordered.push(role);
    childrenOf(doc, role.id).forEach((child) => visit(child));
  };
  visit(doc.roles.find((role) => role.id === division.ownerRoleId));
  members.filter((role) => !members.some((other) => other.id === role.managerRoleId)).forEach((role) => visit(role));
  members.forEach((role) => visit(role));
  return ordered;
}

export function searchText(role) {
  return [role.title, role.englishTitle, role.localTitle, role.deliverable, ...role.responsibilities, ...role.keyPerformanceIndicators]
    .filter(Boolean)
    .join(" ");
}

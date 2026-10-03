import type { OrgChartDocument } from "./document";

export type ChangeKind = "added" | "modified" | "renamed" | "moved" | "deleted" | "phase" | "rule";
export type ChangeEntity = "role" | "division" | "phase" | "rule" | "chart";

export interface VersionChange {
  kind: ChangeKind;
  entityType: ChangeEntity;
  entityId: string;
  label: string;
  field?: string;
  before?: string;
  after?: string;
}

function stable(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, entry) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return entry;
  });
}

const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
const listText = (values: string[]): string => values.join("; ");

// Compares two documents by stable identifiers, so a renamed or moved role is not reported as deleted and added.
export function diffDocuments(before: OrgChartDocument, after: OrgChartDocument): VersionChange[] {
  const changes: VersionChange[] = [];
  const roleTitle = (id: string | undefined, doc: OrgChartDocument): string => (id ? doc.roles.find((role) => role.id === id)?.title ?? id : "—");
  const divisionName = (id: string, doc: OrgChartDocument): string => doc.divisions.find((division) => division.id === id)?.name ?? id;
  const phaseName = (id: string | undefined, doc: OrgChartDocument): string => {
    if (!id) return "—";
    const index = doc.phases.findIndex((phase) => phase.id === id);
    return index < 0 ? id : `Faza ${index + 1}, ${doc.phases[index].name}`;
  };

  const beforeRoles = new Map(before.roles.map((role) => [role.id, role]));
  const afterRoleIds = new Set(after.roles.map((role) => role.id));
  for (const role of after.roles) {
    const previous = beforeRoles.get(role.id);
    if (!previous) {
      changes.push({ kind: "added", entityType: "role", entityId: role.id, label: role.title });
      continue;
    }
    const push = (kind: ChangeKind, field: string, beforeValue: string, afterValue: string) =>
      changes.push({ kind, entityType: "role", entityId: role.id, label: role.title, field, before: beforeValue, after: afterValue });
    if (previous.title !== role.title) push("renamed", "title", previous.title, role.title);
    if (!same(previous.englishTitle, role.englishTitle)) push("renamed", "englishTitle", previous.englishTitle ?? "", role.englishTitle ?? "");
    if (!same(previous.localTitle, role.localTitle)) push("renamed", "localTitle", previous.localTitle ?? "", role.localTitle ?? "");
    if (!same(previous.managerRoleId, role.managerRoleId)) push("moved", "managerRoleId", roleTitle(previous.managerRoleId, before), roleTitle(role.managerRoleId, after));
    if (previous.divisionId !== role.divisionId) push("moved", "divisionId", divisionName(previous.divisionId, before), divisionName(role.divisionId, after));
    if (!same(previous.dedicatedPhaseId, role.dedicatedPhaseId)) push("phase", "dedicatedPhaseId", phaseName(previous.dedicatedPhaseId, before), phaseName(role.dedicatedPhaseId, after));
    if (!same(previous.coveringRoleId, role.coveringRoleId)) push("phase", "coveringRoleId", roleTitle(previous.coveringRoleId, before), roleTitle(role.coveringRoleId, after));
    if (!same(previous.coverageNote, role.coverageNote)) push("phase", "coverageNote", previous.coverageNote ?? "", role.coverageNote ?? "");
    if (!same(previous.responsibilities, role.responsibilities)) push("modified", "responsibilities", listText(previous.responsibilities), listText(role.responsibilities));
    if (previous.deliverable !== role.deliverable) push("modified", "deliverable", previous.deliverable, role.deliverable);
    if (!same(previous.keyPerformanceIndicators, role.keyPerformanceIndicators)) {
      push("modified", "keyPerformanceIndicators", listText(previous.keyPerformanceIndicators), listText(role.keyPerformanceIndicators));
    }
    if (!same(previous.changeStatus, role.changeStatus)) push("modified", "changeStatus", previous.changeStatus ?? "", role.changeStatus ?? "");
    if (!same(previous.changeNote, role.changeNote)) push("modified", "changeNote", previous.changeNote ?? "", role.changeNote ?? "");
  }
  for (const role of before.roles) {
    if (!afterRoleIds.has(role.id)) changes.push({ kind: "deleted", entityType: "role", entityId: role.id, label: role.title });
  }

  const beforeDivisions = new Map(before.divisions.map((division) => [division.id, division]));
  const afterDivisionIds = new Set(after.divisions.map((division) => division.id));
  for (const division of after.divisions) {
    const previous = beforeDivisions.get(division.id);
    if (!previous) {
      changes.push({ kind: "added", entityType: "division", entityId: division.id, label: division.name });
      continue;
    }
    if (previous.name !== division.name) {
      changes.push({ kind: "renamed", entityType: "division", entityId: division.id, label: division.name, field: "name", before: previous.name, after: division.name });
    }
    if (!same(previous.ownerRoleId, division.ownerRoleId)) {
      changes.push({ kind: "modified", entityType: "division", entityId: division.id, label: division.name, field: "ownerRoleId", before: roleTitle(previous.ownerRoleId, before), after: roleTitle(division.ownerRoleId, after) });
    }
    if (!same(previous.aiAgents, division.aiAgents)) {
      changes.push({ kind: "modified", entityType: "division", entityId: division.id, label: division.name, field: "aiAgents", before: previous.aiAgents ?? "", after: division.aiAgents ?? "" });
    }
  }
  for (const division of before.divisions) {
    if (!afterDivisionIds.has(division.id)) changes.push({ kind: "deleted", entityType: "division", entityId: division.id, label: division.name });
  }

  const beforePhaseIndex = new Map(before.phases.map((phase, index) => [phase.id, index]));
  const afterPhaseIds = new Set(after.phases.map((phase) => phase.id));
  after.phases.forEach((phase, index) => {
    const previousIndex = beforePhaseIndex.get(phase.id);
    if (previousIndex === undefined) {
      changes.push({ kind: "phase", entityType: "phase", entityId: phase.id, label: phase.name, field: "added", after: `Faza ${index + 1}, ${phase.name}` });
      return;
    }
    const previous = before.phases[previousIndex];
    if (previous.name !== phase.name) {
      changes.push({ kind: "phase", entityType: "phase", entityId: phase.id, label: phase.name, field: "name", before: previous.name, after: phase.name });
    }
    if (!same(previous.description, phase.description)) {
      changes.push({ kind: "phase", entityType: "phase", entityId: phase.id, label: phase.name, field: "description", before: previous.description ?? "", after: phase.description ?? "" });
    }
    if (previousIndex !== index) {
      changes.push({ kind: "phase", entityType: "phase", entityId: phase.id, label: phase.name, field: "position", before: String(previousIndex + 1), after: String(index + 1) });
    }
  });
  for (const phase of before.phases) {
    if (!afterPhaseIds.has(phase.id)) changes.push({ kind: "phase", entityType: "phase", entityId: phase.id, label: phase.name, field: "deleted", before: phase.name });
  }

  const beforeRules = new Map(before.rules.map((rule) => [rule.id, rule]));
  const afterRuleIds = new Set(after.rules.map((rule) => rule.id));
  for (const rule of after.rules) {
    const previous = beforeRules.get(rule.id);
    if (!previous) changes.push({ kind: "rule", entityType: "rule", entityId: rule.id, label: rule.title, field: "added" });
    else if (!same(previous, rule)) changes.push({ kind: "rule", entityType: "rule", entityId: rule.id, label: rule.title, field: "modified", before: previous.title, after: rule.title });
  }
  for (const rule of before.rules) {
    if (!afterRuleIds.has(rule.id)) changes.push({ kind: "rule", entityType: "rule", entityId: rule.id, label: rule.title, field: "deleted" });
  }

  if (!same(before.tagline, after.tagline)) {
    changes.push({ kind: "modified", entityType: "chart", entityId: "chart", label: "Organigramă", field: "tagline", before: before.tagline ?? "", after: after.tagline ?? "" });
  }
  if (!same(before.lintConfig, after.lintConfig)) {
    changes.push({
      kind: "modified",
      entityType: "chart",
      entityId: "chart",
      label: "Organigramă",
      field: "lintConfig",
      before: String(before.lintConfig.maxKeyPerformanceIndicators),
      after: String(after.lintConfig.maxKeyPerformanceIndicators),
    });
  }
  return changes;
}

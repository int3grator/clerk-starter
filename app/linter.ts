import type { OrgChartDocument, Role } from "./document";

export type LintSeverity = "error" | "warning";

export interface LintIssue {
  severity: LintSeverity;
  ruleId: string;
  roleId?: string;
  divisionId?: string;
  message: string;
}

export interface LintResult {
  errorCount: number;
  warningCount: number;
  issues: LintIssue[];
}

function normalized(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isMerged(role: Role): boolean {
  return role.changeStatus === "merged";
}

function missingDeliverable(value: string): boolean {
  const text = value.trim();
  return text === "" || text === "-" || text === "—";
}

function label(role: Role): string {
  return `„${role.title || role.id}”`;
}

// Merged roles are retired, so the linter checks only active roles.
export function lintDocument(document: OrgChartDocument): LintResult {
  const issues: LintIssue[] = [];
  const active = document.roles.filter((role) => !isMerged(role));
  const byId = new Map(document.roles.map((role) => [role.id, role]));
  const phaseIndex = (phaseId?: string): number => {
    if (!phaseId) return 0;
    const index = document.phases.findIndex((phase) => phase.id === phaseId);
    return index < 0 ? 0 : index;
  };

  // The first active role without a manager is the root role.
  for (const role of active.filter((entry) => !entry.managerRoleId).slice(1)) {
    issues.push({
      severity: "error",
      ruleId: "role-without-manager",
      roleId: role.id,
      message: `Rolul ${label(role)} nu are manager direct. Doar rolul rădăcină poate fi fără manager.`,
    });
  }

  for (const role of active) {
    let current = role.managerRoleId ? byId.get(role.managerRoleId) : undefined;
    for (let steps = 0; current && steps <= document.roles.length; steps += 1) {
      if (current.id === role.id) {
        issues.push({
          severity: "error",
          ruleId: "reporting-cycle",
          roleId: role.id,
          message: `Rolul ${label(role)} face parte dintr-un ciclu de raportare.`,
        });
        break;
      }
      current = current.managerRoleId ? byId.get(current.managerRoleId) : undefined;
    }
  }

  for (const division of document.divisions) {
    const owner = division.ownerRoleId ? byId.get(division.ownerRoleId) : undefined;
    if (!owner || isMerged(owner)) {
      issues.push({
        severity: "error",
        ruleId: "division-without-owner",
        divisionId: division.id,
        message: `Divizia „${division.name}” nu are un owner activ.`,
      });
    }
  }

  // A future role needs a covering role that is active in every earlier phase.
  for (const role of active) {
    const dedicated = phaseIndex(role.dedicatedPhaseId);
    if (dedicated === 0) continue;
    if (!role.coveringRoleId) {
      if (!role.coverageNote) {
        issues.push({
          severity: "error",
          ruleId: "inactive-covering-role",
          roleId: role.id,
          message: `Rolul ${label(role)} devine dedicat în faza ${dedicated + 1}, dar nu are un rol care să îl acopere în fazele anterioare.`,
        });
      }
      continue;
    }
    const cover = byId.get(role.coveringRoleId);
    if (!cover || isMerged(cover) || phaseIndex(cover.dedicatedPhaseId) > 0) {
      issues.push({
        severity: "error",
        ruleId: "inactive-covering-role",
        roleId: role.id,
        message: `Rolul ${label(role)} este acoperit de ${cover ? label(cover) : "un rol inexistent"}, care nu este activ în toate fazele dinaintea fazei ${dedicated + 1}.`,
      });
    }
  }

  for (const role of active) {
    if (missingDeliverable(role.deliverable)) {
      issues.push({
        severity: "error",
        ruleId: "role-without-deliverable",
        roleId: role.id,
        message: `Rolul ${label(role)} nu are un rezultat livrat.`,
      });
    }
  }

  const maxKpi = document.lintConfig.maxKeyPerformanceIndicators;
  for (const role of active) {
    if (role.keyPerformanceIndicators.length > maxKpi) {
      issues.push({
        severity: "warning",
        ruleId: "too-many-kpis",
        roleId: role.id,
        message: `Rolul ${label(role)} are ${role.keyPerformanceIndicators.length} KPI. Limita este ${maxKpi}.`,
      });
    }
  }
  addDuplicateWarnings(active, (role) => role.responsibilities, "duplicate-responsibility", "Responsabilitatea", issues);
  addDuplicateWarnings(active, (role) => role.keyPerformanceIndicators, "duplicate-kpi", "KPI-ul", issues);

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  return { errorCount, warningCount: issues.length - errorCount, issues };
}

function addDuplicateWarnings(
  roles: Role[],
  values: (role: Role) => string[],
  ruleId: string,
  noun: string,
  issues: LintIssue[],
): void {
  const firstRole = new Map<string, Role>();
  for (const role of roles) {
    for (const value of values(role)) {
      const key = normalized(value);
      if (!key) continue;
      const first = firstRole.get(key);
      if (!first) {
        firstRole.set(key, role);
        continue;
      }
      const where = first.id === role.id ? `apare de mai multe ori la rolul ${label(role)}` : `apare și la rolul ${label(first)}`;
      issues.push({ severity: "warning", ruleId, roleId: role.id, message: `${noun} „${value}” ${where}.` });
    }
  }
}

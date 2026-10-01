import { createHash, randomUUID } from "node:crypto";

export type ChangeStatus = "new" | "modified" | "renamed" | "merged";
export type GovernanceRuleType = "principle" | "ownershipMatrix" | "cycle" | "processFlow";

export interface Phase {
  id: string;
  name: string;
  description?: string;
}

export interface Division {
  id: string;
  name: string;
  ownerRoleId?: string;
  aiAgents?: string;
}

export interface Role {
  id: string;
  title: string;
  englishTitle?: string;
  localTitle?: string;
  divisionId: string;
  managerRoleId?: string;
  responsibilities: string[];
  deliverable: string;
  keyPerformanceIndicators: string[];
  dedicatedPhaseId?: string;
  coveringRoleId?: string;
  coverageNote?: string;
  changeStatus?: ChangeStatus;
  changeNote?: string;
}

export interface OwnershipColumn {
  owner: string;
  items: string[];
}

export interface CycleStage {
  name: string;
  owner: string;
}

export interface ProcessFlow {
  steps: string[];
}

export interface GovernanceRule {
  id: string;
  type: GovernanceRuleType;
  title: string;
  statement?: string;
  body?: string;
  ownership: OwnershipColumn[];
  stages: CycleStage[];
  flows: ProcessFlow[];
  phaseIds: string[];
}

export interface LintConfig {
  maxKeyPerformanceIndicators: number;
}

export interface OrgChartDocument {
  schemaVersion: number;
  tagline?: string;
  phases: Phase[];
  divisions: Division[];
  roles: Role[];
  rules: GovernanceRule[];
  lintConfig: LintConfig;
}

export const changeStatuses: ChangeStatus[] = ["new", "modified", "renamed", "merged"];
export const governanceRuleTypes: GovernanceRuleType[] = ["principle", "ownershipMatrix", "cycle", "processFlow"];
export const maxPhases = 6;

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Fields) : {};
}

function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function optionalText(value: unknown): string | undefined {
  const result = text(value);
  return result ? result : undefined;
}

function textList(value: unknown): string[] {
  return entries(value).map(text).filter((entry) => entry.length > 0);
}

export function emptyDocument(): OrgChartDocument {
  return { schemaVersion: 1, phases: [], divisions: [], roles: [], rules: [], lintConfig: { maxKeyPerformanceIndicators: 5 } };
}

export function initialDocument(): OrgChartDocument {
  return { ...emptyDocument(), phases: [{ id: randomUUID(), name: "Faza 1" }] };
}

// Produces the canonical document shape from stored data, API input, or an imported file.
export function normalizeDocument(input: unknown): OrgChartDocument {
  const source = fields(input);
  const lintConfig = fields(source.lintConfig);
  const maxKpi = Number(lintConfig.maxKeyPerformanceIndicators);
  return {
    schemaVersion: 1,
    tagline: optionalText(source.tagline),
    phases: entries(source.phases).map((entry) => {
      const phase = fields(entry);
      return { id: text(phase.id), name: text(phase.name), description: optionalText(phase.description) };
    }),
    divisions: entries(source.divisions).map((entry) => {
      const division = fields(entry);
      return {
        id: text(division.id),
        name: text(division.name),
        ownerRoleId: optionalText(division.ownerRoleId),
        aiAgents: optionalText(division.aiAgents),
      };
    }),
    roles: entries(source.roles).map((entry) => {
      const role = fields(entry);
      const changeStatus = text(role.changeStatus) as ChangeStatus;
      return {
        id: text(role.id),
        title: text(role.title),
        englishTitle: optionalText(role.englishTitle),
        localTitle: optionalText(role.localTitle),
        divisionId: text(role.divisionId),
        managerRoleId: optionalText(role.managerRoleId),
        responsibilities: textList(role.responsibilities),
        deliverable: text(role.deliverable),
        keyPerformanceIndicators: textList(role.keyPerformanceIndicators),
        dedicatedPhaseId: optionalText(role.dedicatedPhaseId),
        coveringRoleId: optionalText(role.coveringRoleId),
        coverageNote: optionalText(role.coverageNote),
        changeStatus: changeStatuses.includes(changeStatus) ? changeStatus : undefined,
        changeNote: optionalText(role.changeNote),
      };
    }),
    rules: entries(source.rules).map((entry) => {
      const rule = fields(entry);
      return {
        id: text(rule.id),
        type: text(rule.type) as GovernanceRuleType,
        title: text(rule.title),
        statement: optionalText(rule.statement),
        body: optionalText(rule.body),
        ownership: entries(rule.ownership)
          .map((column) => ({ owner: text(fields(column).owner), items: textList(fields(column).items) }))
          .filter((column) => column.owner.length > 0 || column.items.length > 0),
        stages: entries(rule.stages)
          .map((stage) => ({ name: text(fields(stage).name), owner: text(fields(stage).owner) }))
          .filter((stage) => stage.name.length > 0),
        flows: entries(rule.flows)
          .map((flow) => ({ steps: textList(fields(flow).steps) }))
          .filter((flow) => flow.steps.length > 0),
        phaseIds: [...new Set(textList(rule.phaseIds))],
      };
    }),
    lintConfig: { maxKeyPerformanceIndicators: Number.isInteger(maxKpi) && maxKpi > 0 ? maxKpi : 5 },
  };
}

export function parseStoredDocument(stored: string): OrgChartDocument {
  return normalizeDocument(JSON.parse(stored));
}

// Structural integrity checks. Governance quality checks belong to the linter.
export function validateDocument(document: OrgChartDocument): string[] {
  const problems: string[] = [];
  if (document.phases.length < 1 || document.phases.length > maxPhases) {
    problems.push("Organigrama trebuie să aibă cel puțin o fază și cel mult șase faze.");
  }
  const phaseIds = collectIds(document.phases, "o fază", problems);
  const divisionIds = collectIds(document.divisions, "o divizie", problems);
  const roleIds = collectIds(document.roles, "un rol", problems);
  collectIds(document.rules, "o regulă", problems);

  for (const phase of document.phases) {
    if (!phase.name) problems.push(`Faza ${phase.id} nu are nume.`);
  }
  for (const division of document.divisions) {
    const label = division.name || division.id;
    if (!division.name) problems.push(`Divizia ${division.id} nu are nume.`);
    if (division.ownerRoleId && !roleIds.has(division.ownerRoleId)) {
      problems.push(`Divizia „${label}” are un owner care nu există.`);
    }
  }
  for (const role of document.roles) {
    const label = role.title || role.id;
    if (!role.title) problems.push(`Rolul ${role.id} nu are denumire.`);
    if (!divisionIds.has(role.divisionId)) problems.push(`Rolul „${label}” nu aparține unei divizii existente.`);
    if (role.managerRoleId && !roleIds.has(role.managerRoleId)) problems.push(`Rolul „${label}” raportează la un rol care nu există.`);
    if (role.dedicatedPhaseId && !phaseIds.has(role.dedicatedPhaseId)) problems.push(`Rolul „${label}” folosește o fază care nu există.`);
    if (role.coveringRoleId && !roleIds.has(role.coveringRoleId)) problems.push(`Rolul „${label}” este acoperit de un rol care nu există.`);
    if (role.coveringRoleId && role.coveringRoleId === role.id) problems.push(`Rolul „${label}” nu se poate acoperi singur.`);
  }
  for (const rule of document.rules) {
    const label = rule.title || rule.id;
    if (!governanceRuleTypes.includes(rule.type)) problems.push(`Regula „${label}” are un tip nesuportat.`);
    if (!rule.title) problems.push(`Regula ${rule.id} nu are titlu.`);
    for (const phaseId of rule.phaseIds) {
      if (!phaseIds.has(phaseId)) problems.push(`Regula „${label}” se aplică unei faze care nu există.`);
    }
  }
  return problems;
}

function collectIds(items: { id: string }[], noun: string, problems: string[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id) problems.push(`Există ${noun} fără identificator.`);
    else if (ids.has(item.id)) problems.push(`Identificatorul „${item.id}” apare de mai multe ori.`);
    else ids.add(item.id);
  }
  return ids;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const source = value as Fields;
    return Object.fromEntries(
      Object.keys(source)
        .filter((key) => source[key] !== undefined)
        .sort()
        .map((key) => [key, canonical(source[key])]),
    );
  }
  return value;
}

export function documentHash(document: OrgChartDocument): string {
  return createHash("sha256").update(JSON.stringify(canonical(document))).digest("hex");
}

export function hasContent(document: OrgChartDocument): boolean {
  return document.roles.length > 0 || document.divisions.length > 0 || document.rules.length > 0;
}

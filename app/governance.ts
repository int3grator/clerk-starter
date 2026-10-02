import { randomUUID } from "node:crypto";
import { APIError, api } from "encore.dev/api";
import { actorWithRole, currentActor } from "./authorization";
import {
  governanceRuleTypes,
  maxPhases,
  type CycleStage,
  type GovernanceRule,
  type GovernanceRuleType,
  type OrgChartDocument,
  type OwnershipColumn,
  type Phase,
  type ProcessFlow,
} from "./document";
import { mutateDraft, readDraft, type Draft } from "./org-chart";

interface AddPhaseRequest {
  id: string;
  name: string;
  description?: string;
  revisionToken: string;
}

interface UpdatePhaseRequest {
  id: string;
  phaseId: string;
  name: string;
  description?: string;
  revisionToken: string;
}

interface ReorderPhasesRequest {
  id: string;
  phaseIds: string[];
  revisionToken: string;
}

interface DeletePhaseRequest {
  id: string;
  phaseId: string;
  revisionToken: string;
  remapToPhaseId?: string;
}

interface RuleInput {
  type: GovernanceRuleType;
  title: string;
  statement?: string;
  body?: string;
  ownership?: OwnershipColumn[];
  stages?: CycleStage[];
  flows?: ProcessFlow[];
  phaseIds?: string[];
}

interface CreateRuleRequest {
  id: string;
  rule: RuleInput;
  revisionToken: string;
}

interface UpdateRuleRequest {
  id: string;
  ruleId: string;
  rule: RuleInput;
  revisionToken: string;
}

interface DeleteRuleRequest {
  id: string;
  ruleId: string;
  revisionToken: string;
}

interface ListRulesRequest {
  id: string;
  phaseId?: string;
}

interface ListRulesResponse {
  rules: GovernanceRule[];
}

interface UpdateCoverageRequest {
  id: string;
  roleId: string;
  dedicatedPhaseId?: string;
  coveringRoleId?: string;
  coverageNote?: string;
  revisionToken: string;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : undefined;
}

function requirePhase(document: OrgChartDocument, phaseId: string): Phase {
  const phase = document.phases.find((entry) => entry.id === phaseId);
  if (!phase) throw APIError.notFound("Faza nu există.");
  return phase;
}

function phaseName(input: string): string {
  const name = input.trim();
  if (!name) throw APIError.invalidArgument("Numele fazei este obligatoriu.");
  return name;
}

// A rule without selected phases applies to every phase.
export function rulesForPhase(document: OrgChartDocument, phaseId?: string): GovernanceRule[] {
  if (!phaseId) return document.rules;
  return document.rules.filter((rule) => rule.phaseIds.length === 0 || rule.phaseIds.includes(phaseId));
}

function buildRule(id: string, input: RuleInput): GovernanceRule {
  if (!governanceRuleTypes.includes(input.type)) throw APIError.invalidArgument("Tipul regulii nu este suportat.");
  const rule: GovernanceRule = {
    id,
    type: input.type,
    title: input.title.trim(),
    statement: optional(input.statement),
    body: optional(input.body),
    ownership: (input.ownership ?? [])
      .map((column) => ({ owner: column.owner.trim(), items: column.items.map((item) => item.trim()).filter((item) => item.length > 0) }))
      .filter((column) => column.owner.length > 0 || column.items.length > 0),
    stages: (input.stages ?? [])
      .map((stage) => ({ name: stage.name.trim(), owner: stage.owner.trim() }))
      .filter((stage) => stage.name.length > 0),
    flows: (input.flows ?? [])
      .map((flow) => ({ steps: flow.steps.map((step) => step.trim()).filter((step) => step.length > 0) }))
      .filter((flow) => flow.steps.length > 0),
    phaseIds: [...new Set((input.phaseIds ?? []).map((phaseId) => phaseId.trim()).filter((phaseId) => phaseId.length > 0))],
  };
  if (!rule.title) throw APIError.invalidArgument("Titlul regulii este obligatoriu.");
  if (rule.type === "principle" && !rule.statement && !rule.body) {
    throw APIError.invalidArgument("Un principiu are nevoie de un enunț sau de o explicație.");
  }
  if (rule.type === "ownershipMatrix" && (rule.ownership.length === 0 || rule.ownership.some((column) => !column.owner || column.items.length === 0))) {
    throw APIError.invalidArgument("Fiecare coloană din matricea de responsabilitate are nevoie de un owner și de cel puțin o responsabilitate.");
  }
  if (rule.type === "cycle" && rule.stages.length < 2) {
    throw APIError.invalidArgument("Un ciclu are nevoie de cel puțin două etape.");
  }
  if (rule.type === "processFlow" && (rule.flows.length === 0 || rule.flows.some((flow) => flow.steps.length < 2))) {
    throw APIError.invalidArgument("Fiecare flux de proces are nevoie de cel puțin doi pași.");
  }
  return rule;
}

export const addPhase = api(
  { expose: true, method: "POST", path: "/charts/:id/phases", auth: true },
  async (request: AddPhaseRequest): Promise<Draft> => {
    const actor = actorWithRole(["owner"]);
    const name = phaseName(request.name);
    return mutateDraft({
      actor,
      chartId: request.id,
      revisionToken: request.revisionToken,
      action: "phase_added",
      details: { name },
      mutate: (document) => {
        if (document.phases.length >= maxPhases) throw APIError.failedPrecondition("O organigramă poate avea cel mult șase faze.");
        document.phases.push({ id: randomUUID(), name, description: optional(request.description) });
        return document;
      },
    });
  },
);

export const updatePhase = api(
  { expose: true, method: "PATCH", path: "/charts/:id/phases/:phaseId", auth: true },
  async (request: UpdatePhaseRequest): Promise<Draft> => {
    const actor = actorWithRole(["owner"]);
    const name = phaseName(request.name);
    return mutateDraft({
      actor,
      chartId: request.id,
      revisionToken: request.revisionToken,
      action: "phase_updated",
      details: { phaseId: request.phaseId, name },
      mutate: (document) => {
        const phase = requirePhase(document, request.phaseId);
        phase.name = name;
        phase.description = optional(request.description);
        return document;
      },
    });
  },
);

export const reorderPhases = api(
  { expose: true, method: "POST", path: "/charts/:id/phase-order", auth: true },
  async (request: ReorderPhasesRequest): Promise<Draft> => {
    const actor = actorWithRole(["owner"]);
    return mutateDraft({
      actor,
      chartId: request.id,
      revisionToken: request.revisionToken,
      action: "phases_reordered",
      mutate: (document) => {
        const ids = request.phaseIds;
        const known = new Set(document.phases.map((phase) => phase.id));
        if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
          throw APIError.invalidArgument("Noua ordine trebuie să conțină fiecare fază o singură dată.");
        }
        document.phases = ids.map((id) => requirePhase(document, id));
        return document;
      },
    });
  },
);

export const deletePhase = api(
  { expose: true, method: "DELETE", path: "/charts/:id/phases/:phaseId", auth: true },
  async (request: DeletePhaseRequest): Promise<Draft> => {
    const actor = actorWithRole(["owner"]);
    const remapTo = optional(request.remapToPhaseId);
    return mutateDraft({
      actor,
      chartId: request.id,
      revisionToken: request.revisionToken,
      action: "phase_deleted",
      details: { phaseId: request.phaseId, remapToPhaseId: remapTo ?? null },
      mutate: (document) => {
        const phase = requirePhase(document, request.phaseId);
        if (document.phases.length <= 1) throw APIError.failedPrecondition("Organigrama trebuie să păstreze cel puțin o fază.");

        const affectedRoles = document.roles.filter((role) => role.dedicatedPhaseId === phase.id);
        const affectedRules = document.rules.filter((rule) => rule.phaseIds.includes(phase.id));
        if (affectedRoles.length + affectedRules.length > 0) {
          // A used phase is deleted only after its roles and rules move to another phase.
          if (!remapTo) {
            throw APIError.failedPrecondition(
              `Faza „${phase.name}” este folosită de ${affectedRoles.length} roluri și ${affectedRules.length} reguli. Remapează-le înainte de ștergere.`,
            );
          }
          if (remapTo === phase.id || !document.phases.some((entry) => entry.id === remapTo)) {
            throw APIError.invalidArgument("Alege o altă fază existentă pentru remapare.");
          }
          for (const role of affectedRoles) role.dedicatedPhaseId = remapTo;
          for (const rule of affectedRules) {
            rule.phaseIds = [...new Set(rule.phaseIds.map((id) => (id === phase.id ? remapTo : id)))];
          }
        }
        document.phases = document.phases.filter((entry) => entry.id !== phase.id);
        return document;
      },
    });
  },
);

export const listRules = api(
  { expose: true, method: "GET", path: "/charts/:id/rules", auth: true },
  async (request: ListRulesRequest): Promise<ListRulesResponse> => {
    const actor = currentActor();
    const draft = await readDraft(actor.organizationId, request.id);
    const phaseId = optional(request.phaseId);
    if (phaseId && !draft.document.phases.some((phase) => phase.id === phaseId)) throw APIError.notFound("Faza nu există.");
    return { rules: rulesForPhase(draft.document, phaseId) };
  },
);

export const createRule = api(
  { expose: true, method: "POST", path: "/charts/:id/rules", auth: true },
  async (request: CreateRuleRequest): Promise<Draft> => {
    const actor = actorWithRole(["owner", "editor"]);
    const rule = buildRule(randomUUID(), request.rule);
    return mutateDraft({
      actor,
      chartId: request.id,
      revisionToken: request.revisionToken,
      action: "rule_created",
      details: { ruleId: rule.id, type: rule.type },
      mutate: (document) => {
        document.rules.push(rule);
        return document;
      },
    });
  },
);

export const updateRule = api(
  { expose: true, method: "PUT", path: "/charts/:id/rules/:ruleId", auth: true },
  async (request: UpdateRuleRequest): Promise<Draft> => {
    const actor = actorWithRole(["owner", "editor"]);
    const rule = buildRule(request.ruleId, request.rule);
    return mutateDraft({
      actor,
      chartId: request.id,
      revisionToken: request.revisionToken,
      action: "rule_updated",
      details: { ruleId: rule.id, type: rule.type },
      mutate: (document) => {
        const index = document.rules.findIndex((entry) => entry.id === request.ruleId);
        if (index < 0) throw APIError.notFound("Regula nu există.");
        document.rules[index] = rule;
        return document;
      },
    });
  },
);

export const deleteRule = api(
  { expose: true, method: "DELETE", path: "/charts/:id/rules/:ruleId", auth: true },
  async (request: DeleteRuleRequest): Promise<Draft> => {
    const actor = actorWithRole(["owner", "editor"]);
    return mutateDraft({
      actor,
      chartId: request.id,
      revisionToken: request.revisionToken,
      action: "rule_deleted",
      details: { ruleId: request.ruleId },
      mutate: (document) => {
        if (!document.rules.some((entry) => entry.id === request.ruleId)) throw APIError.notFound("Regula nu există.");
        document.rules = document.rules.filter((entry) => entry.id !== request.ruleId);
        return document;
      },
    });
  },
);

export const updateRoleCoverage = api(
  { expose: true, method: "PATCH", path: "/charts/:id/roles/:roleId/coverage", auth: true },
  async (request: UpdateCoverageRequest): Promise<Draft> => {
    const actor = actorWithRole(["owner", "editor"]);
    return mutateDraft({
      actor,
      chartId: request.id,
      revisionToken: request.revisionToken,
      action: "role_coverage_updated",
      details: { roleId: request.roleId },
      mutate: (document) => {
        const role = document.roles.find((entry) => entry.id === request.roleId);
        if (!role) throw APIError.notFound("Rolul nu există.");
        role.dedicatedPhaseId = optional(request.dedicatedPhaseId);
        role.coveringRoleId = optional(request.coveringRoleId);
        role.coverageNote = optional(request.coverageNote);
        return document;
      },
    });
  },
);

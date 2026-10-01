import { randomUUID } from "node:crypto";
import { APIError, api } from "encore.dev/api";
import { getAuthData } from "encore.dev/auth";
import type { LocalSession } from "./auth";
import { requireRole } from "./authorization";
import { db } from "./db";

type Division = { id: string; name: string; ownerRoleId?: string };
type Role = { id: string; title: string; divisionId?: string; managerRoleId?: string; responsibilities?: string[]; deliverable?: string; keyPerformanceIndicators?: string[]; dedicatedPhase?: number; coveringRoleId?: string };
export type OrgChartDocument = { schemaVersion: number; phases: unknown[]; divisions: Division[]; roles: Role[]; rules: unknown[]; lintConfig: Record<string, unknown> };
type Draft = { chartId: string; document: OrgChartDocument; revisionToken: string; updatedAt: Date };
function session(): LocalSession { const current = getAuthData<LocalSession>(); if (!current) throw APIError.unauthenticated("missing local session"); return current; }
function editable(): LocalSession { const current = session(); requireRole(current, ["owner", "editor"]); return current; }
function initialDocument(): OrgChartDocument { return { schemaVersion: 1, phases: [], divisions: [], roles: [], rules: [], lintConfig: {} }; }

export const createChart = api({ expose: true, method: "POST", path: "/charts", auth: true }, async (request: { name: string }): Promise<Draft> => {
  const actor = editable(); const name = request.name.trim(); if (!name) throw APIError.invalidArgument("chart name is required");
  const chartId = randomUUID(); const revisionToken = randomUUID(); const document = initialDocument();
  await db.exec`INSERT INTO organization_chart (id, organization_id, name, created_by_user_id) VALUES (${chartId}, ${actor.organizationId}, ${name}, ${actor.userId}); INSERT INTO organization_chart_draft (chart_id, document, revision_token, updated_by_user_id) VALUES (${chartId}, ${JSON.stringify(document)}::jsonb, ${revisionToken}, ${actor.userId});`;
  return { chartId, document, revisionToken, updatedAt: new Date() };
});
export const getDraft = api({ expose: true, method: "GET", path: "/charts/:id/draft", auth: true }, async (request: { id: string }): Promise<Draft> => {
  const actor = session(); const draft = await db.queryRow<Draft>`SELECT organization_chart_draft.chart_id AS "chartId", document, revision_token AS "revisionToken", updated_at AS "updatedAt" FROM organization_chart_draft JOIN organization_chart ON organization_chart.id = organization_chart_draft.chart_id WHERE chart_id = ${request.id} AND organization_chart.organization_id = ${actor.organizationId}`; if (!draft) throw APIError.notFound("chart draft not found"); return draft;
});
export const updateDraft = api({ expose: true, method: "PUT", path: "/charts/:id/draft", auth: true }, async (request: { id: string; document: OrgChartDocument; revisionToken: string }): Promise<Draft> => {
  const actor = editable(); if (!request.document || !Array.isArray(request.document.divisions) || !Array.isArray(request.document.roles)) throw APIError.invalidArgument("draft must include divisions and roles"); const newToken = randomUUID();
  const result = await db.exec`UPDATE organization_chart_draft SET document = ${JSON.stringify(request.document)}::jsonb, revision_token = ${newToken}, updated_at = CURRENT_TIMESTAMP, updated_by_user_id = ${actor.userId} WHERE chart_id = ${request.id} AND revision_token = ${request.revisionToken} AND EXISTS (SELECT 1 FROM organization_chart WHERE id = ${request.id} AND organization_id = ${actor.organizationId})`;
  if (result.rowsAffected !== 1) throw APIError.aborted("draft has changed or was not found"); return { chartId: request.id, document: request.document, revisionToken: newToken, updatedAt: new Date() };
});
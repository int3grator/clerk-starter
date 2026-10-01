import { randomUUID } from "node:crypto";
import { APIError, api } from "encore.dev/api";
import type { LocalSession } from "./auth";
import { recordAudit, type AuditDetails } from "./audit";
import { actorWithRole, currentActor } from "./authorization";
import { db, inTransaction, type Transaction } from "./db";
import { initialDocument, normalizeDocument, parseStoredDocument, validateDocument, type OrgChartDocument } from "./document";

export interface ChartSummary {
  id: string;
  name: string;
  createdAt: string;
}

export interface Draft {
  chartId: string;
  chartName: string;
  document: OrgChartDocument;
  revisionToken: string;
  updatedAt: string;
}

interface ListChartsResponse {
  charts: ChartSummary[];
}

interface CreateChartRequest {
  name: string;
}

interface ChartRequest {
  id: string;
}

interface UpdateDraftRequest {
  id: string;
  document: OrgChartDocument;
  revisionToken: string;
}

interface DraftRow {
  chartId: string;
  chartName: string;
  documentText: string;
  revisionToken: string;
  updatedAt: Date;
}

export interface DraftChange {
  actor: LocalSession;
  chartId: string;
  revisionToken: string;
  action: string;
  details?: AuditDetails;
  mutate: (document: OrgChartDocument, current: Draft) => OrgChartDocument;
}

function toDraft(row: DraftRow): Draft {
  return {
    chartId: row.chartId,
    chartName: row.chartName,
    document: parseStoredDocument(row.documentText),
    revisionToken: row.revisionToken,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function readDraft(organizationId: string, chartId: string): Promise<Draft> {
  const row = await db.queryRow<DraftRow>`
    SELECT d.chart_id AS "chartId", c.name AS "chartName", d.document::text AS "documentText",
           d.revision_token AS "revisionToken", d.updated_at AS "updatedAt"
    FROM organization_chart_draft d
    JOIN organization_chart c ON c.id = d.chart_id
    WHERE d.chart_id = ${chartId} AND c.organization_id = ${organizationId}
  `;
  if (!row) throw APIError.notFound("Organigrama nu există.");
  return toDraft(row);
}

export async function lockDraft(tx: Transaction, organizationId: string, chartId: string): Promise<Draft> {
  const row = await tx.queryRow<DraftRow>`
    SELECT d.chart_id AS "chartId", c.name AS "chartName", d.document::text AS "documentText",
           d.revision_token AS "revisionToken", d.updated_at AS "updatedAt"
    FROM organization_chart_draft d
    JOIN organization_chart c ON c.id = d.chart_id
    WHERE d.chart_id = ${chartId} AND c.organization_id = ${organizationId}
    FOR UPDATE OF d
  `;
  if (!row) throw APIError.notFound("Organigrama nu există.");
  return toDraft(row);
}

export async function writeDraft(tx: Transaction, actor: LocalSession, current: Draft, document: OrgChartDocument): Promise<Draft> {
  const revisionToken = randomUUID();
  const row = await tx.queryRow<{ updatedAt: Date }>`
    UPDATE organization_chart_draft
    SET document = ${JSON.stringify(document)}::text::jsonb, revision_token = ${revisionToken},
        updated_at = CURRENT_TIMESTAMP, updated_by_user_id = ${actor.userID}
    WHERE chart_id = ${current.chartId}
    RETURNING updated_at AS "updatedAt"
  `;
  if (!row) throw APIError.notFound("Organigrama nu există.");
  return { ...current, document, revisionToken, updatedAt: new Date(row.updatedAt).toISOString() };
}

// Applies one draft change under the caller's revision token, validates it, and audits it in one transaction.
export async function mutateDraft(change: DraftChange): Promise<Draft> {
  return inTransaction(async (tx) => {
    const current = await lockDraft(tx, change.actor.organizationId, change.chartId);
    if (current.revisionToken !== change.revisionToken) {
      throw APIError.aborted("Ciorna a fost modificată între timp. Reîncarcă ciorna și aplică din nou modificarea.");
    }
    const next = normalizeDocument(change.mutate(structuredClone(current.document), current));
    const problems = validateDocument(next);
    if (problems.length > 0) throw APIError.invalidArgument(problems.slice(0, 5).join(" "));

    const saved = await writeDraft(tx, change.actor, current, next);
    await recordAudit(tx, {
      organizationId: change.actor.organizationId,
      actorUserId: change.actor.userID,
      action: change.action,
      subjectType: "organization_chart",
      subjectId: change.chartId,
      chartId: change.chartId,
      details: change.details,
    });
    return saved;
  });
}

export const listCharts = api(
  { expose: true, method: "GET", path: "/charts", auth: true },
  async (): Promise<ListChartsResponse> => {
    const actor = currentActor();
    const rows = await db.queryAll<{ id: string; name: string; createdAt: Date }>`
      SELECT id, name, created_at AS "createdAt"
      FROM organization_chart
      WHERE organization_id = ${actor.organizationId}
      ORDER BY created_at
    `;
    return { charts: rows.map((row) => ({ id: row.id, name: row.name, createdAt: new Date(row.createdAt).toISOString() })) };
  },
);

export const createChart = api(
  { expose: true, method: "POST", path: "/charts", auth: true },
  async (request: CreateChartRequest): Promise<Draft> => {
    const actor = actorWithRole(["owner", "editor"]);
    const name = request.name.trim();
    if (!name) throw APIError.invalidArgument("Numele organigramei este obligatoriu.");

    const chartId = randomUUID();
    const document = initialDocument();
    await inTransaction(async (tx) => {
      await tx.exec`
        INSERT INTO organization_chart (id, organization_id, name, created_by_user_id)
        VALUES (${chartId}, ${actor.organizationId}, ${name}, ${actor.userID})
      `;
      await tx.exec`
        INSERT INTO organization_chart_draft (chart_id, document, revision_token, updated_by_user_id)
        VALUES (${chartId}, ${JSON.stringify(document)}::text::jsonb, ${randomUUID()}, ${actor.userID})
      `;
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userID,
        action: "chart_created",
        subjectType: "organization_chart",
        subjectId: chartId,
        chartId,
        details: { name },
      });
    });
    return readDraft(actor.organizationId, chartId);
  },
);

export const getDraft = api(
  { expose: true, method: "GET", path: "/charts/:id/draft", auth: true },
  async (request: ChartRequest): Promise<Draft> => {
    const actor = currentActor();
    return readDraft(actor.organizationId, request.id);
  },
);

export const updateDraft = api(
  { expose: true, method: "PUT", path: "/charts/:id/draft", auth: true },
  async (request: UpdateDraftRequest): Promise<Draft> => {
    const actor = actorWithRole(["owner", "editor"]);
    return mutateDraft({
      actor,
      chartId: request.id,
      revisionToken: request.revisionToken,
      action: "chart_edited",
      mutate: (_document, current) => {
        const next = normalizeDocument(request.document);
        if (actor.accessRole !== "owner" && JSON.stringify(next.phases) !== JSON.stringify(current.document.phases)) {
          throw APIError.permissionDenied("Doar un Owner poate modifica fazele.");
        }
        return next;
      },
    });
  },
);

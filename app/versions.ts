import { randomUUID } from "node:crypto";
import { APIError, api } from "encore.dev/api";
import { recordAudit } from "./audit";
import { actorWithRole, currentActor } from "./authorization";
import { db, inTransaction, type Transaction } from "./db";
import { diffDocuments, type VersionChange } from "./diff";
import { documentHash, emptyDocument, hasContent, parseStoredDocument, type OrgChartDocument } from "./document";
import { lintDocument, type LintResult } from "./linter";
import { lockDraft, readDraft, writeDraft, type Draft } from "./org-chart";

export type VersionStatus = "saved" | "in_review" | "approved" | "rejected" | "published" | "superseded";

export interface VersionSummary {
  id: string;
  number: number;
  status: VersionStatus;
  note: string;
  authorUsername: string;
  createdAt: string;
  changeCount: number;
  restoredFromVersionNumber?: number;
  submittedAt?: string;
  decidedByUsername?: string;
  decidedAt?: string;
  decisionComment?: string;
  publishedAt?: string;
}

interface ChartVersionsRequest {
  id: string;
}

interface LintChartRequest {
  id: string;
  versionId?: string;
}

interface ChartVersionRequest {
  id: string;
  versionId: string;
}

interface SaveVersionRequest {
  id: string;
  note: string;
}

interface DecideVersionRequest {
  id: string;
  versionId: string;
  decision: "approve" | "reject";
  comment: string;
}

interface RestoreVersionRequest {
  id: string;
  versionId: string;
  discardDraftChanges: boolean;
}

interface CompareRequest {
  id: string;
  from: string;
  to: string;
}

interface ListVersionsResponse {
  versions: VersionSummary[];
  hasUnsavedChanges: boolean;
  latestVersionId?: string;
  publishedVersionId?: string;
}

interface VersionDetailResponse {
  version: VersionSummary;
  document: OrgChartDocument;
}

interface CompareResponse {
  changes: VersionChange[];
}

interface VersionRow {
  id: string;
  number: number;
  status: VersionStatus;
  note: string;
  authorUsername: string;
  createdAt: Date;
  changeCount: number;
  restoredFromVersionNumber: number | null;
  submittedAt: Date | null;
  decidedByUsername: string | null;
  decidedAt: Date | null;
  decisionComment: string | null;
  publishedAt: Date | null;
}

interface LockedVersion {
  id: string;
  number: number;
  status: VersionStatus;
  snapshotText: string;
}

interface LatestVersion {
  id: string;
  number: number;
  snapshotHash: string;
  snapshotText: string;
}

type Queryable = Pick<Transaction, "queryRow" | "queryAll">;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireVersionId(value: string): string {
  if (!uuidPattern.test(value)) throw APIError.notFound("Versiunea nu există.");
  return value;
}

function iso(value: Date | null): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toSummary(row: VersionRow): VersionSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    note: row.note,
    authorUsername: row.authorUsername,
    createdAt: new Date(row.createdAt).toISOString(),
    changeCount: row.changeCount,
    restoredFromVersionNumber: row.restoredFromVersionNumber ?? undefined,
    submittedAt: iso(row.submittedAt),
    decidedByUsername: row.decidedByUsername ?? undefined,
    decidedAt: iso(row.decidedAt),
    decisionComment: row.decisionComment ?? undefined,
    publishedAt: iso(row.publishedAt),
  };
}

async function listSummaries(organizationId: string, chartId: string): Promise<VersionSummary[]> {
  const rows = await db.queryAll<VersionRow>`
    SELECT v.id, v.number, v.status, v.note, author.username AS "authorUsername", v.created_at AS "createdAt",
           v.change_count AS "changeCount", source.number AS "restoredFromVersionNumber", v.submitted_at AS "submittedAt",
           decider.username AS "decidedByUsername", v.decided_at AS "decidedAt", v.decision_comment AS "decisionComment",
           v.published_at AS "publishedAt"
    FROM org_version v
    JOIN organization_chart c ON c.id = v.chart_id
    JOIN user_account author ON author.id = v.author_user_id
    LEFT JOIN user_account decider ON decider.id = v.decided_by_user_id
    LEFT JOIN org_version source ON source.id = v.restored_from_version_id
    WHERE v.chart_id = ${chartId} AND c.organization_id = ${organizationId}
    ORDER BY v.number DESC
  `;
  return rows.map(toSummary);
}

async function findSummary(executor: Queryable, organizationId: string, chartId: string, versionId: string): Promise<VersionSummary> {
  const row = await executor.queryRow<VersionRow>`
    SELECT v.id, v.number, v.status, v.note, author.username AS "authorUsername", v.created_at AS "createdAt",
           v.change_count AS "changeCount", source.number AS "restoredFromVersionNumber", v.submitted_at AS "submittedAt",
           decider.username AS "decidedByUsername", v.decided_at AS "decidedAt", v.decision_comment AS "decisionComment",
           v.published_at AS "publishedAt"
    FROM org_version v
    JOIN organization_chart c ON c.id = v.chart_id
    JOIN user_account author ON author.id = v.author_user_id
    LEFT JOIN user_account decider ON decider.id = v.decided_by_user_id
    LEFT JOIN org_version source ON source.id = v.restored_from_version_id
    WHERE v.id = ${versionId} AND v.chart_id = ${chartId} AND c.organization_id = ${organizationId}
  `;
  if (!row) throw APIError.notFound("Versiunea nu există.");
  return toSummary(row);
}

export async function readSnapshot(executor: Queryable, organizationId: string, chartId: string, versionId: string): Promise<OrgChartDocument> {
  const row = await executor.queryRow<{ snapshotText: string }>`
    SELECT v.snapshot::text AS "snapshotText"
    FROM org_version v
    JOIN organization_chart c ON c.id = v.chart_id
    WHERE v.id = ${requireVersionId(versionId)} AND v.chart_id = ${chartId} AND c.organization_id = ${organizationId}
  `;
  if (!row) throw APIError.notFound("Versiunea nu există.");
  return parseStoredDocument(row.snapshotText);
}

async function lockVersion(tx: Transaction, organizationId: string, chartId: string, versionId: string): Promise<LockedVersion> {
  const row = await tx.queryRow<LockedVersion>`
    SELECT v.id, v.number, v.status, v.snapshot::text AS "snapshotText"
    FROM org_version v
    JOIN organization_chart c ON c.id = v.chart_id
    WHERE v.id = ${requireVersionId(versionId)} AND v.chart_id = ${chartId} AND c.organization_id = ${organizationId}
    FOR UPDATE OF v
  `;
  if (!row) throw APIError.notFound("Versiunea nu există.");
  return row;
}

async function latestVersion(executor: Queryable, chartId: string): Promise<LatestVersion | null> {
  return executor.queryRow<LatestVersion>`
    SELECT id, number, snapshot_hash AS "snapshotHash", snapshot::text AS "snapshotText"
    FROM org_version
    WHERE chart_id = ${chartId}
    ORDER BY number DESC
    LIMIT 1
  `;
}

function hasUnsavedChanges(draft: Draft, latest: LatestVersion | null): boolean {
  return latest ? documentHash(draft.document) !== latest.snapshotHash : hasContent(draft.document);
}

export const lintChart = api(
  { expose: true, method: "GET", path: "/charts/:id/lint", auth: true },
  async (request: LintChartRequest): Promise<LintResult> => {
    const actor = currentActor();
    if (request.versionId) return lintDocument(await readSnapshot(db, actor.organizationId, request.id, request.versionId));
    const draft = await readDraft(actor.organizationId, request.id);
    return lintDocument(draft.document);
  },
);

export const listVersions = api(
  { expose: true, method: "GET", path: "/charts/:id/versions", auth: true },
  async (request: ChartVersionsRequest): Promise<ListVersionsResponse> => {
    const actor = currentActor();
    const draft = await readDraft(actor.organizationId, request.id);
    const versions = await listSummaries(actor.organizationId, request.id);
    const latest = await latestVersion(db, request.id);
    return {
      versions,
      hasUnsavedChanges: hasUnsavedChanges(draft, latest),
      latestVersionId: latest?.id,
      publishedVersionId: versions.find((version) => version.status === "published")?.id,
    };
  },
);

export const getVersion = api(
  { expose: true, method: "GET", path: "/charts/:id/versions/:versionId", auth: true },
  async (request: ChartVersionRequest): Promise<VersionDetailResponse> => {
    const actor = currentActor();
    const document = await readSnapshot(db, actor.organizationId, request.id, request.versionId);
    const version = await findSummary(db, actor.organizationId, request.id, request.versionId);
    return { version, document };
  },
);

export const saveVersion = api(
  { expose: true, method: "POST", path: "/charts/:id/versions", auth: true },
  async (request: SaveVersionRequest): Promise<VersionSummary> => {
    const actor = actorWithRole(["owner", "editor"]);
    const note = request.note.trim();
    if (note.length < 10) throw APIError.invalidArgument("Nota de modificare trebuie să aibă cel puțin 10 caractere.");

    return inTransaction(async (tx) => {
      const draft = await lockDraft(tx, actor.organizationId, request.id);
      const latest = await latestVersion(tx, request.id);
      const hash = documentHash(draft.document);
      if (latest && latest.snapshotHash === hash) {
        throw APIError.failedPrecondition("Ciorna este identică cu ultima versiune. Nu se creează o versiune nouă.");
      }
      if (!latest && !hasContent(draft.document)) {
        throw APIError.failedPrecondition("Ciorna nu conține încă divizii, roluri sau reguli de salvat.");
      }

      const previous = latest ? parseStoredDocument(latest.snapshotText) : emptyDocument();
      const changeCount = diffDocuments(previous, draft.document).length;
      const source = await tx.queryRow<{ restoredFrom: string | null }>`
        SELECT restored_from_version_id AS "restoredFrom" FROM organization_chart_draft WHERE chart_id = ${request.id}
      `;
      const id = randomUUID();
      const number = (latest?.number ?? 0) + 1;
      await tx.exec`
        INSERT INTO org_version (id, chart_id, number, status, note, author_user_id, snapshot, snapshot_hash, change_count, restored_from_version_id)
        VALUES (${id}, ${request.id}, ${number}, 'saved', ${note}, ${actor.userID}, ${JSON.stringify(draft.document)}::text::jsonb, ${hash}, ${changeCount}, ${source?.restoredFrom ?? null})
      `;
      await tx.exec`UPDATE organization_chart_draft SET restored_from_version_id = NULL WHERE chart_id = ${request.id}`;
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userID,
        action: "version_saved",
        subjectType: "org_version",
        subjectId: id,
        chartId: request.id,
        beforeVersionId: latest?.id ?? null,
        afterVersionId: id,
        details: { number, changeCount },
      });
      return findSummary(tx, actor.organizationId, request.id, id);
    });
  },
);

export const submitVersion = api(
  { expose: true, method: "POST", path: "/charts/:id/versions/:versionId/submit", auth: true },
  async (request: ChartVersionRequest): Promise<VersionSummary> => {
    const actor = actorWithRole(["owner", "editor"]);
    return inTransaction(async (tx) => {
      const version = await lockVersion(tx, actor.organizationId, request.id, request.versionId);
      if (version.status !== "saved") throw APIError.failedPrecondition("Doar o versiune salvată poate fi trimisă spre aprobare.");
      const lint = lintDocument(parseStoredDocument(version.snapshotText));
      if (lint.errorCount > 0) {
        throw APIError.failedPrecondition(
          `Versiunea are ${lint.errorCount} erori de validare. Corectează-le în ciornă și salvează o versiune nouă.`,
        );
      }
      await tx.exec`
        UPDATE org_version SET status = 'in_review', submitted_by_user_id = ${actor.userID}, submitted_at = CURRENT_TIMESTAMP
        WHERE id = ${version.id}
      `;
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userID,
        action: "version_submitted",
        subjectType: "org_version",
        subjectId: version.id,
        chartId: request.id,
        afterVersionId: version.id,
        details: { number: version.number, warningCount: lint.warningCount },
      });
      return findSummary(tx, actor.organizationId, request.id, version.id);
    });
  },
);

export const decideVersion = api(
  { expose: true, method: "POST", path: "/charts/:id/versions/:versionId/decision", auth: true },
  async (request: DecideVersionRequest): Promise<VersionSummary> => {
    const actor = actorWithRole(["approver"]);
    const comment = request.comment.trim();
    if (!comment) throw APIError.invalidArgument("Comentariul deciziei este obligatoriu.");
    if (request.decision !== "approve" && request.decision !== "reject") throw APIError.invalidArgument("Decizia nu este suportată.");
    const status: VersionStatus = request.decision === "approve" ? "approved" : "rejected";

    return inTransaction(async (tx) => {
      const version = await lockVersion(tx, actor.organizationId, request.id, request.versionId);
      if (version.status !== "in_review") throw APIError.failedPrecondition("Doar o versiune aflată în aprobare poate primi o decizie.");
      await tx.exec`
        UPDATE org_version
        SET status = ${status}, decided_by_user_id = ${actor.userID}, decided_at = CURRENT_TIMESTAMP, decision_comment = ${comment}
        WHERE id = ${version.id}
      `;
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userID,
        action: status === "approved" ? "version_approved" : "version_rejected",
        subjectType: "org_version",
        subjectId: version.id,
        chartId: request.id,
        outcome: status,
        afterVersionId: version.id,
        details: { number: version.number, comment },
      });
      return findSummary(tx, actor.organizationId, request.id, version.id);
    });
  },
);

export const publishVersion = api(
  { expose: true, method: "POST", path: "/charts/:id/versions/:versionId/publish", auth: true },
  async (request: ChartVersionRequest): Promise<VersionSummary> => {
    const actor = actorWithRole(["approver"]);
    return inTransaction(async (tx) => {
      const chart = await tx.queryRow<{ id: string }>`
        SELECT id FROM organization_chart WHERE id = ${request.id} AND organization_id = ${actor.organizationId} FOR UPDATE
      `;
      if (!chart) throw APIError.notFound("Organigrama nu există.");
      const version = await lockVersion(tx, actor.organizationId, request.id, request.versionId);
      if (version.status !== "approved") throw APIError.failedPrecondition("Doar o versiune aprobată poate fi publicată.");

      // The previous publication is superseded in the same transaction, so a chart has one published version.
      const previous = await tx.queryRow<{ id: string }>`
        UPDATE org_version SET status = 'superseded' WHERE chart_id = ${request.id} AND status = 'published' RETURNING id
      `;
      await tx.exec`
        UPDATE org_version SET status = 'published', published_by_user_id = ${actor.userID}, published_at = CURRENT_TIMESTAMP
        WHERE id = ${version.id}
      `;
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userID,
        action: "version_published",
        subjectType: "org_version",
        subjectId: version.id,
        chartId: request.id,
        beforeVersionId: previous?.id ?? null,
        afterVersionId: version.id,
        details: { number: version.number },
      });
      return findSummary(tx, actor.organizationId, request.id, version.id);
    });
  },
);

export const restoreVersion = api(
  { expose: true, method: "POST", path: "/charts/:id/versions/:versionId/restore", auth: true },
  async (request: RestoreVersionRequest): Promise<Draft> => {
    const actor = actorWithRole(["owner"]);
    return inTransaction(async (tx) => {
      const draft = await lockDraft(tx, actor.organizationId, request.id);
      const snapshot = await readSnapshot(tx, actor.organizationId, request.id, request.versionId);
      const latest = await latestVersion(tx, request.id);
      if (hasUnsavedChanges(draft, latest) && !request.discardDraftChanges) {
        throw APIError.failedPrecondition("Ciorna are modificări nesalvate. Salvează-le ca versiune sau renunță la ele înainte de restaurare.");
      }
      // Restoration copies the snapshot into the draft. Existing versions do not change.
      const restored = await writeDraft(tx, actor, draft, snapshot);
      await tx.exec`UPDATE organization_chart_draft SET restored_from_version_id = ${request.versionId} WHERE chart_id = ${request.id}`;
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userID,
        action: "version_restored",
        subjectType: "organization_chart",
        subjectId: request.id,
        chartId: request.id,
        beforeVersionId: latest?.id ?? null,
        afterVersionId: request.versionId,
        details: { discardedDraftChanges: request.discardDraftChanges },
      });
      return restored;
    });
  },
);

export const compareVersions = api(
  { expose: true, method: "GET", path: "/charts/:id/compare", auth: true },
  async (request: CompareRequest): Promise<CompareResponse> => {
    const actor = currentActor();
    const load = async (reference: string): Promise<OrgChartDocument> => {
      if (reference === "draft") return (await readDraft(actor.organizationId, request.id)).document;
      return readSnapshot(db, actor.organizationId, request.id, reference);
    };
    const before = await load(request.from);
    const after = await load(request.to);
    return { changes: diffDocuments(before, after) };
  },
);

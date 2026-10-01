import { randomUUID } from "node:crypto";
import type { Transaction } from "./db";

export type AuditDetails = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  chartId?: string | null;
  outcome?: string;
  beforeVersionId?: string | null;
  afterVersionId?: string | null;
  details?: AuditDetails;
}

// Audit records are written in the same transaction as the governed change.
export async function recordAudit(tx: Transaction, entry: AuditEntry): Promise<void> {
  await tx.exec`
    INSERT INTO audit_record (
      id, organization_id, actor_user_id, action, subject_type, subject_id,
      chart_id, outcome, before_version_id, after_version_id, details
    ) VALUES (
      ${randomUUID()}, ${entry.organizationId}, ${entry.actorUserId}, ${entry.action}, ${entry.subjectType}, ${entry.subjectId},
      ${entry.chartId ?? null}, ${entry.outcome ?? "succeeded"}, ${entry.beforeVersionId ?? null}, ${entry.afterVersionId ?? null},
      ${JSON.stringify(entry.details ?? {})}::text::jsonb
    )
  `;
}

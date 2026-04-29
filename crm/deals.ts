import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { db } from "./db";

export const DEAL_STAGES = [
  "new",
  "qualified",
  "meeting",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export interface Deal {
  id: number;
  contactId?: number;
  contactName?: string;
  title: string;
  valueCents: number;
  currency: string;
  stage: string;
  probability: number;
  expectedCloseDate?: string;
  notes?: string;
  wonAt?: string;
  lostAt?: string;
  lostReason?: string;
  createdAt: string;
  updatedAt: string;
}

interface DealRow {
  id: number;
  contact_id: number | null;
  contact_name: string | null;
  title: string;
  value_cents: string | number;
  currency: string;
  stage: string;
  probability: number;
  expected_close_date: Date | null;
  notes: string | null;
  won_at: Date | null;
  lost_at: Date | null;
  lost_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapDeal(row: DealRow): Deal {
  return {
    id: Number(row.id),
    contactId: row.contact_id != null ? Number(row.contact_id) : undefined,
    contactName: row.contact_name ?? undefined,
    title: row.title,
    valueCents: Number(row.value_cents),
    currency: row.currency,
    stage: row.stage,
    probability: row.probability,
    expectedCloseDate: row.expected_close_date?.toISOString().slice(0, 10),
    notes: row.notes ?? undefined,
    wonAt: row.won_at?.toISOString(),
    lostAt: row.lost_at?.toISOString(),
    lostReason: row.lost_reason ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

interface ListDealsResponse {
  deals: Deal[];
}

export const listDeals = api(
  { expose: true, method: "GET", path: "/crm/deals", auth: true },
  async (): Promise<ListDealsResponse> => {
    const auth = getAuthData()!;
    const deals: Deal[] = [];
    const rows = db.query<DealRow>`
      SELECT d.id, d.contact_id, c.full_name AS contact_name, d.title, d.value_cents,
             d.currency, d.stage, d.probability, d.expected_close_date, d.notes,
             d.won_at, d.lost_at, d.lost_reason, d.created_at, d.updated_at
      FROM deals d
      LEFT JOIN contacts c ON c.id = d.contact_id
      WHERE d.owner_id = ${auth.userID}
      ORDER BY d.updated_at DESC
    `;
    for await (const row of rows) {
      deals.push(mapDeal(row));
    }
    return { deals };
  }
);

interface CreateDealRequest {
  title: string;
  contactId?: number;
  valueCents?: number;
  currency?: string;
  stage?: DealStage;
  probability?: number;
  expectedCloseDate?: string;
  notes?: string;
}

export const createDeal = api(
  { expose: true, method: "POST", path: "/crm/deals", auth: true },
  async (req: CreateDealRequest): Promise<Deal> => {
    const auth = getAuthData()!;
    if (!req.title?.trim()) {
      throw APIError.invalidArgument("title is required");
    }
    const stage = req.stage ?? "new";
    if (!DEAL_STAGES.includes(stage as DealStage)) {
      throw APIError.invalidArgument(`invalid stage: ${stage}`);
    }
    const row = await db.queryRow<DealRow>`
      WITH inserted AS (
        INSERT INTO deals (owner_id, contact_id, title, value_cents, currency, stage,
                           probability, expected_close_date, notes)
        VALUES (
          ${auth.userID},
          ${req.contactId ?? null},
          ${req.title},
          ${req.valueCents ?? 0},
          ${req.currency ?? "EUR"},
          ${stage},
          ${req.probability ?? stageDefaultProbability(stage)},
          ${req.expectedCloseDate ?? null},
          ${req.notes ?? null}
        )
        RETURNING *
      )
      SELECT i.id, i.contact_id, c.full_name AS contact_name, i.title, i.value_cents,
             i.currency, i.stage, i.probability, i.expected_close_date, i.notes,
             i.won_at, i.lost_at, i.lost_reason, i.created_at, i.updated_at
      FROM inserted i
      LEFT JOIN contacts c ON c.id = i.contact_id
    `;
    return mapDeal(row!);
  }
);

interface MoveDealStageRequest {
  id: number;
  stage: DealStage;
  lostReason?: string;
}

export const moveDealStage = api(
  { expose: true, method: "POST", path: "/crm/deals/:id/stage", auth: true },
  async (req: MoveDealStageRequest): Promise<Deal> => {
    const auth = getAuthData()!;
    if (!DEAL_STAGES.includes(req.stage)) {
      throw APIError.invalidArgument(`invalid stage: ${req.stage}`);
    }
    const wonAt = req.stage === "won" ? new Date() : null;
    const lostAt = req.stage === "lost" ? new Date() : null;
    const row = await db.queryRow<DealRow>`
      WITH updated AS (
        UPDATE deals SET
          stage = ${req.stage},
          probability = ${stageDefaultProbability(req.stage)},
          won_at = ${wonAt},
          lost_at = ${lostAt},
          lost_reason = COALESCE(${req.lostReason ?? null}, lost_reason),
          updated_at = NOW()
        WHERE id = ${req.id} AND owner_id = ${auth.userID}
        RETURNING *
      )
      SELECT u.id, u.contact_id, c.full_name AS contact_name, u.title, u.value_cents,
             u.currency, u.stage, u.probability, u.expected_close_date, u.notes,
             u.won_at, u.lost_at, u.lost_reason, u.created_at, u.updated_at
      FROM updated u
      LEFT JOIN contacts c ON c.id = u.contact_id
    `;
    if (!row) throw APIError.notFound("deal not found");
    return mapDeal(row);
  }
);

interface UpdateDealRequest {
  id: number;
  title?: string;
  contactId?: number;
  valueCents?: number;
  currency?: string;
  probability?: number;
  expectedCloseDate?: string;
  notes?: string;
}

export const updateDeal = api(
  { expose: true, method: "POST", path: "/crm/deals/:id/update", auth: true },
  async (req: UpdateDealRequest): Promise<Deal> => {
    const auth = getAuthData()!;
    const row = await db.queryRow<DealRow>`
      WITH updated AS (
        UPDATE deals SET
          title = COALESCE(${req.title ?? null}, title),
          contact_id = COALESCE(${req.contactId ?? null}, contact_id),
          value_cents = COALESCE(${req.valueCents ?? null}, value_cents),
          currency = COALESCE(${req.currency ?? null}, currency),
          probability = COALESCE(${req.probability ?? null}, probability),
          expected_close_date = COALESCE(${req.expectedCloseDate ?? null}, expected_close_date),
          notes = COALESCE(${req.notes ?? null}, notes),
          updated_at = NOW()
        WHERE id = ${req.id} AND owner_id = ${auth.userID}
        RETURNING *
      )
      SELECT u.id, u.contact_id, c.full_name AS contact_name, u.title, u.value_cents,
             u.currency, u.stage, u.probability, u.expected_close_date, u.notes,
             u.won_at, u.lost_at, u.lost_reason, u.created_at, u.updated_at
      FROM updated u
      LEFT JOIN contacts c ON c.id = u.contact_id
    `;
    if (!row) throw APIError.notFound("deal not found");
    return mapDeal(row);
  }
);

interface DeleteDealParams {
  id: number;
}

interface DeleteDealResponse {
  success: boolean;
}

export const deleteDeal = api(
  { expose: true, method: "DELETE", path: "/crm/deals/:id", auth: true },
  async ({ id }: DeleteDealParams): Promise<DeleteDealResponse> => {
    const auth = getAuthData()!;
    await db.exec`
      DELETE FROM deals WHERE id = ${id} AND owner_id = ${auth.userID}
    `;
    return { success: true };
  }
);

function stageDefaultProbability(stage: string): number {
  switch (stage) {
    case "new":
      return 10;
    case "qualified":
      return 25;
    case "meeting":
      return 40;
    case "proposal":
      return 60;
    case "negotiation":
      return 80;
    case "won":
      return 100;
    case "lost":
      return 0;
    default:
      return 10;
  }
}

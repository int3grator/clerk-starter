import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { db } from "./db";

export interface Meeting {
  id: number;
  contactId?: number;
  contactName?: string;
  dealId?: number;
  dealTitle?: string;
  title: string;
  location?: string;
  startsAt: string;
  endsAt?: string;
  agenda?: string;
  outcome?: string;
  summary?: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MeetingRow {
  id: number;
  contact_id: number | null;
  contact_name: string | null;
  deal_id: number | null;
  deal_title: string | null;
  title: string;
  location: string | null;
  starts_at: Date;
  ends_at: Date | null;
  agenda: string | null;
  outcome: string | null;
  summary: string | null;
  completed: boolean;
  created_at: Date;
  updated_at: Date;
}

export function mapMeeting(row: MeetingRow): Meeting {
  return {
    id: Number(row.id),
    contactId: row.contact_id != null ? Number(row.contact_id) : undefined,
    contactName: row.contact_name ?? undefined,
    dealId: row.deal_id != null ? Number(row.deal_id) : undefined,
    dealTitle: row.deal_title ?? undefined,
    title: row.title,
    location: row.location ?? undefined,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString(),
    agenda: row.agenda ?? undefined,
    outcome: row.outcome ?? undefined,
    summary: row.summary ?? undefined,
    completed: row.completed,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

interface ListMeetingsResponse {
  meetings: Meeting[];
}

export const listMeetings = api(
  { expose: true, method: "GET", path: "/crm/meetings", auth: true },
  async (): Promise<ListMeetingsResponse> => {
    const auth = getAuthData()!;
    const meetings: Meeting[] = [];
    const rows = db.query<MeetingRow>`
      SELECT m.id, m.contact_id, c.full_name AS contact_name,
             m.deal_id, d.title AS deal_title,
             m.title, m.location, m.starts_at, m.ends_at, m.agenda,
             m.outcome, m.summary, m.completed, m.created_at, m.updated_at
      FROM meetings m
      LEFT JOIN contacts c ON c.id = m.contact_id
      LEFT JOIN deals d ON d.id = m.deal_id
      WHERE m.owner_id = ${auth.userID}
      ORDER BY m.starts_at ASC
    `;
    for await (const row of rows) {
      meetings.push(mapMeeting(row));
    }
    return { meetings };
  }
);

interface CreateMeetingRequest {
  title: string;
  startsAt: string;
  endsAt?: string;
  contactId?: number;
  dealId?: number;
  location?: string;
  agenda?: string;
}

export const createMeeting = api(
  { expose: true, method: "POST", path: "/crm/meetings", auth: true },
  async (req: CreateMeetingRequest): Promise<Meeting> => {
    const auth = getAuthData()!;
    if (!req.title?.trim()) {
      throw APIError.invalidArgument("title is required");
    }
    if (!req.startsAt) {
      throw APIError.invalidArgument("startsAt is required");
    }
    const row = await db.queryRow<MeetingRow>`
      WITH inserted AS (
        INSERT INTO meetings (owner_id, contact_id, deal_id, title, location,
                              starts_at, ends_at, agenda)
        VALUES (
          ${auth.userID},
          ${req.contactId ?? null},
          ${req.dealId ?? null},
          ${req.title},
          ${req.location ?? null},
          ${req.startsAt},
          ${req.endsAt ?? null},
          ${req.agenda ?? null}
        )
        RETURNING *
      )
      SELECT i.id, i.contact_id, c.full_name AS contact_name,
             i.deal_id, d.title AS deal_title,
             i.title, i.location, i.starts_at, i.ends_at, i.agenda,
             i.outcome, i.summary, i.completed, i.created_at, i.updated_at
      FROM inserted i
      LEFT JOIN contacts c ON c.id = i.contact_id
      LEFT JOIN deals d ON d.id = i.deal_id
    `;
    return mapMeeting(row!);
  }
);

interface CompleteMeetingRequest {
  id: number;
  outcome?: string;
  summary?: string;
}

export const completeMeeting = api(
  { expose: true, method: "POST", path: "/crm/meetings/:id/complete", auth: true },
  async (req: CompleteMeetingRequest): Promise<Meeting> => {
    const auth = getAuthData()!;
    const row = await db.queryRow<MeetingRow>`
      WITH updated AS (
        UPDATE meetings SET
          completed = true,
          outcome = COALESCE(${req.outcome ?? null}, outcome),
          summary = COALESCE(${req.summary ?? null}, summary),
          updated_at = NOW()
        WHERE id = ${req.id} AND owner_id = ${auth.userID}
        RETURNING *
      )
      SELECT u.id, u.contact_id, c.full_name AS contact_name,
             u.deal_id, d.title AS deal_title,
             u.title, u.location, u.starts_at, u.ends_at, u.agenda,
             u.outcome, u.summary, u.completed, u.created_at, u.updated_at
      FROM updated u
      LEFT JOIN contacts c ON c.id = u.contact_id
      LEFT JOIN deals d ON d.id = u.deal_id
    `;
    if (!row) throw APIError.notFound("meeting not found");

    // Touch contact last_contacted_at
    if (row.contact_id != null) {
      await db.exec`
        UPDATE contacts SET last_contacted_at = NOW(), updated_at = NOW()
        WHERE id = ${row.contact_id} AND owner_id = ${auth.userID}
      `;
    }

    return mapMeeting(row);
  }
);

interface DeleteMeetingParams {
  id: number;
}

interface DeleteMeetingResponse {
  success: boolean;
}

export const deleteMeeting = api(
  { expose: true, method: "DELETE", path: "/crm/meetings/:id", auth: true },
  async ({ id }: DeleteMeetingParams): Promise<DeleteMeetingResponse> => {
    const auth = getAuthData()!;
    await db.exec`
      DELETE FROM meetings WHERE id = ${id} AND owner_id = ${auth.userID}
    `;
    return { success: true };
  }
);

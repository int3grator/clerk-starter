import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { db } from "./db";

export interface Activity {
  id: number;
  contactId?: number;
  contactName?: string;
  dealId?: number;
  dealTitle?: string;
  type: string;
  title: string;
  description?: string;
  dueAt?: string;
  priority: number;
  completed: boolean;
  completedAt?: string;
  generatedByAssistant: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ActivityRow {
  id: number;
  contact_id: number | null;
  contact_name: string | null;
  deal_id: number | null;
  deal_title: string | null;
  type: string;
  title: string;
  description: string | null;
  due_at: Date | null;
  priority: number;
  completed: boolean;
  completed_at: Date | null;
  generated_by_assistant: boolean;
  created_at: Date;
  updated_at: Date;
}

export function mapActivity(row: ActivityRow): Activity {
  return {
    id: Number(row.id),
    contactId: row.contact_id != null ? Number(row.contact_id) : undefined,
    contactName: row.contact_name ?? undefined,
    dealId: row.deal_id != null ? Number(row.deal_id) : undefined,
    dealTitle: row.deal_title ?? undefined,
    type: row.type,
    title: row.title,
    description: row.description ?? undefined,
    dueAt: row.due_at?.toISOString(),
    priority: row.priority,
    completed: row.completed,
    completedAt: row.completed_at?.toISOString(),
    generatedByAssistant: row.generated_by_assistant,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

interface ListActivitiesParams {
  completed?: boolean;
}

interface ListActivitiesResponse {
  activities: Activity[];
}

export const listActivities = api(
  { expose: true, method: "GET", path: "/crm/activities", auth: true },
  async ({ completed }: ListActivitiesParams): Promise<ListActivitiesResponse> => {
    const auth = getAuthData()!;
    const activities: Activity[] = [];
    const showCompleted = completed ?? false;
    const rows = db.query<ActivityRow>`
      SELECT a.id, a.contact_id, c.full_name AS contact_name,
             a.deal_id, d.title AS deal_title,
             a.type, a.title, a.description, a.due_at, a.priority,
             a.completed, a.completed_at, a.generated_by_assistant,
             a.created_at, a.updated_at
      FROM activities a
      LEFT JOIN contacts c ON c.id = a.contact_id
      LEFT JOIN deals d ON d.id = a.deal_id
      WHERE a.owner_id = ${auth.userID}
        AND a.completed = ${showCompleted}
      ORDER BY
        CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END,
        a.due_at ASC,
        a.priority ASC
    `;
    for await (const row of rows) {
      activities.push(mapActivity(row));
    }
    return { activities };
  }
);

interface CreateActivityRequest {
  type: string;
  title: string;
  description?: string;
  contactId?: number;
  dealId?: number;
  dueAt?: string;
  priority?: number;
}

export const createActivity = api(
  { expose: true, method: "POST", path: "/crm/activities", auth: true },
  async (req: CreateActivityRequest): Promise<Activity> => {
    const auth = getAuthData()!;
    if (!req.title?.trim()) {
      throw APIError.invalidArgument("title is required");
    }
    if (!req.type?.trim()) {
      throw APIError.invalidArgument("type is required");
    }
    const row = await db.queryRow<ActivityRow>`
      WITH inserted AS (
        INSERT INTO activities (owner_id, contact_id, deal_id, type, title,
                                description, due_at, priority)
        VALUES (
          ${auth.userID},
          ${req.contactId ?? null},
          ${req.dealId ?? null},
          ${req.type},
          ${req.title},
          ${req.description ?? null},
          ${req.dueAt ?? null},
          ${req.priority ?? 2}
        )
        RETURNING *
      )
      SELECT i.id, i.contact_id, c.full_name AS contact_name,
             i.deal_id, d.title AS deal_title,
             i.type, i.title, i.description, i.due_at, i.priority,
             i.completed, i.completed_at, i.generated_by_assistant,
             i.created_at, i.updated_at
      FROM inserted i
      LEFT JOIN contacts c ON c.id = i.contact_id
      LEFT JOIN deals d ON d.id = i.deal_id
    `;
    return mapActivity(row!);
  }
);

interface CompleteActivityRequest {
  id: number;
}

export const completeActivity = api(
  { expose: true, method: "POST", path: "/crm/activities/:id/complete", auth: true },
  async ({ id }: CompleteActivityRequest): Promise<Activity> => {
    const auth = getAuthData()!;
    const row = await db.queryRow<ActivityRow>`
      WITH updated AS (
        UPDATE activities SET
          completed = true,
          completed_at = NOW(),
          updated_at = NOW()
        WHERE id = ${id} AND owner_id = ${auth.userID}
        RETURNING *
      )
      SELECT u.id, u.contact_id, c.full_name AS contact_name,
             u.deal_id, d.title AS deal_title,
             u.type, u.title, u.description, u.due_at, u.priority,
             u.completed, u.completed_at, u.generated_by_assistant,
             u.created_at, u.updated_at
      FROM updated u
      LEFT JOIN contacts c ON c.id = u.contact_id
      LEFT JOIN deals d ON d.id = u.deal_id
    `;
    if (!row) throw APIError.notFound("activity not found");

    // Touch last_contacted_at on the contact when a touch-like activity is completed.
    if (row.contact_id != null && ["call", "email", "meeting", "follow_up"].includes(row.type)) {
      await db.exec`
        UPDATE contacts SET last_contacted_at = NOW(), updated_at = NOW()
        WHERE id = ${row.contact_id} AND owner_id = ${auth.userID}
      `;
    }

    return mapActivity(row);
  }
);

interface DeleteActivityParams {
  id: number;
}

interface DeleteActivityResponse {
  success: boolean;
}

export const deleteActivity = api(
  { expose: true, method: "DELETE", path: "/crm/activities/:id", auth: true },
  async ({ id }: DeleteActivityParams): Promise<DeleteActivityResponse> => {
    const auth = getAuthData()!;
    await db.exec`
      DELETE FROM activities WHERE id = ${id} AND owner_id = ${auth.userID}
    `;
    return { success: true };
  }
);

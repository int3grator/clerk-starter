import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { db } from "./db";

export interface Contact {
  id: number;
  fullName: string;
  company?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  source?: string;
  status: string;
  notes?: string;
  lastContactedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ContactRow {
  id: number;
  full_name: string;
  company: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  last_contacted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapContact(row: ContactRow): Contact {
  return {
    id: Number(row.id),
    fullName: row.full_name,
    company: row.company ?? undefined,
    jobTitle: row.job_title ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    source: row.source ?? undefined,
    status: row.status,
    notes: row.notes ?? undefined,
    lastContactedAt: row.last_contacted_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

interface ListContactsResponse {
  contacts: Contact[];
}

export const listContacts = api(
  { expose: true, method: "GET", path: "/crm/contacts", auth: true },
  async (): Promise<ListContactsResponse> => {
    const auth = getAuthData()!;
    const contacts: Contact[] = [];
    const rows = db.query<ContactRow>`
      SELECT id, full_name, company, job_title, email, phone, source, status,
             notes, last_contacted_at, created_at, updated_at
      FROM contacts
      WHERE owner_id = ${auth.userID}
      ORDER BY updated_at DESC
    `;
    for await (const row of rows) {
      contacts.push(mapContact(row));
    }
    return { contacts };
  }
);

interface CreateContactRequest {
  fullName: string;
  company?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  source?: string;
  status?: string;
  notes?: string;
}

export const createContact = api(
  { expose: true, method: "POST", path: "/crm/contacts", auth: true },
  async (req: CreateContactRequest): Promise<Contact> => {
    const auth = getAuthData()!;
    if (!req.fullName?.trim()) {
      throw APIError.invalidArgument("fullName is required");
    }
    const row = await db.queryRow<ContactRow>`
      INSERT INTO contacts (owner_id, full_name, company, job_title, email, phone, source, status, notes)
      VALUES (
        ${auth.userID},
        ${req.fullName},
        ${req.company ?? null},
        ${req.jobTitle ?? null},
        ${req.email ?? null},
        ${req.phone ?? null},
        ${req.source ?? null},
        ${req.status ?? "lead"},
        ${req.notes ?? null}
      )
      RETURNING id, full_name, company, job_title, email, phone, source, status,
                notes, last_contacted_at, created_at, updated_at
    `;
    return mapContact(row!);
  }
);

interface GetContactParams {
  id: number;
}

interface GetContactResponse {
  contact: Contact;
}

export const getContact = api(
  { expose: true, method: "GET", path: "/crm/contacts/:id", auth: true },
  async ({ id }: GetContactParams): Promise<GetContactResponse> => {
    const auth = getAuthData()!;
    const row = await db.queryRow<ContactRow>`
      SELECT id, full_name, company, job_title, email, phone, source, status,
             notes, last_contacted_at, created_at, updated_at
      FROM contacts
      WHERE id = ${id} AND owner_id = ${auth.userID}
    `;
    if (!row) throw APIError.notFound("contact not found");
    return { contact: mapContact(row) };
  }
);

interface UpdateContactRequest {
  id: number;
  fullName?: string;
  company?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  source?: string;
  status?: string;
  notes?: string;
}

export const updateContact = api(
  { expose: true, method: "POST", path: "/crm/contacts/:id/update", auth: true },
  async (req: UpdateContactRequest): Promise<Contact> => {
    const auth = getAuthData()!;
    const row = await db.queryRow<ContactRow>`
      UPDATE contacts SET
        full_name = COALESCE(${req.fullName ?? null}, full_name),
        company = COALESCE(${req.company ?? null}, company),
        job_title = COALESCE(${req.jobTitle ?? null}, job_title),
        email = COALESCE(${req.email ?? null}, email),
        phone = COALESCE(${req.phone ?? null}, phone),
        source = COALESCE(${req.source ?? null}, source),
        status = COALESCE(${req.status ?? null}, status),
        notes = COALESCE(${req.notes ?? null}, notes),
        updated_at = NOW()
      WHERE id = ${req.id} AND owner_id = ${auth.userID}
      RETURNING id, full_name, company, job_title, email, phone, source, status,
                notes, last_contacted_at, created_at, updated_at
    `;
    if (!row) throw APIError.notFound("contact not found");
    return mapContact(row);
  }
);

interface DeleteContactParams {
  id: number;
}

interface DeleteContactResponse {
  success: boolean;
}

export const deleteContact = api(
  { expose: true, method: "DELETE", path: "/crm/contacts/:id", auth: true },
  async ({ id }: DeleteContactParams): Promise<DeleteContactResponse> => {
    const auth = getAuthData()!;
    await db.exec`
      DELETE FROM contacts WHERE id = ${id} AND owner_id = ${auth.userID}
    `;
    return { success: true };
  }
);

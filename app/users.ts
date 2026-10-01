import { randomUUID } from "node:crypto";
import { APIError, api } from "encore.dev/api";
import { getAuthData } from "encore.dev/auth";
import { hashPassword, type AccessRole, type LocalSession } from "./auth";
import { requireOwner } from "./authorization";
import { db } from "./db";

const supportedRoles: AccessRole[] = ["owner", "editor", "approver", "viewer"];

export interface UserAccount {
  id: string;
  username: string;
  accessRole: AccessRole;
  active: boolean;
  createdAt: Date;
}

function ownerSession(): LocalSession {
  const session = getAuthData<LocalSession>();
  if (!session) throw APIError.unauthenticated("missing local session");
  requireOwner(session);
  return session;
}

export const listUsers = api(
  { expose: true, method: "GET", path: "/users", auth: true },
  async (): Promise<{ users: UserAccount[] }> => {
    const session = ownerSession();
    const users = await db.queryAll<UserAccount>`
      SELECT id, username, access_role AS "accessRole", active, created_at AS "createdAt"
      FROM user_account WHERE organization_id = ${session.organizationId} ORDER BY username
    `;
    return { users };
  },
);

export const createUser = api(
  { expose: true, method: "POST", path: "/users", auth: true },
  async (request: { username: string; password: string; accessRole: AccessRole }): Promise<UserAccount> => {
    const session = ownerSession();
    const username = request.username.trim();
    if (!username || request.password.length < 12 || !supportedRoles.includes(request.accessRole)) {
      throw APIError.invalidArgument("provide a username, a password of at least 12 characters, and a supported access role");
    }
    const id = randomUUID();
    try {
      await db.exec`
        INSERT INTO user_account (id, organization_id, username, password_hash, access_role, created_by_user_id, updated_by_user_id)
        VALUES (${id}, ${session.organizationId}, ${username}, ${await hashPassword(request.password)}, ${request.accessRole}, ${session.userId}, ${session.userId});
        INSERT INTO audit_record (id, organization_id, actor_user_id, action, subject_type, subject_id)
        VALUES (${randomUUID()}, ${session.organizationId}, ${session.userId}, 'user_created', 'user_account', ${id});
      `;
    } catch {
      throw APIError.alreadyExists("a user with this username already exists");
    }
    return { id, username, accessRole: request.accessRole, active: true, createdAt: new Date() };
  },
);

export const changeUserRole = api(
  { expose: true, method: "PATCH", path: "/users/:id/role", auth: true },
  async (request: { id: string; accessRole: AccessRole }): Promise<void> => {
    const session = ownerSession();
    if (!supportedRoles.includes(request.accessRole)) throw APIError.invalidArgument("unsupported access role");
    const updated = await db.exec`
      UPDATE user_account SET access_role = ${request.accessRole}, updated_at = CURRENT_TIMESTAMP, updated_by_user_id = ${session.userId}
      WHERE id = ${request.id} AND organization_id = ${session.organizationId}
    `;
    if (updated.rowsAffected !== 1) throw APIError.notFound("local user not found");
    await db.exec`
      INSERT INTO audit_record (id, organization_id, actor_user_id, action, subject_type, subject_id, details)
      VALUES (${randomUUID()}, ${session.organizationId}, ${session.userId}, 'user_role_changed', 'user_account', ${request.id}, ${JSON.stringify({ accessRole: request.accessRole })}::jsonb)
    `;
  },
);

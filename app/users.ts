import { randomUUID } from "node:crypto";
import { APIError, api } from "encore.dev/api";
import { accessRoles, hashPassword, type AccessRole } from "./auth";
import { recordAudit } from "./audit";
import { actorWithRole } from "./authorization";
import { db, inTransaction } from "./db";

export interface UserAccount {
  id: string;
  username: string;
  accessRole: AccessRole;
  active: boolean;
  createdAt: string;
}

interface UserRow {
  id: string;
  username: string;
  accessRole: AccessRole;
  active: boolean;
  createdAt: Date;
}

interface ListUsersResponse {
  users: UserAccount[];
}

interface CreateUserRequest {
  username: string;
  password: string;
  accessRole: AccessRole;
}

interface ChangeUserRoleRequest {
  id: string;
  accessRole: AccessRole;
}

function toAccount(row: UserRow): UserAccount {
  return { ...row, createdAt: new Date(row.createdAt).toISOString() };
}

export const listUsers = api(
  { expose: true, method: "GET", path: "/users", auth: true },
  async (): Promise<ListUsersResponse> => {
    const actor = actorWithRole(["owner"]);
    const rows = await db.queryAll<UserRow>`
      SELECT id, username, access_role AS "accessRole", active, created_at AS "createdAt"
      FROM user_account
      WHERE organization_id = ${actor.organizationId}
      ORDER BY username
    `;
    return { users: rows.map(toAccount) };
  },
);

export const createUser = api(
  { expose: true, method: "POST", path: "/users", auth: true },
  async (request: CreateUserRequest): Promise<UserAccount> => {
    const actor = actorWithRole(["owner"]);
    const username = request.username.trim();
    if (!username) throw APIError.invalidArgument("Numele de utilizator este obligatoriu.");
    if (request.password.length < 12) throw APIError.invalidArgument("Parola trebuie să aibă cel puțin 12 caractere.");
    if (!accessRoles.includes(request.accessRole)) throw APIError.invalidArgument("Rolul de acces nu este suportat.");

    const duplicate = await db.queryRow<{ id: string }>`SELECT id FROM user_account WHERE username = ${username}`;
    if (duplicate) throw APIError.alreadyExists("Există deja un utilizator cu acest nume.");

    const id = randomUUID();
    const passwordHash = await hashPassword(request.password);
    await inTransaction(async (tx) => {
      await tx.exec`
        INSERT INTO user_account (id, organization_id, username, password_hash, access_role, created_by_user_id, updated_by_user_id)
        VALUES (${id}, ${actor.organizationId}, ${username}, ${passwordHash}, ${request.accessRole}, ${actor.userID}, ${actor.userID})
      `;
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userID,
        action: "user_created",
        subjectType: "user_account",
        subjectId: id,
        details: { accessRole: request.accessRole },
      });
    });
    return { id, username, accessRole: request.accessRole, active: true, createdAt: new Date().toISOString() };
  },
);

export const changeUserRole = api(
  { expose: true, method: "PATCH", path: "/users/:id/role", auth: true },
  async (request: ChangeUserRoleRequest): Promise<UserAccount> => {
    const actor = actorWithRole(["owner"]);
    if (!accessRoles.includes(request.accessRole)) throw APIError.invalidArgument("Rolul de acces nu este suportat.");

    return inTransaction(async (tx) => {
      const current = await tx.queryRow<{ accessRole: AccessRole }>`
        SELECT access_role AS "accessRole" FROM user_account
        WHERE id = ${request.id} AND organization_id = ${actor.organizationId}
        FOR UPDATE
      `;
      if (!current) throw APIError.notFound("Utilizatorul local nu există.");

      if (current.accessRole === "owner" && request.accessRole !== "owner") {
        const owners = await tx.queryRow<{ count: number }>`
          SELECT COUNT(*)::int AS count FROM user_account
          WHERE organization_id = ${actor.organizationId} AND access_role = 'owner' AND active = TRUE
        `;
        if ((owners?.count ?? 0) <= 1) throw APIError.failedPrecondition("Organizația trebuie să păstreze cel puțin un Owner activ.");
      }

      const row = await tx.queryRow<UserRow>`
        UPDATE user_account
        SET access_role = ${request.accessRole}, updated_at = CURRENT_TIMESTAMP, updated_by_user_id = ${actor.userID}
        WHERE id = ${request.id} AND organization_id = ${actor.organizationId}
        RETURNING id, username, access_role AS "accessRole", active, created_at AS "createdAt"
      `;
      if (!row) throw APIError.notFound("Utilizatorul local nu există.");

      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userID,
        action: "user_role_changed",
        subjectType: "user_account",
        subjectId: request.id,
        details: { from: current.accessRole, to: request.accessRole },
      });
      return toAccount(row);
    });
  },
);

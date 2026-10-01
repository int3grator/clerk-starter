import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { APIError, Gateway, Header, api } from "encore.dev/api";
import { authHandler, getAuthData } from "encore.dev/auth";
import { secret } from "encore.dev/config";
import { db } from "./db";

const scrypt = promisify(scryptCallback);
const bootstrapOrganizationName = secret("BootstrapOrganizationName");
const bootstrapOwnerUsername = secret("BootstrapOwnerUsername");
const bootstrapOwnerPassword = secret("BootstrapOwnerPassword");
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 7;

export type AccessRole = "owner" | "editor" | "approver" | "viewer";

export interface LocalSession {
  userId: string;
  organizationId: string;
  username: string;
  accessRole: AccessRole;
}

interface AuthParams {
  authorization: Header<"Authorization">;
}

interface StoredUser {
  id: string;
  organization_id: string;
  username: string;
  password_hash: string;
  access_role: AccessRole;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;

  const derivedKey = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
}

async function ensureBootstrapOwner(): Promise<void> {
  const existingUser = await db.queryRow<{ id: string }>`SELECT id FROM user_account LIMIT 1`;
  if (existingUser) return;

  const organizationName = bootstrapOrganizationName();
  const username = bootstrapOwnerUsername();
  const password = bootstrapOwnerPassword();
  if (!organizationName || !username || !password) {
    throw APIError.failedPrecondition(
      "set BootstrapOrganizationName, BootstrapOwnerUsername, and BootstrapOwnerPassword before local sign-in",
    );
  }

  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const passwordHash = await hashPassword(password);
  await db.exec`
    INSERT INTO organization (id, name) VALUES (${organizationId}, ${organizationName});
    INSERT INTO user_account (id, organization_id, username, password_hash, access_role)
    VALUES (${ownerId}, ${organizationId}, ${username}, ${passwordHash}, 'owner');
    INSERT INTO audit_record (id, organization_id, actor_user_id, action, subject_type, subject_id)
    VALUES (${randomUUID()}, ${organizationId}, ${ownerId}, 'bootstrap_owner_created', 'user_account', ${ownerId});
  `;
}

export const auth = authHandler<AuthParams, LocalSession>(async (params) => {
  const token = params.authorization?.replace("Bearer ", "");
  if (!token) throw APIError.unauthenticated("missing local session token");

  const session = await db.queryRow<LocalSession>`
    SELECT user_account.id AS "userId", user_account.organization_id AS "organizationId",
           user_account.username, user_account.access_role AS "accessRole"
    FROM local_session
    JOIN user_account ON user_account.id = local_session.user_account_id
    WHERE local_session.token_hash = ${tokenHash(token)}
      AND local_session.terminated_at IS NULL
      AND local_session.expires_at > CURRENT_TIMESTAMP
      AND user_account.active = TRUE
  `;
  if (!session) throw APIError.unauthenticated("invalid or expired local session");
  return session;
});

export const gateway = new Gateway({ authHandler: auth });

export const signIn = api(
  { expose: true, method: "POST", path: "/auth/sign-in" },
  async (request: { username: string; password: string }): Promise<{ sessionToken: string; session: LocalSession }> => {
    await ensureBootstrapOwner();
    const user = await db.queryRow<StoredUser>`
      SELECT id, organization_id, username, password_hash, access_role
      FROM user_account
      WHERE username = ${request.username} AND active = TRUE
      LIMIT 1
    `;
    if (!user || !(await verifyPassword(request.password, user.password_hash))) {
      throw APIError.unauthenticated("invalid username or password");
    }

    const sessionToken = randomBytes(32).toString("base64url");
    await db.exec`
      INSERT INTO local_session (id, user_account_id, token_hash, expires_at)
      VALUES (${randomUUID()}, ${user.id}, ${tokenHash(sessionToken)}, ${new Date(Date.now() + sessionLifetimeMs)})
    `;
    return {
      sessionToken,
      session: { userId: user.id, organizationId: user.organization_id, username: user.username, accessRole: user.access_role },
    };
  },
);

export const signOut = api.raw(
  { expose: true, method: "POST", path: "/auth/sign-out" },
  async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      await db.exec`UPDATE local_session SET terminated_at = CURRENT_TIMESTAMP WHERE token_hash = ${tokenHash(token)} AND terminated_at IS NULL`;
    }
    res.writeHead(204);
    res.end();
  },
);

export const currentSession = api(
  { expose: true, method: "GET", path: "/auth/session", auth: true },
  async (): Promise<LocalSession> => getAuthData()!,
);

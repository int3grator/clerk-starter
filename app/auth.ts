import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { APIError, Gateway, Header, api } from "encore.dev/api";
import { authHandler } from "encore.dev/auth";
import { secret } from "encore.dev/config";
import { recordAudit } from "./audit";
import { db, inTransaction } from "./db";

const scrypt = promisify(scryptCallback);
const bootstrapOrganizationName = secret("BootstrapOrganizationName");
const bootstrapOwnerUsername = secret("BootstrapOwnerUsername");
const bootstrapOwnerPassword = secret("BootstrapOwnerPassword");
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 7;

export type AccessRole = "owner" | "editor" | "approver" | "viewer";
export const accessRoles: AccessRole[] = ["owner", "editor", "approver", "viewer"];

// Encore requires the auth data to expose the authenticated user as userID.
export interface LocalSession {
  userID: string;
  organizationId: string;
  username: string;
  accessRole: AccessRole;
}

interface AuthParams {
  authorization: Header<"Authorization">;
}

interface StoredUser {
  id: string;
  organizationId: string;
  username: string;
  passwordHash: string;
  accessRole: AccessRole;
}

interface SignInRequest {
  username: string;
  password: string;
}

interface SignInResponse {
  sessionToken: string;
  session: LocalSession;
}

function readSecret(read: () => string): string {
  try {
    return (read() ?? "").trim();
  } catch {
    return "";
  }
}

function bearerToken(header: string | undefined): string {
  return (header ?? "").replace(/^Bearer\s+/i, "").trim();
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
}

async function ensureBootstrapOwner(): Promise<void> {
  const existingUser = await db.queryRow<{ id: string }>`SELECT id FROM user_account LIMIT 1`;
  if (existingUser) return;

  const organizationName = readSecret(bootstrapOrganizationName);
  const username = readSecret(bootstrapOwnerUsername);
  const password = readSecret(bootstrapOwnerPassword);
  if (!organizationName || !username || !password) {
    throw APIError.failedPrecondition(
      "Setează BootstrapOrganizationName, BootstrapOwnerUsername și BootstrapOwnerPassword înainte de prima autentificare.",
    );
  }

  const passwordHash = await hashPassword(password);
  await inTransaction(async (tx) => {
    await tx.queryRow`SELECT 1 AS locked FROM pg_advisory_xact_lock(7342001)`;
    const createdMeanwhile = await tx.queryRow<{ id: string }>`SELECT id FROM user_account LIMIT 1`;
    if (createdMeanwhile) return;

    const organizationId = randomUUID();
    const ownerId = randomUUID();
    await tx.exec`INSERT INTO organization (id, name) VALUES (${organizationId}, ${organizationName})`;
    await tx.exec`
      INSERT INTO user_account (id, organization_id, username, password_hash, access_role)
      VALUES (${ownerId}, ${organizationId}, ${username}, ${passwordHash}, 'owner')
    `;
    await recordAudit(tx, {
      organizationId,
      actorUserId: ownerId,
      action: "bootstrap_owner_created",
      subjectType: "user_account",
      subjectId: ownerId,
    });
  });
}

export const auth = authHandler<AuthParams, LocalSession>(async (params) => {
  const token = bearerToken(params.authorization);
  if (!token) throw APIError.unauthenticated("Sesiunea locală lipsește.");

  // The role is read on every request, so a role change applies to the next authorized request.
  const session = await db.queryRow<LocalSession>`
    SELECT user_account.id AS "userID", user_account.organization_id AS "organizationId",
           user_account.username, user_account.access_role AS "accessRole"
    FROM local_session
    JOIN user_account ON user_account.id = local_session.user_account_id
    WHERE local_session.token_hash = ${tokenHash(token)}
      AND local_session.terminated_at IS NULL
      AND local_session.expires_at > CURRENT_TIMESTAMP
      AND user_account.active = TRUE
  `;
  if (!session) throw APIError.unauthenticated("Sesiunea locală este invalidă sau a expirat.");
  return session;
});

export const gateway = new Gateway({ authHandler: auth });

export const signIn = api(
  { expose: true, method: "POST", path: "/auth/sign-in" },
  async (request: SignInRequest): Promise<SignInResponse> => {
    await ensureBootstrapOwner();
    const user = await db.queryRow<StoredUser>`
      SELECT id, organization_id AS "organizationId", username, password_hash AS "passwordHash", access_role AS "accessRole"
      FROM user_account
      WHERE username = ${request.username.trim()} AND active = TRUE
      LIMIT 1
    `;
    if (!user || !(await verifyPassword(request.password, user.passwordHash))) {
      throw APIError.unauthenticated("Nume de utilizator sau parolă incorecte.");
    }

    const sessionToken = randomBytes(32).toString("base64url");
    await db.exec`
      INSERT INTO local_session (id, user_account_id, token_hash, expires_at)
      VALUES (${randomUUID()}, ${user.id}, ${tokenHash(sessionToken)}, ${new Date(Date.now() + sessionLifetimeMs)})
    `;
    return {
      sessionToken,
      session: { userID: user.id, organizationId: user.organizationId, username: user.username, accessRole: user.accessRole },
    };
  },
);

export const signOut = api.raw(
  { expose: true, method: "POST", path: "/auth/sign-out" },
  async (req, res) => {
    const token = bearerToken(req.headers.authorization);
    if (token) {
      await db.exec`
        UPDATE local_session SET terminated_at = CURRENT_TIMESTAMP
        WHERE token_hash = ${tokenHash(token)} AND terminated_at IS NULL
      `;
    }
    res.writeHead(204);
    res.end();
  },
);

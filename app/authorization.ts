import { APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import type { AccessRole, LocalSession } from "./auth";

export function currentActor(): LocalSession {
  const session = getAuthData();
  if (!session) throw APIError.unauthenticated("Sesiunea locală lipsește sau a expirat.");
  return session;
}

export function requireRole(session: LocalSession, allowedRoles: AccessRole[]): void {
  if (!allowedRoles.includes(session.accessRole)) {
    throw APIError.permissionDenied("Rolul tău de acces nu permite această acțiune.");
  }
}

export function requireOwner(session: LocalSession): void {
  requireRole(session, ["owner"]);
}

export function actorWithRole(allowedRoles: AccessRole[]): LocalSession {
  const session = currentActor();
  requireRole(session, allowedRoles);
  return session;
}

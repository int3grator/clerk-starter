import { APIError } from "encore.dev/api";
import type { AccessRole, LocalSession } from "./auth";

export function requireRole(session: LocalSession, allowedRoles: AccessRole[]): void {
  if (!allowedRoles.includes(session.accessRole)) {
    throw APIError.permissionDenied("your access role cannot perform this action");
  }
}

export function requireOwner(session: LocalSession): void {
  requireRole(session, ["owner"]);
}

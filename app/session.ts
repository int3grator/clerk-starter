import { api } from "encore.dev/api";
import type { LocalSession } from "./auth";
import { currentActor } from "./authorization";

export const currentSession = api(
  { expose: true, method: "GET", path: "/auth/session", auth: true },
  async (): Promise<LocalSession> => currentActor(),
);

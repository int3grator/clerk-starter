import { api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { CronJob } from "encore.dev/cron";
import { db } from "./db";
import { Activity, mapActivity } from "./activities";
import { Meeting, mapMeeting } from "./meetings";

/**
 * The sales assistant: it runs in the background on behalf of the salesperson.
 * It prioritizes who to talk to, generates follow-ups, drafts emails, and
 * produces a daily briefing so the human can focus on actually meeting clients.
 */

interface PriorityItem {
  kind: "overdue_task" | "today_task" | "today_meeting" | "stale_contact" | "stalled_deal" | "hot_deal";
  title: string;
  reason: string;
  contactId?: number;
  contactName?: string;
  dealId?: number;
  dealTitle?: string;
  activityId?: number;
  meetingId?: number;
  when?: string;
  score: number;
}

interface DailyBriefingResponse {
  generatedAt: string;
  greeting: string;
  headline: string;
  todayMeetings: Meeting[];
  priorities: PriorityItem[];
  openTasks: Activity[];
  stats: {
    openLeads: number;
    activeDeals: number;
    pipelineValueCents: number;
    currency: string;
    meetingsToday: number;
    overdueTasks: number;
  };
}

export const dailyBriefing = api(
  { expose: true, method: "GET", path: "/crm/assistant/briefing", auth: true },
  async (): Promise<DailyBriefingResponse> => {
    const auth = getAuthData()!;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    // Today's meetings
    const todayMeetings: Meeting[] = [];
    const meetingRows = db.query<any>`
      SELECT m.id, m.contact_id, c.full_name AS contact_name,
             m.deal_id, d.title AS deal_title,
             m.title, m.location, m.starts_at, m.ends_at, m.agenda,
             m.outcome, m.summary, m.completed, m.created_at, m.updated_at
      FROM meetings m
      LEFT JOIN contacts c ON c.id = m.contact_id
      LEFT JOIN deals d ON d.id = m.deal_id
      WHERE m.owner_id = ${auth.userID}
        AND m.completed = false
        AND m.starts_at >= ${startOfDay}
        AND m.starts_at < ${endOfDay}
      ORDER BY m.starts_at ASC
    `;
    for await (const row of meetingRows) {
      todayMeetings.push(mapMeeting(row));
    }

    // Open tasks for today + overdue
    const openTasks: Activity[] = [];
    const taskRows = db.query<any>`
      SELECT a.id, a.contact_id, c.full_name AS contact_name,
             a.deal_id, d.title AS deal_title,
             a.type, a.title, a.description, a.due_at, a.priority,
             a.completed, a.completed_at, a.generated_by_assistant,
             a.created_at, a.updated_at
      FROM activities a
      LEFT JOIN contacts c ON c.id = a.contact_id
      LEFT JOIN deals d ON d.id = a.deal_id
      WHERE a.owner_id = ${auth.userID}
        AND a.completed = false
        AND (a.due_at IS NULL OR a.due_at < ${endOfDay})
      ORDER BY a.priority ASC,
        CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END,
        a.due_at ASC
    `;
    for await (const row of taskRows) {
      openTasks.push(mapActivity(row));
    }

    // Stats
    const stats = await db.queryRow<{
      open_leads: string;
      active_deals: string;
      pipeline_value: string;
      overdue_tasks: string;
    }>`
      SELECT
        (SELECT COUNT(*) FROM contacts WHERE owner_id = ${auth.userID} AND status IN ('lead', 'qualified')) AS open_leads,
        (SELECT COUNT(*) FROM deals WHERE owner_id = ${auth.userID} AND stage NOT IN ('won', 'lost')) AS active_deals,
        (SELECT COALESCE(SUM(value_cents), 0) FROM deals WHERE owner_id = ${auth.userID} AND stage NOT IN ('won', 'lost')) AS pipeline_value,
        (SELECT COUNT(*) FROM activities WHERE owner_id = ${auth.userID} AND completed = false AND due_at < ${now}) AS overdue_tasks
    `;

    const priorities = await computePriorities(auth.userID, now);

    const firstName = auth.firstName || auth.email?.split("@")[0] || "there";
    const hour = now.getHours();
    const greeting =
      hour < 12 ? `Bună dimineața, ${firstName}!` : hour < 18 ? `Salut, ${firstName}!` : `Bună seara, ${firstName}!`;

    const headline = buildHeadline({
      meetingsToday: todayMeetings.length,
      overdueTasks: Number(stats?.overdue_tasks ?? 0),
      topPriority: priorities[0],
    });

    return {
      generatedAt: now.toISOString(),
      greeting,
      headline,
      todayMeetings,
      priorities,
      openTasks,
      stats: {
        openLeads: Number(stats?.open_leads ?? 0),
        activeDeals: Number(stats?.active_deals ?? 0),
        pipelineValueCents: Number(stats?.pipeline_value ?? 0),
        currency: "EUR",
        meetingsToday: todayMeetings.length,
        overdueTasks: Number(stats?.overdue_tasks ?? 0),
      },
    };
  }
);

function buildHeadline(opts: {
  meetingsToday: number;
  overdueTasks: number;
  topPriority?: PriorityItem;
}): string {
  const parts: string[] = [];
  if (opts.meetingsToday > 0) {
    parts.push(`${opts.meetingsToday} întâlnire${opts.meetingsToday === 1 ? "" : "i"} azi`);
  }
  if (opts.overdueTasks > 0) {
    parts.push(`${opts.overdueTasks} task${opts.overdueTasks === 1 ? "" : "-uri"} întârziate`);
  }
  if (opts.topPriority) {
    parts.push(`focus: ${opts.topPriority.title}`);
  }
  if (parts.length === 0) {
    return "Pipeline-ul e curat. E momentul să prospectezi câțiva lead-uri noi.";
  }
  return parts.join(" · ");
}

async function computePriorities(ownerId: string, now: Date): Promise<PriorityItem[]> {
  const priorities: PriorityItem[] = [];
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const staleCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const stalledCutoff = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  // Overdue tasks
  const overdueRows = db.query<any>`
    SELECT a.id, a.title, a.due_at, a.priority,
           a.contact_id, c.full_name AS contact_name,
           a.deal_id, d.title AS deal_title
    FROM activities a
    LEFT JOIN contacts c ON c.id = a.contact_id
    LEFT JOIN deals d ON d.id = a.deal_id
    WHERE a.owner_id = ${ownerId}
      AND a.completed = false
      AND a.due_at < ${startOfDay}
    ORDER BY a.due_at ASC
    LIMIT 5
  `;
  for await (const row of overdueRows) {
    const daysLate = Math.max(
      1,
      Math.floor((now.getTime() - new Date(row.due_at).getTime()) / (24 * 60 * 60 * 1000))
    );
    priorities.push({
      kind: "overdue_task",
      title: row.title,
      reason: `Întârziat ${daysLate} zi${daysLate === 1 ? "" : "le"}`,
      contactId: row.contact_id ?? undefined,
      contactName: row.contact_name ?? undefined,
      dealId: row.deal_id ?? undefined,
      dealTitle: row.deal_title ?? undefined,
      activityId: Number(row.id),
      when: new Date(row.due_at).toISOString(),
      score: 100 + daysLate * 5,
    });
  }

  // Today's meetings
  const meetingRows = db.query<any>`
    SELECT m.id, m.title, m.starts_at, m.location,
           m.contact_id, c.full_name AS contact_name,
           m.deal_id, d.title AS deal_title
    FROM meetings m
    LEFT JOIN contacts c ON c.id = m.contact_id
    LEFT JOIN deals d ON d.id = m.deal_id
    WHERE m.owner_id = ${ownerId}
      AND m.completed = false
      AND m.starts_at >= ${startOfDay}
      AND m.starts_at < ${endOfDay}
    ORDER BY m.starts_at ASC
  `;
  for await (const row of meetingRows) {
    const startsAt = new Date(row.starts_at);
    const hours = startsAt.getHours().toString().padStart(2, "0");
    const mins = startsAt.getMinutes().toString().padStart(2, "0");
    priorities.push({
      kind: "today_meeting",
      title: row.title,
      reason: `Astăzi la ${hours}:${mins}${row.location ? ` · ${row.location}` : ""}`,
      contactId: row.contact_id ?? undefined,
      contactName: row.contact_name ?? undefined,
      dealId: row.deal_id ?? undefined,
      dealTitle: row.deal_title ?? undefined,
      meetingId: Number(row.id),
      when: startsAt.toISOString(),
      score: 90,
    });
  }

  // Tasks due today
  const todayTaskRows = db.query<any>`
    SELECT a.id, a.title, a.due_at, a.priority,
           a.contact_id, c.full_name AS contact_name,
           a.deal_id, d.title AS deal_title
    FROM activities a
    LEFT JOIN contacts c ON c.id = a.contact_id
    LEFT JOIN deals d ON d.id = a.deal_id
    WHERE a.owner_id = ${ownerId}
      AND a.completed = false
      AND a.due_at >= ${startOfDay}
      AND a.due_at < ${endOfDay}
    ORDER BY a.priority ASC, a.due_at ASC
    LIMIT 5
  `;
  for await (const row of todayTaskRows) {
    priorities.push({
      kind: "today_task",
      title: row.title,
      reason: "Scadent azi",
      contactId: row.contact_id ?? undefined,
      contactName: row.contact_name ?? undefined,
      dealId: row.deal_id ?? undefined,
      dealTitle: row.deal_title ?? undefined,
      activityId: Number(row.id),
      when: new Date(row.due_at).toISOString(),
      score: 80,
    });
  }

  // Hot deals: proposal/negotiation stage
  const hotDealRows = db.query<any>`
    SELECT d.id, d.title, d.value_cents, d.currency, d.stage, d.probability,
           d.contact_id, c.full_name AS contact_name
    FROM deals d
    LEFT JOIN contacts c ON c.id = d.contact_id
    WHERE d.owner_id = ${ownerId}
      AND d.stage IN ('proposal', 'negotiation')
    ORDER BY d.value_cents DESC
    LIMIT 3
  `;
  for await (const row of hotDealRows) {
    const valueEur = (Number(row.value_cents) / 100).toLocaleString("ro-RO");
    priorities.push({
      kind: "hot_deal",
      title: row.title,
      reason: `${row.stage} · ${valueEur} ${row.currency} · ${row.probability}% probabilitate`,
      dealId: Number(row.id),
      dealTitle: row.title,
      contactId: row.contact_id ?? undefined,
      contactName: row.contact_name ?? undefined,
      score: 70,
    });
  }

  // Stalled deals (no update in 10+ days, still active)
  const stalledRows = db.query<any>`
    SELECT d.id, d.title, d.stage, d.updated_at,
           d.contact_id, c.full_name AS contact_name
    FROM deals d
    LEFT JOIN contacts c ON c.id = d.contact_id
    WHERE d.owner_id = ${ownerId}
      AND d.stage NOT IN ('won', 'lost', 'new')
      AND d.updated_at < ${stalledCutoff}
    ORDER BY d.updated_at ASC
    LIMIT 3
  `;
  for await (const row of stalledRows) {
    const daysStalled = Math.floor((now.getTime() - new Date(row.updated_at).getTime()) / (24 * 60 * 60 * 1000));
    priorities.push({
      kind: "stalled_deal",
      title: row.title,
      reason: `Fără mișcare de ${daysStalled} zile (${row.stage})`,
      dealId: Number(row.id),
      dealTitle: row.title,
      contactId: row.contact_id ?? undefined,
      contactName: row.contact_name ?? undefined,
      score: 60,
    });
  }

  // Stale contacts (leads not contacted in 2+ weeks)
  const staleRows = db.query<any>`
    SELECT id, full_name, last_contacted_at, created_at
    FROM contacts
    WHERE owner_id = ${ownerId}
      AND status IN ('lead', 'qualified')
      AND (last_contacted_at IS NULL OR last_contacted_at < ${staleCutoff})
    ORDER BY COALESCE(last_contacted_at, created_at) ASC
    LIMIT 3
  `;
  for await (const row of staleRows) {
    priorities.push({
      kind: "stale_contact",
      title: row.full_name,
      reason: row.last_contacted_at
        ? "Niciun contact de 2+ săptămâni"
        : "Lead nou, încă necontactat",
      contactId: Number(row.id),
      contactName: row.full_name,
      score: 50,
    });
  }

  priorities.sort((a, b) => b.score - a.score);
  return priorities.slice(0, 10);
}

interface SuggestNextActionsParams {
  contactId: number;
}

interface SuggestNextActionsResponse {
  contactId: number;
  suggestions: Array<{
    type: string;
    title: string;
    description: string;
    dueInDays: number;
  }>;
}

export const suggestNextActions = api(
  { expose: true, method: "GET", path: "/crm/assistant/contact/:contactId/suggest", auth: true },
  async ({ contactId }: SuggestNextActionsParams): Promise<SuggestNextActionsResponse> => {
    const auth = getAuthData()!;
    const contact = await db.queryRow<any>`
      SELECT id, full_name, company, job_title, status, last_contacted_at, created_at
      FROM contacts
      WHERE id = ${contactId} AND owner_id = ${auth.userID}
    `;
    if (!contact) {
      return { contactId, suggestions: [] };
    }

    const dealRow = await db.queryRow<any>`
      SELECT stage, title FROM deals
      WHERE contact_id = ${contactId} AND owner_id = ${auth.userID}
        AND stage NOT IN ('won', 'lost')
      ORDER BY updated_at DESC LIMIT 1
    `;

    const suggestions: SuggestNextActionsResponse["suggestions"] = [];
    const name = contact.full_name as string;
    const firstName = name.split(" ")[0];

    if (!contact.last_contacted_at) {
      suggestions.push({
        type: "email",
        title: `Trimite email de introducere către ${firstName}`,
        description:
          `Salut ${firstName},\n\nMă bucur să iau legătura. Am observat ce faceți la ` +
          `${contact.company ?? "compania ta"} și am câteva idei care cred că v-ar putea ajuta. ` +
          `Ai 15 minute săptămâna asta pentru un call scurt?\n\nMulțumesc!`,
        dueInDays: 0,
      });
      suggestions.push({
        type: "call",
        title: `Sună ${firstName} pentru discovery`,
        description:
          `Întrebări de discovery: Care sunt cele mai mari provocări pe care le au acum? ` +
          `Ce soluții au încercat deja? Cine ia decizia finală? Care e bugetul și termenul?`,
        dueInDays: 2,
      });
    } else {
      const daysSince = Math.floor(
        (Date.now() - new Date(contact.last_contacted_at).getTime()) / (24 * 60 * 60 * 1000)
      );
      if (daysSince > 7) {
        suggestions.push({
          type: "follow_up",
          title: `Follow-up cu ${firstName} (${daysSince} zile de la ultima atingere)`,
          description:
            `Salut ${firstName},\n\nVoiam să revin să văd unde ne aflăm. E un moment bun ` +
            `să continuăm discuția? Îți trimit cu plăcere orice informații suplimentare ai nevoie.`,
          dueInDays: 0,
        });
      }
    }

    if (dealRow) {
      switch (dealRow.stage) {
        case "qualified":
          suggestions.push({
            type: "meeting",
            title: `Programează întâlnire discovery pentru "${dealRow.title}"`,
            description: "Confirmă nevoile, cine sunt stakeholderii, timing-ul și bugetul.",
            dueInDays: 2,
          });
          break;
        case "meeting":
          suggestions.push({
            type: "proposal",
            title: `Pregătește propunere pentru "${dealRow.title}"`,
            description:
              "Documentează ce ai auzit la întâlnire, include 2-3 opțiuni de preț și next steps clari.",
            dueInDays: 3,
          });
          break;
        case "proposal":
          suggestions.push({
            type: "follow_up",
            title: `Check-in la propunere "${dealRow.title}"`,
            description:
              "Întreabă dacă au avut timp să revadă propunerea și dacă sunt întrebări deschise.",
            dueInDays: 2,
          });
          break;
        case "negotiation":
          suggestions.push({
            type: "call",
            title: `Închide "${dealRow.title}"`,
            description:
              "Rezumă ce s-a agreat, confirmă obiecțiile rămase și propune un termen pentru semnare.",
            dueInDays: 1,
          });
          break;
      }
    } else if (contact.status === "qualified") {
      suggestions.push({
        type: "meeting",
        title: `Programează demo cu ${firstName}`,
        description: "Contactul e calificat — e momentul pentru un demo sau workshop cu echipa lor.",
        dueInDays: 3,
      });
    }

    return { contactId, suggestions };
  }
);

interface DraftFollowUpParams {
  meetingId: number;
}

interface DraftFollowUpResponse {
  subject: string;
  body: string;
}

export const draftMeetingFollowUp = api(
  { expose: true, method: "GET", path: "/crm/assistant/meeting/:meetingId/followup", auth: true },
  async ({ meetingId }: DraftFollowUpParams): Promise<DraftFollowUpResponse> => {
    const auth = getAuthData()!;
    const meeting = await db.queryRow<any>`
      SELECT m.title, m.agenda, m.outcome, m.summary, m.starts_at,
             c.full_name AS contact_name, c.company
      FROM meetings m
      LEFT JOIN contacts c ON c.id = m.contact_id
      WHERE m.id = ${meetingId} AND m.owner_id = ${auth.userID}
    `;
    if (!meeting) {
      return { subject: "", body: "Întâlnirea nu a fost găsită." };
    }
    const firstName = (meeting.contact_name as string | null)?.split(" ")[0] ?? "";
    const subject = `Follow-up: ${meeting.title}`;
    const lines: string[] = [];
    lines.push(firstName ? `Salut ${firstName},` : "Salut,");
    lines.push("");
    lines.push(`Îți mulțumesc pentru timpul acordat la "${meeting.title}".`);
    if (meeting.summary) {
      lines.push("");
      lines.push("Rezumat:");
      lines.push(meeting.summary);
    } else if (meeting.agenda) {
      lines.push("");
      lines.push("Ce am discutat:");
      lines.push(meeting.agenda);
    }
    if (meeting.outcome) {
      lines.push("");
      lines.push(`Next steps: ${meeting.outcome}`);
    } else {
      lines.push("");
      lines.push("Next steps: îți trimit materialele promise și revin zilele următoare.");
    }
    lines.push("");
    lines.push("Dacă mai e ceva ce pot clarifica între timp, spune-mi.");
    lines.push("");
    lines.push("Mulțumesc!");
    return { subject, body: lines.join("\n") };
  }
);

/**
 * Background worker: the assistant looks at the database each morning and
 * auto-creates follow-up tasks so the salesperson always knows what to do next.
 */
interface GenerateFollowUpsResponse {
  created: number;
}

export const generateFollowUps = api(
  { expose: false, method: "POST", path: "/crm/assistant/generate-followups" },
  async (): Promise<GenerateFollowUpsResponse> => {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dueAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    let created = 0;

    // For each stale active contact, create a follow-up task if the assistant
    // hasn't already created one in the last 3 days.
    const staleContacts = db.query<{
      id: number;
      owner_id: string;
      full_name: string;
    }>`
      SELECT id, owner_id, full_name FROM contacts
      WHERE status IN ('lead', 'qualified', 'customer')
        AND (last_contacted_at IS NULL OR last_contacted_at < ${staleCutoff})
    `;
    const recentCutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    for await (const c of staleContacts) {
      const existing = await db.queryRow<{ count: string }>`
        SELECT COUNT(*)::text AS count FROM activities
        WHERE owner_id = ${c.owner_id}
          AND contact_id = ${c.id}
          AND generated_by_assistant = true
          AND completed = false
          AND created_at > ${recentCutoff}
      `;
      if (Number(existing?.count ?? 0) > 0) continue;

      await db.exec`
        INSERT INTO activities (owner_id, contact_id, type, title, description,
                                due_at, priority, generated_by_assistant)
        VALUES (
          ${c.owner_id}, ${c.id}, 'follow_up',
          ${`Follow-up cu ${c.full_name}`},
          ${"Asistentul a observat că nu ai mai vorbit cu acest contact de o săptămână."},
          ${dueAt}, 2, true
        )
      `;
      created++;
    }

    // For stalled active deals, create a nudge task
    const stalledDeals = db.query<{
      id: number;
      owner_id: string;
      title: string;
      contact_id: number | null;
    }>`
      SELECT id, owner_id, title, contact_id FROM deals
      WHERE stage IN ('qualified', 'meeting', 'proposal', 'negotiation')
        AND updated_at < ${new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)}
    `;
    const stalledRecentCutoff = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    for await (const d of stalledDeals) {
      const existing = await db.queryRow<{ count: string }>`
        SELECT COUNT(*)::text AS count FROM activities
        WHERE owner_id = ${d.owner_id}
          AND deal_id = ${d.id}
          AND generated_by_assistant = true
          AND completed = false
          AND created_at > ${stalledRecentCutoff}
      `;
      if (Number(existing?.count ?? 0) > 0) continue;
      await db.exec`
        INSERT INTO activities (owner_id, contact_id, deal_id, type, title, description,
                                due_at, priority, generated_by_assistant)
        VALUES (
          ${d.owner_id}, ${d.contact_id}, ${d.id}, 'follow_up',
          ${`Deblochează deal-ul "${d.title}"`},
          ${"Asistentul a observat că nu s-a întâmplat nimic aici de 10+ zile. E timpul să miști lucrurile."},
          ${dueAt}, 1, true
        )
      `;
      created++;
    }

    return { created };
  }
);

// Daily cron: generate the to-do list for the salesperson
new CronJob("daily-assistant-followups", {
  title: "Daily sales assistant follow-up generation",
  every: "24h",
  endpoint: generateFollowUps,
});

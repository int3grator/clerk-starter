# SalesDesk — Asistentul tău de vânzări

CRM-ul care face munca de fundal ca tu să te duci doar la întâlniri cu clienții.

Construit pe [Encore.ts](https://encore.dev) + [Clerk](https://clerk.com) + PostgreSQL.

## Ce face

- **Briefing zilnic** — asistentul îți spune ce contează azi: întâlnirile de azi, task-urile întârziate, deal-urile fierbinți, contactele pe care le-ai uitat.
- **Pipeline Kanban** — 5 etape (New → Qualified → Meeting → Proposal → Negotiation) plus Won/Lost. Muți deal-uri cu un click.
- **Contacte & Lead-uri** — toate persoanele pe care le cultivi, cu status și ultima atingere.
- **Întâlniri** — programezi, marchezi ca avută, iar asistentul îți generează automat draft-ul follow-up-ului.
- **Task-uri** — manual sau auto-create de asistent. Task-urile generate automat sunt marcate cu un badge `auto`.
- **Sugestii per contact** — pentru fiecare contact, asistentul îți dă 2–3 acțiuni concrete potrivite cu stadiul deal-ului.
- **Worker nocturn** — un cron rulează zilnic și creează follow-up-uri pentru contacte stagnante și deal-uri blocate.

## Structura proiectului

```
auth/        # Clerk auth handler + webhook-uri
user/        # Profil utilizator (din starter)
crm/         # Serviciul CRM
  contacts.ts     # CRUD contacte
  deals.ts        # Pipeline + deal stage transitions
  activities.ts   # Task-uri / acțiuni
  meetings.ts     # Întâlniri
  assistant.ts    # Briefing zilnic, sugestii, draft follow-up, cron
  migrations/     # Schema Postgres
frontend/    # SPA (HTML + CSS + JS vanilla, fără build step)
```

## Endpoint-uri importante

Toate endpoint-urile `/crm/*` sunt protejate cu Clerk.

| Metodă | Cale | Descriere |
|---|---|---|
| GET | `/crm/assistant/briefing` | Briefing-ul zilnic complet |
| GET | `/crm/assistant/contact/:id/suggest` | Sugestii next-action pentru un contact |
| GET | `/crm/assistant/meeting/:id/followup` | Draft email follow-up după o întâlnire |
| GET/POST/DELETE | `/crm/contacts` | CRUD contacte |
| GET/POST/DELETE | `/crm/deals` | CRUD deal-uri |
| POST | `/crm/deals/:id/stage` | Mută deal-ul în altă etapă |
| GET/POST/DELETE | `/crm/activities` | CRUD task-uri |
| POST | `/crm/activities/:id/complete` | Marchează task ca făcut |
| GET/POST/DELETE | `/crm/meetings` | CRUD întâlniri |
| POST | `/crm/meetings/:id/complete` | Marchează întâlnire ca avută |

## Rulare locală

Prerequisite: [Encore CLI](https://encore.dev/docs/install), Docker (pentru Postgres local), cont Clerk.

```bash
npm install
encore secret set --dev ClerkSecretKey   # copiat din dashboard.clerk.com
encore run
```

Apoi deschide `http://localhost:4000`.

Dashboard-ul local de dezvoltare (tracing, DB, catalog): `http://localhost:9400`.

> **Notă:** în `frontend/assets/index.html` și `app.js` există un Clerk publishable key de test — înlocuiește-l cu al tău din dashboard-ul Clerk.

## Deploy

Deploy cu un singur push la Encore Cloud:

```bash
git push encore
encore secret set --prod ClerkSecretKey
```

În dashboard-ul Clerk, setează webhook-ul la `https://<app>.encr.app/webhooks/clerk`.

Pentru deploy în cloud-ul propriu (AWS/GCP), vezi [Encore infra docs](https://encore.dev/docs/platform/infrastructure/infra).

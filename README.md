# Local Organization Designer

A self-contained local application built with Encore.ts and PostgreSQL.

## Prerequisites

- Encore
- Docker, for local PostgreSQL

## Run locally

```bash
npm install
encore secret set --dev BootstrapOrganizationName
encore secret set --dev BootstrapOwnerUsername
encore secret set --dev BootstrapOwnerPassword
encore run
```

Open the application at `http://localhost:4000`.

The first request to `POST /auth/sign-in` creates the configured organization and Owner account only when no local users exist. The password is persisted only as a secure hash. Keep the returned session token private and send it as `Authorization: Bearer <token>` to protected endpoints.

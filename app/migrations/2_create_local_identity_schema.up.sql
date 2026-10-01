CREATE TABLE organization (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE access_role AS ENUM ('owner', 'editor', 'approver', 'viewer');

CREATE TABLE user_account (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organization(id),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  access_role access_role NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id UUID,
  UNIQUE (organization_id, username),
  FOREIGN KEY (created_by_user_id) REFERENCES user_account(id),
  FOREIGN KEY (updated_by_user_id) REFERENCES user_account(id)
);

CREATE TABLE local_session (
  id UUID PRIMARY KEY,
  user_account_id UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  terminated_at TIMESTAMPTZ
);

CREATE INDEX local_session_active_user_idx
  ON local_session (user_account_id, expires_at)
  WHERE terminated_at IS NULL;

CREATE TABLE audit_record (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organization(id),
  actor_user_id UUID REFERENCES user_account(id),
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_record_organization_occurred_idx
  ON audit_record (organization_id, occurred_at DESC);

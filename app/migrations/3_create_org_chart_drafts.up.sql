CREATE TABLE organization_chart (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id UUID NOT NULL REFERENCES user_account(id)
);

CREATE TABLE organization_chart_draft (
  chart_id UUID PRIMARY KEY REFERENCES organization_chart(id) ON DELETE CASCADE,
  document JSONB NOT NULL,
  revision_token UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user_id UUID NOT NULL REFERENCES user_account(id)
);
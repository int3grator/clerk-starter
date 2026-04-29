-- Contacts: prospects and clients the salesperson works with
CREATE TABLE contacts (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  company TEXT,
  job_title TEXT,
  email TEXT,
  phone TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'lead',
  notes TEXT,
  last_contacted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX contacts_owner_idx ON contacts(owner_id);
CREATE INDEX contacts_status_idx ON contacts(owner_id, status);

-- Deals: sales opportunities moving through a pipeline
CREATE TABLE deals (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  value_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  stage TEXT NOT NULL DEFAULT 'new',
  probability INT NOT NULL DEFAULT 10,
  expected_close_date DATE,
  notes TEXT,
  won_at TIMESTAMP,
  lost_at TIMESTAMP,
  lost_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX deals_owner_idx ON deals(owner_id);
CREATE INDEX deals_stage_idx ON deals(owner_id, stage);
CREATE INDEX deals_contact_idx ON deals(contact_id);

-- Activities / tasks the assistant schedules on behalf of the salesperson
CREATE TABLE activities (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id BIGINT REFERENCES deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_at TIMESTAMP,
  priority INT NOT NULL DEFAULT 2,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMP,
  generated_by_assistant BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX activities_owner_idx ON activities(owner_id);
CREATE INDEX activities_due_idx ON activities(owner_id, completed, due_at);
CREATE INDEX activities_contact_idx ON activities(contact_id);
CREATE INDEX activities_deal_idx ON activities(deal_id);

-- Meetings with clients
CREATE TABLE meetings (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id BIGINT REFERENCES deals(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  location TEXT,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP,
  agenda TEXT,
  outcome TEXT,
  summary TEXT,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX meetings_owner_idx ON meetings(owner_id);
CREATE INDEX meetings_upcoming_idx ON meetings(owner_id, completed, starts_at);
CREATE INDEX meetings_contact_idx ON meetings(contact_id);

-- Notes / interaction log
CREATE TABLE interaction_notes (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id BIGINT REFERENCES deals(id) ON DELETE CASCADE,
  meeting_id BIGINT REFERENCES meetings(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX notes_owner_idx ON interaction_notes(owner_id);
CREATE INDEX notes_contact_idx ON interaction_notes(contact_id);

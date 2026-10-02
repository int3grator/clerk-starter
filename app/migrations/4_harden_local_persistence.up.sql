ALTER TABLE user_account ALTER COLUMN access_role TYPE TEXT USING access_role::text;
ALTER TABLE user_account ADD CONSTRAINT user_account_access_role_check
  CHECK (access_role IN ('owner', 'editor', 'approver', 'viewer'));
DROP TYPE access_role;

ALTER TABLE audit_record ADD COLUMN chart_id UUID REFERENCES organization_chart(id);
ALTER TABLE audit_record ADD COLUMN outcome TEXT NOT NULL DEFAULT 'succeeded';
ALTER TABLE audit_record ADD COLUMN before_version_id UUID;
ALTER TABLE audit_record ADD COLUMN after_version_id UUID;

CREATE INDEX audit_record_chart_occurred_idx ON audit_record (chart_id, occurred_at DESC);

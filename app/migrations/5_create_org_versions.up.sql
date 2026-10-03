CREATE TABLE org_version (
  id UUID PRIMARY KEY,
  chart_id UUID NOT NULL REFERENCES organization_chart(id),
  number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('saved', 'in_review', 'approved', 'rejected', 'published', 'superseded')),
  note TEXT NOT NULL,
  author_user_id UUID NOT NULL REFERENCES user_account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  snapshot JSONB NOT NULL,
  snapshot_hash TEXT NOT NULL,
  change_count INTEGER NOT NULL,
  restored_from_version_id UUID REFERENCES org_version(id),
  submitted_by_user_id UUID REFERENCES user_account(id),
  submitted_at TIMESTAMPTZ,
  decided_by_user_id UUID REFERENCES user_account(id),
  decided_at TIMESTAMPTZ,
  decision_comment TEXT,
  published_by_user_id UUID REFERENCES user_account(id),
  published_at TIMESTAMPTZ,
  UNIQUE (chart_id, number)
);

CREATE UNIQUE INDEX org_version_one_published_idx ON org_version (chart_id) WHERE status = 'published';

-- Snapshot content stays unchanged after creation. Only lifecycle columns can change.
CREATE FUNCTION protect_org_version_snapshot() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'organization chart versions cannot be deleted';
  END IF;
  IF NEW.chart_id IS DISTINCT FROM OLD.chart_id
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
     OR NEW.change_count IS DISTINCT FROM OLD.change_count
     OR NEW.restored_from_version_id IS DISTINCT FROM OLD.restored_from_version_id THEN
    RAISE EXCEPTION 'organization chart version snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_version_snapshot_immutable
  BEFORE UPDATE OR DELETE ON org_version
  FOR EACH ROW EXECUTE FUNCTION protect_org_version_snapshot();

ALTER TABLE organization_chart_draft ADD COLUMN restored_from_version_id UUID REFERENCES org_version(id);

ALTER TABLE audit_record
  ADD CONSTRAINT audit_record_before_version_fk FOREIGN KEY (before_version_id) REFERENCES org_version(id);
ALTER TABLE audit_record
  ADD CONSTRAINT audit_record_after_version_fk FOREIGN KEY (after_version_id) REFERENCES org_version(id);

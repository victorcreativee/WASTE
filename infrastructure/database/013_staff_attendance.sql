CREATE TABLE IF NOT EXISTS staff_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  shift_name VARCHAR(80) NOT NULL DEFAULT 'Day shift',
  shift_start TIME,
  shift_end TIME,
  status VARCHAR(24) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','present','late','absent','leave')),
  checked_in_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  notes VARCHAR(500),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,user_id,work_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_org_date ON staff_attendance(organization_id,work_date DESC);

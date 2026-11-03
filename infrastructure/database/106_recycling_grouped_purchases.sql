ALTER TABLE recycling_material_lots
  ADD COLUMN IF NOT EXISTS purchase_group_reference VARCHAR(120),
  ADD COLUMN IF NOT EXISTS delivered_by_user_id UUID;

ALTER TABLE recycling_material_lots
  DROP CONSTRAINT IF EXISTS recycling_lots_delivery_staff_tenant_fkey,
  ADD CONSTRAINT recycling_lots_delivery_staff_tenant_fkey
    FOREIGN KEY (delivered_by_user_id, organization_id)
    REFERENCES users(id, organization_id);

CREATE INDEX IF NOT EXISTS idx_recycling_lots_purchase_group
  ON recycling_material_lots(organization_id, purchase_group_reference)
  WHERE purchase_group_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recycling_lots_delivered_by
  ON recycling_material_lots(organization_id, delivered_by_user_id)
  WHERE delivered_by_user_id IS NOT NULL;

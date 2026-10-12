-- Bind financial and supply audit actors to the organization that owns the
-- record. Nullable actor columns stay nullable, but a present actor must be a
-- member of the same tenant.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM organization_expenses r JOIN users u ON u.id=r.created_by WHERE r.created_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM organization_expenses r JOIN users u ON u.id=r.approved_by WHERE r.approved_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM inventory_movements r JOIN users u ON u.id=r.recorded_by WHERE r.recorded_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM purchase_requests r JOIN users u ON u.id=r.requested_by WHERE r.requested_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM purchase_requests r JOIN users u ON u.id=r.approved_by WHERE r.approved_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM purchase_orders r JOIN users u ON u.id=r.created_by WHERE r.created_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM supplier_bills r JOIN users u ON u.id=r.created_by WHERE r.created_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM supplier_payments r JOIN users u ON u.id=r.recorded_by WHERE r.recorded_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM organization_finance_settings r JOIN users u ON u.id=r.updated_by WHERE r.updated_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 OR EXISTS (SELECT 1 FROM organization_finance_setting_history r JOIN users u ON u.id=r.changed_by WHERE r.changed_by IS NOT NULL AND u.organization_id IS DISTINCT FROM r.organization_id)
 THEN
  RAISE EXCEPTION 'Cross-tenant finance or supply actor references exist. Correct them before applying migration 076.';
 END IF;
END $$;

ALTER TABLE organization_expenses
 DROP CONSTRAINT IF EXISTS organization_expenses_created_by_fkey,
 DROP CONSTRAINT IF EXISTS organization_expenses_approved_by_fkey,
 DROP CONSTRAINT IF EXISTS expense_creator_tenant_fkey,
 DROP CONSTRAINT IF EXISTS expense_approver_tenant_fkey,
 ADD CONSTRAINT expense_creator_tenant_fkey FOREIGN KEY(created_by,organization_id) REFERENCES users(id,organization_id) ON DELETE SET NULL (created_by),
 ADD CONSTRAINT expense_approver_tenant_fkey FOREIGN KEY(approved_by,organization_id) REFERENCES users(id,organization_id) ON DELETE SET NULL (approved_by);

ALTER TABLE inventory_movements
 DROP CONSTRAINT IF EXISTS inventory_movements_recorded_by_fkey,
 DROP CONSTRAINT IF EXISTS inventory_movement_recorder_tenant_fkey,
 ADD CONSTRAINT inventory_movement_recorder_tenant_fkey FOREIGN KEY(recorded_by,organization_id) REFERENCES users(id,organization_id) ON DELETE SET NULL (recorded_by);

ALTER TABLE purchase_requests
 DROP CONSTRAINT IF EXISTS purchase_requests_requested_by_fkey,
 DROP CONSTRAINT IF EXISTS purchase_requests_approved_by_fkey,
 DROP CONSTRAINT IF EXISTS purchase_request_requester_tenant_fkey,
 DROP CONSTRAINT IF EXISTS purchase_request_approver_tenant_fkey,
 ADD CONSTRAINT purchase_request_requester_tenant_fkey FOREIGN KEY(requested_by,organization_id) REFERENCES users(id,organization_id) ON DELETE SET NULL (requested_by),
 ADD CONSTRAINT purchase_request_approver_tenant_fkey FOREIGN KEY(approved_by,organization_id) REFERENCES users(id,organization_id) ON DELETE SET NULL (approved_by);

ALTER TABLE purchase_orders
 DROP CONSTRAINT IF EXISTS purchase_orders_created_by_fkey,
 DROP CONSTRAINT IF EXISTS purchase_order_creator_tenant_fkey,
 ADD CONSTRAINT purchase_order_creator_tenant_fkey FOREIGN KEY(created_by,organization_id) REFERENCES users(id,organization_id) ON DELETE SET NULL (created_by);

ALTER TABLE supplier_bills
 DROP CONSTRAINT IF EXISTS supplier_bills_created_by_fkey,
 DROP CONSTRAINT IF EXISTS supplier_bill_creator_tenant_fkey,
 ADD CONSTRAINT supplier_bill_creator_tenant_fkey FOREIGN KEY(created_by,organization_id) REFERENCES users(id,organization_id) ON DELETE SET NULL (created_by);

ALTER TABLE supplier_payments
 DROP CONSTRAINT IF EXISTS supplier_payments_recorded_by_fkey,
 DROP CONSTRAINT IF EXISTS supplier_payment_recorder_tenant_fkey,
 ADD CONSTRAINT supplier_payment_recorder_tenant_fkey FOREIGN KEY(recorded_by,organization_id) REFERENCES users(id,organization_id) ON DELETE SET NULL (recorded_by);

ALTER TABLE organization_finance_settings
 DROP CONSTRAINT IF EXISTS organization_finance_settings_updated_by_fkey,
 DROP CONSTRAINT IF EXISTS finance_settings_updater_tenant_fkey,
 ADD CONSTRAINT finance_settings_updater_tenant_fkey FOREIGN KEY(updated_by,organization_id) REFERENCES users(id,organization_id) ON DELETE SET NULL (updated_by);

ALTER TABLE organization_finance_setting_history
 DROP CONSTRAINT IF EXISTS organization_finance_setting_history_changed_by_fkey,
 DROP CONSTRAINT IF EXISTS finance_history_actor_tenant_fkey,
 ADD CONSTRAINT finance_history_actor_tenant_fkey FOREIGN KEY(changed_by,organization_id) REFERENCES users(id,organization_id) ON DELETE SET NULL (changed_by);

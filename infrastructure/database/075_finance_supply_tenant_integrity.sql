-- Protect billing, inventory, procurement and payables relationships with the
-- organization ID at the database boundary. Fail before changing constraints
-- if any legacy record already points into another organization.
DO $$
BEGIN
 IF EXISTS (
   SELECT 1 FROM inventory_movements child JOIN inventory_items parent ON parent.id=child.item_id
   WHERE child.organization_id<>parent.organization_id
 ) OR EXISTS (
   SELECT 1 FROM purchase_orders child JOIN purchase_requests parent ON parent.id=child.purchase_request_id
   WHERE child.purchase_request_id IS NOT NULL AND child.organization_id<>parent.organization_id
 ) OR EXISTS (
   SELECT 1 FROM purchase_orders child JOIN suppliers parent ON parent.id=child.supplier_id
   WHERE child.organization_id<>parent.organization_id
 ) OR EXISTS (
   SELECT 1 FROM supplier_bills child JOIN suppliers parent ON parent.id=child.supplier_id
   WHERE child.organization_id<>parent.organization_id
 ) OR EXISTS (
   SELECT 1 FROM supplier_bills child JOIN purchase_orders parent ON parent.id=child.purchase_order_id
   WHERE child.purchase_order_id IS NOT NULL
     AND (child.organization_id<>parent.organization_id OR child.supplier_id<>parent.supplier_id)
 ) OR EXISTS (
   SELECT 1 FROM supplier_payments child JOIN supplier_bills parent ON parent.id=child.bill_id
   WHERE child.organization_id<>parent.organization_id
 ) OR EXISTS (
   SELECT 1 FROM customer_subscriptions child JOIN service_plans parent ON parent.id=child.plan_id
   WHERE child.organization_id<>parent.organization_id
 ) OR EXISTS (
   SELECT 1 FROM customer_subscriptions child JOIN customer_service_locations parent ON parent.id=child.service_location_id
   WHERE parent.organization_id IS DISTINCT FROM child.organization_id
 ) OR EXISTS (
   SELECT 1 FROM customer_invoices child JOIN customer_subscriptions parent ON parent.id=child.subscription_id
   WHERE child.organization_id<>parent.organization_id OR child.customer_id<>parent.customer_id
 ) OR EXISTS (
   SELECT 1 FROM customer_payments child JOIN customer_invoices parent ON parent.id=child.invoice_id
   WHERE child.organization_id<>parent.organization_id OR child.customer_id<>parent.customer_id
 ) THEN
   RAISE EXCEPTION 'Cross-tenant finance or supply relationships exist. Correct them before applying migration 074.';
 END IF;
END $$;

ALTER TABLE inventory_items
 DROP CONSTRAINT IF EXISTS inventory_items_id_org_unique,
 ADD CONSTRAINT inventory_items_id_org_unique UNIQUE(id,organization_id);
ALTER TABLE purchase_requests
 DROP CONSTRAINT IF EXISTS purchase_requests_id_org_unique,
 ADD CONSTRAINT purchase_requests_id_org_unique UNIQUE(id,organization_id);
ALTER TABLE suppliers
 DROP CONSTRAINT IF EXISTS suppliers_id_org_unique,
 ADD CONSTRAINT suppliers_id_org_unique UNIQUE(id,organization_id);
ALTER TABLE purchase_orders
 DROP CONSTRAINT IF EXISTS purchase_orders_id_supplier_org_unique,
 ADD CONSTRAINT purchase_orders_id_supplier_org_unique UNIQUE(id,supplier_id,organization_id);
ALTER TABLE supplier_bills
 DROP CONSTRAINT IF EXISTS supplier_bills_id_org_unique,
 ADD CONSTRAINT supplier_bills_id_org_unique UNIQUE(id,organization_id);
ALTER TABLE service_plans
 DROP CONSTRAINT IF EXISTS service_plans_id_org_unique,
 ADD CONSTRAINT service_plans_id_org_unique UNIQUE(id,organization_id);
ALTER TABLE customer_service_locations
 DROP CONSTRAINT IF EXISTS customer_service_locations_id_org_unique,
 ADD CONSTRAINT customer_service_locations_id_org_unique UNIQUE(id,organization_id);
ALTER TABLE customer_subscriptions
 DROP CONSTRAINT IF EXISTS customer_subscriptions_id_customer_org_unique,
 ADD CONSTRAINT customer_subscriptions_id_customer_org_unique UNIQUE(id,customer_id,organization_id);
ALTER TABLE customer_invoices
 DROP CONSTRAINT IF EXISTS customer_invoices_id_customer_org_unique,
 ADD CONSTRAINT customer_invoices_id_customer_org_unique UNIQUE(id,customer_id,organization_id);

ALTER TABLE inventory_movements
 DROP CONSTRAINT IF EXISTS inventory_movements_item_id_fkey,
 DROP CONSTRAINT IF EXISTS inventory_movement_item_tenant_fkey,
 ADD CONSTRAINT inventory_movement_item_tenant_fkey
  FOREIGN KEY(item_id,organization_id) REFERENCES inventory_items(id,organization_id) ON DELETE CASCADE;

ALTER TABLE purchase_orders
 DROP CONSTRAINT IF EXISTS purchase_orders_purchase_request_id_fkey,
 DROP CONSTRAINT IF EXISTS purchase_orders_supplier_id_fkey,
 DROP CONSTRAINT IF EXISTS purchase_order_request_tenant_fkey,
 DROP CONSTRAINT IF EXISTS purchase_order_supplier_tenant_fkey,
 ADD CONSTRAINT purchase_order_request_tenant_fkey
  FOREIGN KEY(purchase_request_id,organization_id) REFERENCES purchase_requests(id,organization_id) ON DELETE SET NULL (purchase_request_id),
 ADD CONSTRAINT purchase_order_supplier_tenant_fkey
  FOREIGN KEY(supplier_id,organization_id) REFERENCES suppliers(id,organization_id);

ALTER TABLE supplier_bills
 DROP CONSTRAINT IF EXISTS supplier_bills_supplier_id_fkey,
 DROP CONSTRAINT IF EXISTS supplier_bills_purchase_order_id_fkey,
 DROP CONSTRAINT IF EXISTS supplier_bill_supplier_tenant_fkey,
 DROP CONSTRAINT IF EXISTS supplier_bill_order_tenant_fkey,
 ADD CONSTRAINT supplier_bill_supplier_tenant_fkey
  FOREIGN KEY(supplier_id,organization_id) REFERENCES suppliers(id,organization_id),
 ADD CONSTRAINT supplier_bill_order_tenant_fkey
  FOREIGN KEY(purchase_order_id,supplier_id,organization_id)
  REFERENCES purchase_orders(id,supplier_id,organization_id) ON DELETE SET NULL (purchase_order_id);

ALTER TABLE supplier_payments
 DROP CONSTRAINT IF EXISTS supplier_payments_bill_id_fkey,
 DROP CONSTRAINT IF EXISTS supplier_payment_bill_tenant_fkey,
 ADD CONSTRAINT supplier_payment_bill_tenant_fkey
  FOREIGN KEY(bill_id,organization_id) REFERENCES supplier_bills(id,organization_id) ON DELETE CASCADE;

ALTER TABLE customer_subscriptions
 DROP CONSTRAINT IF EXISTS customer_subscriptions_plan_id_fkey,
 DROP CONSTRAINT IF EXISTS customer_subscriptions_service_location_id_fkey,
 DROP CONSTRAINT IF EXISTS subscription_plan_tenant_fkey,
 DROP CONSTRAINT IF EXISTS subscription_location_tenant_fkey,
 ADD CONSTRAINT subscription_plan_tenant_fkey
  FOREIGN KEY(plan_id,organization_id) REFERENCES service_plans(id,organization_id),
 ADD CONSTRAINT subscription_location_tenant_fkey
  FOREIGN KEY(service_location_id,organization_id) REFERENCES customer_service_locations(id,organization_id) ON DELETE CASCADE;

ALTER TABLE customer_invoices
 DROP CONSTRAINT IF EXISTS customer_invoices_subscription_id_fkey,
 DROP CONSTRAINT IF EXISTS invoice_subscription_tenant_fkey,
 ADD CONSTRAINT invoice_subscription_tenant_fkey
  FOREIGN KEY(subscription_id,customer_id,organization_id)
  REFERENCES customer_subscriptions(id,customer_id,organization_id) ON DELETE CASCADE;

ALTER TABLE customer_payments
 DROP CONSTRAINT IF EXISTS customer_payments_invoice_id_fkey,
 DROP CONSTRAINT IF EXISTS payment_invoice_tenant_fkey,
 ADD CONSTRAINT payment_invoice_tenant_fkey
  FOREIGN KEY(invoice_id,customer_id,organization_id)
  REFERENCES customer_invoices(id,customer_id,organization_id) ON DELETE CASCADE;

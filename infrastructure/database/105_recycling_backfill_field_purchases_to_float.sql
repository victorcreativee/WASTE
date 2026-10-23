-- Paid purchases that field staff recorded before purchases were drawn from the manager float (104) were charged
-- to office cash. Move each one onto the float: the lot records the float-funded share and a linked 'spent' float
-- movement is added on the payment date. Company cash is unchanged (the purchase payment term shrinks by exactly
-- what the float movement adds); only the split between office cash and float changes.
-- A purchase is moved only while the company's float can cover it, so the float never goes negative; anything left
-- over stays on office cash for a manager to review. Re-running finds nothing left to move.
DO $$
DECLARE
  purchase RECORD;
  balance BIGINT;
BEGIN
  FOR purchase IN
    SELECT l.id, l.organization_id, l.material_type, l.source_name, l.created_by,
           p.paid - l.manager_float_used_ugx AS gap, p.first_paid
    FROM recycling_material_lots l
    JOIN (SELECT lot_id, SUM(amount_ugx) AS paid, MIN(paid_on) AS first_paid
          FROM recycling_purchase_payments GROUP BY lot_id) p ON p.lot_id = l.id
    JOIN organizations o ON o.id = l.organization_id AND o.type = 'recycling_company'
    WHERE l.origin = 'purchase'
      AND p.paid > l.manager_float_used_ugx
      AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = l.created_by
                    AND r.name IN ('recycling_field_manager', 'recycling_collector', 'recycling_sales'))
    ORDER BY l.organization_id, p.first_paid, l.created_at
  LOOP
    SELECT COALESCE(SUM(CASE WHEN transaction_type = 'given' THEN amount_ugx ELSE -amount_ugx END), 0)
      INTO balance FROM recycling_manager_float_transactions WHERE organization_id = purchase.organization_id;
    CONTINUE WHEN balance < purchase.gap;
    UPDATE recycling_material_lots
       SET manager_float_used_ugx = manager_float_used_ugx + purchase.gap
     WHERE id = purchase.id;
    INSERT INTO recycling_manager_float_transactions
      (organization_id, transaction_date, transaction_type, amount_ugx, reference, notes, purchase_lot_id, recorded_by)
    VALUES (purchase.organization_id, purchase.first_paid, 'spent', purchase.gap, 'FLOAT-MOVE-' || purchase.id,
            'Purchase: ' || purchase.material_type || ' from ' || purchase.source_name || ' (moved to manager float)',
            purchase.id, purchase.created_by);
  END LOOP;
END $$;

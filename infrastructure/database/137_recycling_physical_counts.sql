-- Physical inventory counts are administrator-approved corrections. The detailed before/after
-- snapshot lives in recycling_transaction_edits so one approval remains one auditable event.
-- The list keeps every type earlier migrations allowed (settings_change and material_rename from 134).
ALTER TABLE recycling_transaction_edits DROP CONSTRAINT IF EXISTS recycling_transaction_edits_transaction_type_check;
ALTER TABLE recycling_transaction_edits ADD CONSTRAINT recycling_transaction_edits_transaction_type_check
  CHECK (transaction_type IN ('purchase', 'sale', 'sorting_reversal', 'material_transfer', 'material_transfer_reversal', 'physical_stock_count', 'cash_correction', 'entry_cancelled', 'settings_change', 'material_rename'));



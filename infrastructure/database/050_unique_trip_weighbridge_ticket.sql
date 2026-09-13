CREATE UNIQUE INDEX IF NOT EXISTS one_active_weighbridge_ticket_per_trip
ON weighbridge_transactions(trip_id)
WHERE trip_id IS NOT NULL AND status <> 'voided';

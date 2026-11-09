-- Phase 4H: late and stuck trip alerts. Trip problems are their own notification category ("operations"), so a
-- supervisor can choose how they hear about them without changing permit or billing notices.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
  CHECK(category IN('permit','renewal','returns','compliance','custody','disposal','dumping','penalties','billing','system','household','operations'));
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check
  CHECK(category IN('permit','renewal','returns','compliance','custody','disposal','dumping','penalties','billing','system','operations'));

-- The alert queries look up a trip's open work through its jobs; these keep them cheap on a busy day.
CREATE INDEX IF NOT EXISTS idx_collection_routes_open ON collection_routes(organization_id,status) WHERE status IN('planned','dispatched','in_progress');
CREATE INDEX IF NOT EXISTS idx_route_jobs_route ON collection_route_jobs(route_id);
CREATE INDEX IF NOT EXISTS idx_driver_job_problems_open ON driver_job_problems(job_id) WHERE status<>'resolved';

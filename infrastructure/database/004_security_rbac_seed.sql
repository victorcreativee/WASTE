-- Idempotent repair for the established KCCA demo administrator.
-- This does not create users or alter passwords.
WITH kcca AS (
    SELECT id
    FROM organizations
    WHERE type = 'kcca'
    ORDER BY created_at ASC
    LIMIT 1
)
UPDATE users
SET organization_id = kcca.id,
    updated_at = CURRENT_TIMESTAMP
FROM kcca
WHERE LOWER(users.email) = 'admin@kcca.gov.ug'
  AND users.organization_id IS NULL;

INSERT INTO user_roles (user_id, role_id)
SELECT users.id, roles.id
FROM users
CROSS JOIN roles
WHERE LOWER(users.email) = 'admin@kcca.gov.ug'
  AND roles.name = 'kcca_admin'
ON CONFLICT DO NOTHING;

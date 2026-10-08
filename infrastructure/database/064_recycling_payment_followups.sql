CREATE TABLE IF NOT EXISTS recycling_payment_followups (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 sale_id UUID NOT NULL REFERENCES recycling_material_sales(id) ON DELETE CASCADE,
 contact_method VARCHAR(20) NOT NULL CHECK(contact_method IN('phone','email','visit','message')),
 outcome VARCHAR(30) NOT NULL CHECK(outcome IN('contacted','promise_to_pay','no_response','disputed','escalated')),
 note TEXT NOT NULL CHECK(char_length(trim(note)) BETWEEN 3 AND 1000),
 next_follow_up_on DATE,
 recorded_by UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS recycling_payment_followups_sale_idx
 ON recycling_payment_followups(organization_id,sale_id,created_at DESC);
CREATE INDEX IF NOT EXISTS recycling_payment_followups_next_idx
 ON recycling_payment_followups(organization_id,next_follow_up_on)
 WHERE next_follow_up_on IS NOT NULL;

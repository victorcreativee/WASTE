-- Plan prices set by the business (replacing the placeholders from 103), and Enterprise for large collection companies.
-- Yearly prices are ten times the monthly price (two months free). Limits are unchanged. Companies on complimentary
-- access are never billed; a paying company's new price applies from its next invoice.
UPDATE platform_packages p SET monthly_fee_ugx = v.monthly, annual_fee_ugx = v.monthly * 10
FROM (VALUES
  ('collector_standard', 350000),
  ('collector_professional', 500000),
  ('recycling_starter', 100000),
  ('recycling_standard', 250000),
  ('recycling_professional', 500000)
) AS v(code, monthly)
WHERE p.code = v.code;

-- Enterprise is the custom collector package: the modules, price and onboarding are agreed with each company, starting
-- from UGX 1,000,000 a month. It is now offered publicly; its feature set stays per company (feature overrides).
UPDATE platform_packages SET
  name = 'Enterprise',
  description = 'For large collection companies: every module, unlimited vehicles and staff, with the package, price and onboarding agreed with you.',
  monthly_fee_ugx = 1000000, annual_fee_ugx = 10000000, max_vehicles = NULL, max_users = NULL,
  is_public = true, is_active = true
WHERE code = 'collector_custom';

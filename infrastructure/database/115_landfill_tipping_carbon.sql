-- KWMS Module 5: landfill and tipping. Waste composition recorded on weighbridge loads, a load certificate issued for every
-- completed ticket (public check by code), versioned methane factors published by KCCA, and a monthly carbon baseline
-- (tonnes landfilled and diverted by stream, methane potential) for KCCA, NEMA and carbon verifiers.
-- Reads recycling purchases for diversion; changes nothing in the recycling tables. Additive and idempotent. Requires 099, 113.

-- 1. Waste streams ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waste_streams(
 code TEXT PRIMARY KEY CHECK(code ~ '^[a-z_]{2,30}$'),
 name TEXT NOT NULL,
 sort_order INT NOT NULL DEFAULT 0
);
INSERT INTO waste_streams(code,name,sort_order) VALUES
 ('food_organic','Food and organic',1),('garden','Garden and yard',2),('paper','Paper and cardboard',3),
 ('wood','Wood',4),('textiles','Textiles',5),('nappies','Nappies and sanitary',6),('plastics','Plastics',7),
 ('glass','Glass',8),('metal','Metal',9),('inert','Soil, ash and rubble',10),('hazardous','Hazardous',11),('other','Other',12)
ON CONFLICT(code) DO NOTHING;

-- 2. Methane factors, published by KCCA as numbered versions that cannot be edited ----------------------
-- Methane potential of one wet tonne = DOC x DOCf x MCF x F x 16/12 x (1 - OX), in tonnes of CH4; x GWP for CO2e.
CREATE TABLE IF NOT EXISTS carbon_factor_sets(
 version INT PRIMARY KEY CHECK(version>0),
 methodology TEXT NOT NULL CHECK(length(methodology) BETWEEN 5 AND 2000),
 docf NUMERIC(4,3) NOT NULL CHECK(docf>0 AND docf<=1),
 mcf NUMERIC(4,3) NOT NULL CHECK(mcf>0 AND mcf<=1),
 methane_fraction NUMERIC(4,3) NOT NULL CHECK(methane_fraction>0 AND methane_fraction<=1),
 oxidation NUMERIC(4,3) NOT NULL CHECK(oxidation>=0 AND oxidation<1),
 gwp_ch4 NUMERIC(6,2) NOT NULL CHECK(gwp_ch4>0),
 change_summary TEXT,
 published_by UUID REFERENCES users(id),
 published_by_name TEXT,
 published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Per version: the degradable organic carbon of each stream, and the composition assumed for loads nobody sorted.
CREATE TABLE IF NOT EXISTS carbon_factor_streams(
 version INT NOT NULL REFERENCES carbon_factor_sets(version),
 stream_code TEXT NOT NULL REFERENCES waste_streams(code),
 doc NUMERIC(4,3) NOT NULL CHECK(doc>=0 AND doc<=1),
 default_share_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(default_share_pct>=0 AND default_share_pct<=100),
 PRIMARY KEY(version,stream_code)
);

CREATE OR REPLACE FUNCTION carbon_factors_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published methane factors cannot be changed; publish a new version' USING ERRCODE='KW409'; END $$;
DROP TRIGGER IF EXISTS trg_carbon_factor_sets_immutable ON carbon_factor_sets;
CREATE TRIGGER trg_carbon_factor_sets_immutable BEFORE UPDATE OR DELETE ON carbon_factor_sets FOR EACH ROW EXECUTE FUNCTION carbon_factors_immutable();
DROP TRIGGER IF EXISTS trg_carbon_factor_streams_immutable ON carbon_factor_streams;
CREATE TRIGGER trg_carbon_factor_streams_immutable BEFORE UPDATE OR DELETE ON carbon_factor_streams FOR EACH ROW EXECUTE FUNCTION carbon_factors_immutable();

-- Version 1: IPCC 2006 Guidelines Vol. 5 ch. 2-3 defaults (DOC wet weight, DOCf 0.5, F 0.5, OX 0), MCF 0.8 for an
-- unmanaged deep site, GWP 28 (IPCC AR5). The default composition is a planning estimate until KCCA has a
-- characterisation study.
INSERT INTO carbon_factor_sets(version,methodology,docf,mcf,methane_fraction,oxidation,gwp_ch4,change_summary,published_by_name)
VALUES(1,'IPCC 2006 Guidelines for National Greenhouse Gas Inventories, Vol. 5 (Waste), default factors; methane generation potential of waste placed (mass balance, no time decay); GWP100 from IPCC AR5.',
 0.5,0.8,0.5,0,28,'First version: IPCC defaults and a planning-estimate composition for Kampala','KWMS default')
ON CONFLICT(version) DO NOTHING;
INSERT INTO carbon_factor_streams(version,stream_code,doc,default_share_pct) VALUES
 (1,'food_organic',0.15,68),(1,'garden',0.20,7),(1,'paper',0.40,6),(1,'wood',0.43,1),(1,'textiles',0.24,2),
 (1,'nappies',0.24,2),(1,'plastics',0,9),(1,'glass',0,1),(1,'metal',0,1),(1,'inert',0,2),(1,'hazardous',0,0),(1,'other',0,1)
ON CONFLICT DO NOTHING;

-- 3. Composition of a load, recorded at the weighbridge ------------------------------------------------
-- Shares are kept as {stream_code: percent}, so the audit log shows a whole composition before and after a change.
CREATE TABLE IF NOT EXISTS load_compositions(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 ticket_id UUID NOT NULL UNIQUE REFERENCES weighbridge_transactions(id) ON DELETE CASCADE,
 organization_id UUID NOT NULL REFERENCES organizations(id),
 method TEXT NOT NULL CHECK(method IN('visual_estimate','sample_sort')),
 shares JSONB NOT NULL CHECK(jsonb_typeof(shares)='object'),
 sample_kg NUMERIC(10,2) CHECK(sample_kg IS NULL OR sample_kg>0),
 notes TEXT CHECK(notes IS NULL OR length(notes)<=500),
 recorded_by UUID REFERENCES users(id),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(method<>'sample_sort' OR sample_kg IS NOT NULL)
);

-- Shares name known streams, are positive, and add up to 100; the ticket must be completed.
CREATE OR REPLACE FUNCTION check_load_composition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE total NUMERIC; unknown TEXT;
BEGIN
  SELECT w.organization_id INTO NEW.organization_id FROM weighbridge_transactions w WHERE w.id=NEW.ticket_id AND w.status='completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Composition can only be recorded on a completed ticket' USING ERRCODE='KW400'; END IF;
  SELECT min(key) INTO unknown FROM jsonb_each(NEW.shares) WHERE key NOT IN(SELECT code FROM waste_streams);
  IF unknown IS NOT NULL THEN RAISE EXCEPTION 'Unknown waste stream: %',unknown USING ERRCODE='KW400'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(NEW.shares) WHERE jsonb_typeof(value)<>'number' OR value::text::numeric<=0) THEN
    RAISE EXCEPTION 'Each share must be a number above 0' USING ERRCODE='KW400'; END IF;
  SELECT sum(value::text::numeric) INTO total FROM jsonb_each(NEW.shares);
  IF total IS NULL OR abs(total-100)>0.05 THEN RAISE EXCEPTION 'The shares must add up to 100%% (now %)',round(coalesce(total,0),2) USING ERRCODE='KW400'; END IF;
  NEW.recorded_at:=CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_check_load_composition ON load_compositions;
CREATE TRIGGER trg_check_load_composition BEFORE INSERT OR UPDATE ON load_compositions FOR EACH ROW EXECUTE FUNCTION check_load_composition();

-- 4. Load certificates ------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS load_certificate_seq;
CREATE TABLE IF NOT EXISTS load_certificates(
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 certificate_number TEXT NOT NULL UNIQUE,
 verification_code TEXT NOT NULL UNIQUE,
 ticket_id UUID NOT NULL UNIQUE REFERENCES weighbridge_transactions(id),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 ticket_number TEXT NOT NULL,
 facility_code TEXT NOT NULL,
 facility_name TEXT NOT NULL,
 facility_kind TEXT NOT NULL,
 registration TEXT NOT NULL,
 operation_date DATE NOT NULL,
 gross_kg NUMERIC(12,2) NOT NULL,
 tare_kg NUMERIC(12,2) NOT NULL,
 net_kg NUMERIC(12,2) NOT NULL,
 issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 record_hash TEXT NOT NULL,
 revoked_at TIMESTAMPTZ,
 revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_load_certificates_org_date ON load_certificates(organization_id,operation_date DESC);

-- The fingerprint of what a certificate states; the public check recomputes it to show the record is unchanged.
CREATE OR REPLACE FUNCTION load_certificate_hash(c load_certificates) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',c.certificate_number,c.verification_code,c.ticket_id,c.organization_id,c.ticket_number,
    c.facility_code,c.registration,c.operation_date,c.gross_kg::text,c.tare_kg::text,c.net_kg::text,
    to_char(c.issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),'UTF8')),'hex')
$$;

-- Issues the certificate for a completed ticket, once. Runs as the owner: the app cannot write certificates.
CREATE OR REPLACE FUNCTION issue_load_certificate_for(w weighbridge_transactions) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c load_certificates;
BEGIN
  IF w.status<>'completed' OR w.net_kg IS NULL OR w.tare_kg IS NULL OR EXISTS(SELECT 1 FROM load_certificates WHERE ticket_id=w.id) THEN RETURN; END IF;
  c.id:=uuid_generate_v4();
  c.certificate_number:='LC-'||to_char(w.operation_date,'YYYY')||'-'||lpad(nextval('load_certificate_seq')::text,6,'0');
  c.verification_code:=new_permit_verification_code();
  c.ticket_id:=w.id; c.organization_id:=w.organization_id; c.ticket_number:=w.ticket_number;
  c.facility_code:=w.facility_code; c.registration:=w.registration; c.operation_date:=w.operation_date;
  c.gross_kg:=w.gross_kg; c.tare_kg:=w.tare_kg; c.net_kg:=w.net_kg;
  c.issued_at:=date_trunc('milliseconds',clock_timestamp());
  SELECT name,kind INTO c.facility_name,c.facility_kind FROM disposal_facilities WHERE code=w.facility_code;
  c.facility_name:=coalesce(c.facility_name,w.facility); c.facility_kind:=coalesce(c.facility_kind,'landfill');
  c.record_hash:=load_certificate_hash(c);
  INSERT INTO load_certificates SELECT c.*;
END $$;

-- A completed ticket gets its certificate; a voided ticket revokes it.
CREATE OR REPLACE FUNCTION issue_load_certificate() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='voided' THEN
    UPDATE load_certificates SET revoked_at=CURRENT_TIMESTAMP,revoked_reason=coalesce(NEW.void_reason,'Ticket voided')
    WHERE ticket_id=NEW.id AND revoked_at IS NULL;
  ELSE
    PERFORM issue_load_certificate_for(NEW);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_issue_load_certificate ON weighbridge_transactions;
CREATE TRIGGER trg_issue_load_certificate AFTER INSERT OR UPDATE OF status,net_kg ON weighbridge_transactions
  FOR EACH ROW EXECUTE FUNCTION issue_load_certificate();

-- Certificates for tickets completed before this migration, in ticket order.
SELECT count(issue_load_certificate_for(w)) FROM (SELECT * FROM weighbridge_transactions WHERE status='completed'
  ORDER BY operation_date,created_at) w;

-- 5. Monthly carbon baseline -----------------------------------------------------------------------
-- One row per Kampala month, operator, destination and stream: tonnes, the part with a measured composition, and the
-- methane potential under the current factor version. Landfill and transfer-station loads are disposal; composting and
-- materials-recovery loads, and recyclers' weighed purchases, are diversion.
DROP VIEW IF EXISTS carbon_baseline;
DROP MATERIALIZED VIEW IF EXISTS carbon_baseline_monthly;
CREATE MATERIALIZED VIEW carbon_baseline_monthly AS
WITH f AS (SELECT * FROM carbon_factor_sets ORDER BY version DESC LIMIT 1),
loads AS (
  SELECT w.id,w.organization_id,date_trunc('month',w.operation_date)::date AS month,
    CASE WHEN d.kind IN('composting','materials_recovery') THEN d.kind ELSE 'landfill' END AS destination,
    w.net_kg/1000.0 AS tonnes,(lc.ticket_id IS NOT NULL) AS measured
  FROM weighbridge_transactions w
  LEFT JOIN disposal_facilities d ON d.code=w.facility_code
  LEFT JOIN load_compositions lc ON lc.ticket_id=w.id
  WHERE w.status='completed' AND w.net_kg>0
),
load_streams AS (
  SELECT l.organization_id,l.month,l.destination,s.key AS stream_code,l.tonnes*s.value::numeric/100 AS tonnes,l.measured,l.id
  FROM loads l JOIN load_compositions lc ON lc.ticket_id=l.id CROSS JOIN jsonb_each_text(lc.shares) s
  UNION ALL
  SELECT l.organization_id,l.month,l.destination,fs.stream_code,l.tonnes*fs.default_share_pct/100,false,l.id
  FROM loads l CROSS JOIN f JOIN carbon_factor_streams fs ON fs.version=f.version AND fs.default_share_pct>0 WHERE NOT l.measured
),
recovered AS (
  SELECT lot.organization_id,date_trunc('month',lot.collected_on)::date AS month,'recycling'::text AS destination,
    CASE coalesce(cat.category,'other') WHEN 'organic' THEN 'food_organic' WHEN 'plastic' THEN 'plastics' WHEN 'textile' THEN 'textiles'
      ELSE coalesce(cat.category,'other') END AS stream_code,
    lot.quantity_kg/1000.0 AS tonnes,true AS measured,NULL::uuid AS id
  FROM recycling_material_lots lot
  JOIN organizations o ON o.id=lot.organization_id AND o.type='recycling_company'
  LEFT JOIN LATERAL(SELECT c.category FROM recycling_material_catalog c WHERE c.organization_id=lot.organization_id
    AND lower(c.name)=lower(lot.material_type) LIMIT 1) cat ON true
  WHERE lot.origin='purchase' AND lot.status<>'rejected' AND lot.quantity_kg>0
),
everything AS (SELECT * FROM load_streams UNION ALL SELECT * FROM recovered)
SELECT e.month,e.organization_id,e.destination,e.stream_code,f.version AS factor_version,
  count(DISTINCT e.id)::int AS loads,
  round(sum(e.tonnes),4) AS tonnes,
  round(sum(e.tonnes) FILTER (WHERE e.measured),4) AS measured_tonnes,
  round(sum(e.tonnes*fs.doc*f.docf*f.mcf*f.methane_fraction*(16.0/12.0)*(1-f.oxidation)),5) AS ch4_tonnes,
  round(sum(e.tonnes*fs.doc*f.docf*f.mcf*f.methane_fraction*(16.0/12.0)*(1-f.oxidation))*f.gwp_ch4,4) AS co2e_tonnes
FROM everything e CROSS JOIN f
JOIN carbon_factor_streams fs ON fs.version=f.version AND fs.stream_code=e.stream_code
GROUP BY e.month,e.organization_id,e.destination,e.stream_code,f.version,f.gwp_ch4;
CREATE UNIQUE INDEX IF NOT EXISTS carbon_baseline_monthly_key ON carbon_baseline_monthly(month,organization_id,destination,stream_code);
CREATE TABLE IF NOT EXISTS carbon_baseline_refreshes(
 id BIGSERIAL PRIMARY KEY,
 refreshed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 factor_version INT NOT NULL,
 trigger_source TEXT NOT NULL CHECK(trigger_source IN('schedule','kcca','factors'))
);

-- The app reads the baseline through this view, narrowed to its own company for tenant users.
CREATE VIEW carbon_baseline AS SELECT * FROM carbon_baseline_monthly WHERE kwms_tenant_sees(organization_id);
REVOKE ALL ON carbon_baseline_monthly FROM kwms_app;
GRANT SELECT ON carbon_baseline TO kwms_app;

CREATE OR REPLACE FUNCTION refresh_carbon_baseline(p_source TEXT) RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE scope TEXT:=current_setting('app.scope',true); v INT;
BEGIN
  -- The whole city is recomputed whoever asks; the views above narrow what each reader sees.
  PERFORM set_config('app.scope','system',true);
  REFRESH MATERIALIZED VIEW CONCURRENTLY carbon_baseline_monthly;
  PERFORM set_config('app.scope',coalesce(scope,''),true);
  SELECT max(version) INTO v FROM carbon_factor_sets;
  INSERT INTO carbon_baseline_refreshes(factor_version,trigger_source) VALUES(v,p_source);
  RETURN v;
END $$;

-- 6. Access and audit ------------------------------------------------------------------------------
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON load_certificates FROM kwms_app;
ALTER TABLE load_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE load_certificates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kwms_tenant ON load_certificates;
CREATE POLICY kwms_tenant ON load_certificates USING (kwms_tenant_sees(organization_id)) WITH CHECK (kwms_tenant_sees(organization_id));

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['carbon_factor_sets','load_compositions','load_certificates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kwms_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_kwms_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION kwms_audit_row()', t);
  END LOOP;
END $$;

SELECT refresh_carbon_baseline('factors');

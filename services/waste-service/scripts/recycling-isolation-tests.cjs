const assert = require("node:assert/strict");

module.exports = async function recyclingIsolationTests(context) {
  const { client, one, check, request, user } = context;
  const today = (await one("SELECT CURRENT_DATE::text AS value")).value;
  const organization = async name => (await one(
    "INSERT INTO organizations(name,type) VALUES($1,'recycling_company') RETURNING id",
    [name]
  )).id;

  const tenantA = await organization("Rollback recycler A");
  const tenantB = await organization("Rollback recycler B");
  const adminA = await user(tenantA, "company_admin");
  const adminB = await user(tenantB, "company_admin");
  await client.query(
    `INSERT INTO organization_finance_settings(organization_id,opening_balance_ugx,as_of_date,updated_by)
     VALUES($1,1000000,CURRENT_DATE,$3),($2,1000000,CURRENT_DATE,$4)`,
    [tenantA, tenantB, adminA, adminB]
  );

  const partnerA = await request(adminA, "/api/waste/recycling/partners", "POST", {
    partnerType: "both",
    name: "Tenant A partner",
    phone: "+256700000001",
  });
  const partnerB = await request(adminB, "/api/waste/recycling/partners", "POST", {
    partnerType: "both",
    name: "Tenant B partner",
    phone: "+256700000002",
  });
  check(partnerA.status === 201 && partnerB.status === 201, "Each recycler creates its own partner");

  const lotInput = (materialType, sourceName, supplierPartnerId) => ({
    materialType,
    allowNewMaterial: true,
    supplierPartnerId,
    sourceName,
    quantityKg: 100,
    unitPurchasePriceUgx: 500,
    collectedOn: today,
    quality: "mixed",
    purchasePaymentStatus: "credit",
    workerWagesUgx: 0,
    foodUgx: 0,
    transportUgx: 0,
    driverFeeUgx: 0,
    otherExpenseUgx: 0,
    managerFloatUsedUgx: 0,
  });
  const lotA = await request(adminA, "/api/waste/recycling/lots", "POST", lotInput(
    "Isolation PET A", "Tenant A supplier", partnerA.body.data.id
  ));
  const lotB = await request(adminB, "/api/waste/recycling/lots", "POST", lotInput(
    "Isolation PET B", "Tenant B supplier", partnerB.body.data.id
  ));
  check(lotA.status === 201 && lotB.status === 201, "Each recycler records its own material lot");

  const workspaceA = await request(adminA, "/api/waste/recycling");
  const serializedA = JSON.stringify(workspaceA.body.data);
  check(
    workspaceA.status === 200 && serializedA.includes(lotA.body.data.id) && !serializedA.includes(lotB.body.data.id),
    "Recycler A workspace excludes recycler B lots"
  );
  check(
    !serializedA.includes(partnerB.body.data.id),
    "Recycler A workspace excludes recycler B partners"
  );

  const foreignSale = await request(adminA, "/api/waste/recycling/sales", "POST", {
    lotId: lotB.body.data.id,
    buyerName: "Foreign buyer attempt",
    saleChannel: "industrial",
    industry: "Isolation test",
    quantityKg: 5,
    unitPriceUgx: 800,
    soldOn: today,
    workerWagesUgx: 0,
    foodUgx: 0,
    transportUgx: 0,
    otherExpenseUgx: 0,
  });
  check(foreignSale.status === 409, "API rejects a sale using another tenant's lot");

  const foreignPartnerUpdate = await request(
    adminA,
    `/api/waste/recycling/partners/${partnerB.body.data.id}/status`,
    "PATCH",
    { active: false }
  );
  check(foreignPartnerUpdate.status === 404, "API hides and rejects another tenant's partner");

  await client.query("SAVEPOINT tenant_fk_probe");
  let databaseRejected = false;
  try {
    await client.query(
      `INSERT INTO recycling_material_sales(
        organization_id,lot_id,buyer_name,industry,quantity_kg,unit_price_ugx,sold_on,recorded_by
       ) VALUES($1,$2,'Cross tenant probe','Test',1,1,$3,$4)`,
      [tenantA, lotB.body.data.id, today, adminA]
    );
  } catch (error) {
    databaseRejected = error && error.code === "23503";
    await client.query("ROLLBACK TO SAVEPOINT tenant_fk_probe");
  }
  await client.query("RELEASE SAVEPOINT tenant_fk_probe");
  check(databaseRejected, "PostgreSQL rejects a cross-tenant recycling relationship");

  const count = await one(
    "SELECT count(*)::int AS value FROM recycling_material_sales WHERE organization_id=$1::uuid AND lot_id=$2::uuid",
    [tenantA, lotB.body.data.id]
  );
  assert.equal(count.value, 0, "cross-tenant probe must leave no data behind");
};

import assert from "node:assert/strict";
import test from "node:test";
import {
  cashMovementSchema,
  dailyCloseSchema,
  dailyReopenSchema,
  lotSchema,
  lotUpdateSchema,
  managerFloatSchema,
  materialCatalogSchema,
  salePaymentSchema,
  saleSchema,
  saleUpdateSchema,
  sortingSchema,
} from "../src/validators/recycling.validator";

const lotId = "11111111-1111-4111-8111-111111111111";

test("a recycling purchase records material, supplier, quantity and operating costs", () => {
  const purchase = lotSchema.parse({
    materialType: "PET bottles",
    sourceName: "Kisenyi collection point",
    quantityKg: 300,
    unitPurchasePriceUgx: 1000,
    collectedOn: "2026-10-06",
    quality: "mixed",
    purchasePaymentStatus: "credit",
    workerWagesUgx: 25000,
    foodUgx: 10000,
    transportUgx: 30000,
    driverFeeUgx: 0,
    otherExpenseUgx: 0,
    managerFloatUsedUgx: 65000,
  });

  assert.equal(purchase.quantityKg, 300);
  assert.equal(purchase.purchasePaymentStatus, "credit");
  assert.equal(purchase.allowNewMaterial, false);
  assert.throws(() => lotSchema.parse({ ...purchase, quantityKg: 0 }));
  assert.throws(() => lotSchema.parse({ ...purchase, quantityKg: -1 }));
});

test("a custom material must be explicitly marked for catalogue creation", () => {
  const purchase = lotSchema.parse({
    materialType: "Copper cable", allowNewMaterial: true, sourceName: "Kisenyi collection point",
    quantityKg: 10, unitPurchasePriceUgx: 2000, collectedOn: "2026-10-11", quality: "mixed",
    purchasePaymentStatus: "paid", workerWagesUgx: 0, foodUgx: 0, transportUgx: 0,
    driverFeeUgx: 0, otherExpenseUgx: 0, managerFloatUsedUgx: 0,
  });
  assert.equal(purchase.allowNewMaterial, true);
});

test("sorting cannot create more output and rejected material than its input", () => {
  const batch = {
    inputLotId: lotId,
    processedOn: "2026-10-06",
    inputKg: 100,
    outputMaterialType: "Clean PET",
    outputKg: 85,
    rejectedKg: 15,
    workerWagesUgx:10000,utilitiesUgx:5000,transportUgx:2000,consumablesUgx:3000,otherExpenseUgx:0,managerFloatUsedUgx:10000,
  };

  assert.equal(sortingSchema.parse(batch).outputKg, 85);
  assert.throws(() => sortingSchema.parse({ ...batch, outputKg: 90 }));
  assert.throws(() => sortingSchema.parse({ ...batch, managerFloatUsedUgx: 25000 }));
});

test("cash and float movements require traceable references and controlled purposes",()=>{
  assert.equal(managerFloatSchema.parse({transactionDate:"2026-10-19",transactionType:"returned",amountUgx:50000,reference:"FLT-RET-001",notes:"Unused purchasing float returned"}).transactionType,"returned");
  assert.throws(()=>managerFloatSchema.parse({transactionDate:"2026-10-19",transactionType:"spent",amountUgx:50000,reference:"",notes:"Fuel"}));
  assert.equal(cashMovementSchema.parse({movementDate:"2026-10-19",direction:"in",category:"capital_contribution",amountUgx:1000000,reference:"BANK-001",counterparty:"Owner",notes:"Additional operating capital"}).direction,"in");
  assert.throws(()=>cashMovementSchema.parse({movementDate:"2026-10-19",direction:"out",category:"other_income",amountUgx:1000,reference:"BAD-001",notes:"Invalid direction"}));
});

test("sales distinguish local buyers from industrial buyers", () => {
  const baseSale = {
    lotId,
    buyerName: "Kampala Plastics",
    industry: "Kampala Plastics",
    quantityKg: 50,
    unitPriceUgx: 1800,
    soldOn: "2026-10-06",
    workerWagesUgx: 0,
    foodUgx: 0,
    transportUgx: 10000,
    otherExpenseUgx: 0,
  };

  assert.equal(saleSchema.parse({ ...baseSale, saleChannel: "local" }).saleChannel, "local");
  assert.equal(saleSchema.parse({ ...baseSale, saleChannel: "industrial" }).saleChannel, "industrial");
  assert.throws(() => saleSchema.parse({ ...baseSale, buyerName: "" }));
});

test("transaction corrections reuse controlled purchase and sale fields", () => {
  const purchase = lotUpdateSchema.parse({
    materialType: "PET bottles", sourceName: "Kisenyi collection point", quantityKg: 200,
    unitPurchasePriceUgx: 1200, collectedOn: "2026-10-18", quality: "clean",
    workerWagesUgx: 10000, foodUgx: 5000, transportUgx: 15000, driverFeeUgx: 0,
    otherExpenseUgx: 0, purchasePaymentStatus: "paid", managerFloatUsedUgx: 999999,
  });
  assert.equal(purchase.quantityKg, 200);
  assert.equal("purchasePaymentStatus" in purchase, false);
  assert.equal("managerFloatUsedUgx" in purchase, false);
  const sale = saleUpdateSchema.parse({
    lotId, buyerName: "Kampala Plastics", saleChannel: "industrial", industry: "Plastic manufacturing",
    quantityKg: 40, unitPriceUgx: 2000, soldOn: "2026-10-18", workerWagesUgx: 0,
    foodUgx: 0, transportUgx: 0, otherExpenseUgx: 0,
  });
  assert.equal(sale.quantityKg, 40);
  assert.throws(() => saleUpdateSchema.parse({...sale,quantityKg:0}));
});

test("sale payments require a positive amount, date and traceable reference", () => {
  const payment = salePaymentSchema.parse({
    amountUgx: 250000,
    paymentReceivedOn: "2026-10-06",
    paymentReference: "BANK-20261006-001",
  });

  assert.equal(payment.amountUgx, 250000);
  assert.throws(() => salePaymentSchema.parse({ ...payment, amountUgx: 0 }));
  assert.throws(() => salePaymentSchema.parse({ ...payment, paymentReference: "" }));
});

test("material catalogue keeps reporting names and categories controlled", () => {
  const material = materialCatalogSchema.parse({ name: "Clear PET flakes", category: "plastic" });
  assert.equal(material.name, "Clear PET flakes");
  assert.throws(() => materialCatalogSchema.parse({ name: "P", category: "plastic" }));
  assert.throws(() => materialCatalogSchema.parse({ name: "PET", category: "unknown" }));
});

test("daily closing requires a valid date and controlled reopen reason", () => {
  assert.equal(dailyCloseSchema.parse({ operatingDate: "2026-10-10" }).operatingDate, "2026-10-10");
  assert.equal(dailyReopenSchema.parse({ reason: "Missing supplier receipt" }).reason, "Missing supplier receipt");
  assert.throws(() => dailyCloseSchema.parse({ operatingDate: "10/10/2026" }));
  assert.throws(() => dailyReopenSchema.parse({ reason: "fix" }));
});

test("field purchases accept valid GPS proof only as a coordinate pair", () => {
  const base = {
    materialType: "PET bottles", sourceName: "Kisenyi collection point", quantityKg: 25,
    unitPurchasePriceUgx: 900, collectedOn: "2026-10-11", quality: "mixed" as const,
    purchasePaymentStatus: "paid" as const, workerWagesUgx: 0, foodUgx: 0,
    transportUgx: 0, driverFeeUgx: 0, otherExpenseUgx: 0, managerFloatUsedUgx: 0,
  };
  const located = lotSchema.parse({ ...base, collectionLatitude: 0.3136, collectionLongitude: 32.5811, collectionAccuracyM: 12 });
  assert.equal(located.collectionAccuracyM, 12);
  assert.throws(() => lotSchema.parse({ ...base, collectionLatitude: 0.3136 }));
  assert.throws(() => lotSchema.parse({ ...base, collectionLatitude: 91, collectionLongitude: 32.5811 }));
});

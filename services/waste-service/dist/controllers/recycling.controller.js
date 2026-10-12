"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecycling = getRecycling;
exports.postLot = postLot;
exports.postSale = postSale;
exports.postManagerFloat = postManagerFloat;
exports.postSorting = postSorting;
exports.postStockAdjustment = postStockAdjustment;
exports.postPartner = postPartner;
exports.patchPartnerState = patchPartnerState;
exports.postMaterial = postMaterial;
exports.patchMaterialState = patchMaterialState;
exports.payPurchase = payPurchase;
exports.paySale = paySale;
exports.patchPurchaseDueDate = patchPurchaseDueDate;
exports.patchSaleDueDate = patchSaleDueDate;
exports.postPaymentFollowUp = postPaymentFollowUp;
exports.postDailyClose = postDailyClose;
exports.patchDailyReopen = patchDailyReopen;
const organization_scope_1 = require("../middlewares/organization-scope");
const repo = __importStar(require("../repositories/recycling.repository"));
const recycling_validator_1 = require("../validators/recycling.validator");
const identity = (r) => r.auth;
const org = (r) => {
    const id = identity(r).organizationId;
    if (!id)
        throw Object.assign(new Error("Account is not linked to an organization"), {
            statusCode: 403,
        });
    return id;
};
async function getRecycling(r, s) {
    const account = identity(r), roles = account.roles, data = await repo.findRecycling((0, organization_scope_1.requireOrganizationScope)(r)), date = (value) => String(value || "").slice(0, 10), today = data.operations.operatingDate, byDate = (lots, sales) => {
        const dates = [
            ...new Set([
                ...lots.map((x) => date(x.collected_on)),
                ...sales.map((x) => date(x.sold_on)),
            ]),
        ]
            .filter(Boolean)
            .sort()
            .reverse();
        return dates.map((activityDate) => {
            const dayLots = lots.filter((x) => date(x.collected_on) === activityDate), daySales = sales.filter((x) => date(x.sold_on) === activityDate);
            return {
                date: activityDate,
                purchases: dayLots.length,
                purchasedKg: dayLots.reduce((n, x) => n + Number(x.quantity_kg), 0),
                sales: daySales.length,
                soldKg: daySales.reduce((n, x) => n + Number(x.quantity_kg), 0),
                saleValueUgx: daySales.reduce((n, x) => n + Number(x.total_ugx), 0),
                purchaseIds: dayLots.map((x) => x.id),
                saleIds: daySales.map((x) => x.id),
            };
        });
    };
    if (roles.includes("recycling_collector")) {
        const sales = data.sales.filter((item) => item.sale_channel === "local"), saleIds = new Set(sales.map((item) => item.id)), ownLots = data.lots.filter((item) => item.created_by === account.userId && item.origin === "purchase"), ownSales = sales.filter((item) => item.recorded_by === account.userId), dailyActivity = byDate(ownLots, ownSales), myActivity = dailyActivity.find((item) => item.date === today) ?? {
            date: today,
            purchases: 0,
            purchasedKg: 0,
            sales: 0,
            soldKg: 0,
            saleValueUgx: 0,
        };
        return s.json({
            success: true,
            message: "Daily collection workspace fetched",
            data: {
                ...data,
                myActivity,
                dailyActivity,
                sales,
                salePayments: data.salePayments.filter((item) => saleIds.has(item.sale_id)),
                floatTransactions: [],
                paymentAging: {
                    receivables: {
                        current: 0,
                        days1To30: 0,
                        days31To60: 0,
                        days61Plus: 0,
                    },
                    payables: { current: 0, days1To30: 0, days31To60: 0, days61Plus: 0 },
                },
                buyerExposure: [],
                upcomingFollowUps: [],
            },
        });
    }
    if (roles.includes("recycling_sales")) {
        const sales = data.sales.filter((item) => item.sale_channel === "industrial"), saleIds = new Set(sales.map((item) => item.id)), ownSales = sales.filter((item) => item.recorded_by === account.userId), dailyActivity = byDate([], ownSales), todayActivity = dailyActivity.find((item) => item.date === today), myActivity = {
            ...(todayActivity ?? {
                date: today,
                sales: 0,
                soldKg: 0,
                saleValueUgx: 0,
            }),
            outstandingUgx: ownSales
                .filter((item) => item.status !== "paid")
                .reduce((n, item) => n + Number(item.balance_ugx), 0),
        };
        return s.json({
            success: true,
            message: "Industrial sales workspace fetched",
            data: {
                ...data,
                myActivity,
                dailyActivity,
                lots: data.lots.map((item) => ({
                    ...item,
                    unit_purchase_price_ugx: "0",
                    material_cost_ugx: "0",
                    total_cost_ugx: "0",
                    paid_ugx: "0",
                    balance_ugx: "0",
                })),
                sales,
                salePayments: data.salePayments.filter((item) => saleIds.has(item.sale_id)),
                purchasePayments: [],
                floatTransactions: [],
            },
        });
    }
    return s.json({
        success: true,
        message: "Recycling workspace fetched",
        data,
    });
}
async function postLot(r, s) {
    const organizationId = org(r), input = recycling_validator_1.lotSchema.parse(r.body);
    await repo.assertPurchaseFunding(organizationId, input);
    const lot = await repo.createLot(organizationId, identity(r).userId, input);
    if (input.collectionLatitude !== undefined &&
        input.collectionLongitude !== undefined)
        await repo.setLotCollectionLocation(organizationId, lot.id, input);
    return s
        .status(201)
        .json({ success: true, message: "Recovered material recorded", data: lot });
}
async function postSale(r, s) {
    const organizationId = org(r), input = recycling_validator_1.saleSchema.parse(r.body), roles = identity(r).roles;
    if (roles.includes("recycling_collector") && input.saleChannel !== "local")
        return s
            .status(403)
            .json({
            success: false,
            message: "Collection workers may record local sales only",
        });
    if (roles.includes("recycling_sales") && input.saleChannel !== "industrial")
        return s
            .status(403)
            .json({
            success: false,
            message: "Industrial sales staff may record industry sales only",
        });
    await repo.assertCashFunding(organizationId, input.workerWagesUgx +
        input.foodUgx +
        input.transportUgx +
        input.otherExpenseUgx, "Sale expenses");
    const result = await repo.createSale(organizationId, identity(r).userId, input);
    return result
        ? s
            .status(201)
            .json({
            success: true,
            message: `${input.saleChannel === "local" ? "Local" : "Industrial"} sale recorded`,
            data: result,
        })
        : s
            .status(409)
            .json({
            success: false,
            message: "The material lot is missing or does not have enough available quantity",
        });
}
async function postManagerFloat(r, s) {
    const organizationId = org(r), input = recycling_validator_1.managerFloatSchema.parse(r.body);
    await repo.assertFloatFunding(organizationId, input);
    return s
        .status(201)
        .json({
        success: true,
        message: "Manager float transaction recorded",
        data: await repo.createFloatTransaction(organizationId, identity(r).userId, input),
    });
}
async function postSorting(r, s) {
    const organizationId = org(r), input = recycling_validator_1.sortingSchema.parse(r.body);
    await repo.assertCashFunding(organizationId, input.processingCostUgx, "Processing cost");
    const result = await repo.createSortingBatch(organizationId, identity(r).userId, input);
    return result
        ? s
            .status(201)
            .json({
            success: true,
            message: "Sorting and grading recorded",
            data: result,
        })
        : s
            .status(409)
            .json({
            success: false,
            message: "The input material lot is missing or does not have enough available quantity",
        });
}
async function postStockAdjustment(r, s) {
    const result = await repo.createStockAdjustment(org(r), identity(r).userId, recycling_validator_1.stockAdjustmentSchema.parse(r.body));
    return result
        ? s
            .status(201)
            .json({
            success: true,
            message: "Stock adjustment recorded",
            data: result,
        })
        : s
            .status(409)
            .json({
            success: false,
            message: "The selected stock lot does not have enough available quantity for this adjustment",
        });
}
async function postPartner(r, s) {
    return s
        .status(201)
        .json({
        success: true,
        message: "Trade partner created",
        data: await repo.createPartner(org(r), identity(r).userId, recycling_validator_1.partnerSchema.parse(r.body)),
    });
}
async function patchPartnerState(r, s) {
    const result = await repo.setPartnerState(org(r), r.params.id, recycling_validator_1.partnerStateSchema.parse(r.body).active);
    return result
        ? s.json({ success: true, message: "Trade partner updated", data: result })
        : s
            .status(404)
            .json({ success: false, message: "Trade partner not found" });
}
async function postMaterial(r, s) {
    return s
        .status(201)
        .json({
        success: true,
        message: "Material added to catalogue",
        data: await repo.createMaterial(org(r), identity(r).userId, recycling_validator_1.materialCatalogSchema.parse(r.body)),
    });
}
async function patchMaterialState(r, s) {
    const result = await repo.setMaterialState(org(r), r.params.id, recycling_validator_1.materialCatalogStateSchema.parse(r.body).active);
    return result
        ? s.json({
            success: true,
            message: "Material catalogue updated",
            data: result,
        })
        : s.status(404).json({ success: false, message: "Material not found" });
}
async function payPurchase(r, s) {
    const organizationId = org(r), input = recycling_validator_1.salePaymentSchema.parse(r.body);
    await repo.assertCreditPurchasePaymentFunding(organizationId, input.amountUgx);
    const result = await repo.markPurchasePaid(organizationId, identity(r).userId, r.params.id, input);
    return result
        ? s.json({
            success: true,
            message: "Purchase payment recorded",
            data: result,
        })
        : s
            .status(409)
            .json({
            success: false,
            message: "Payment exceeds the remaining balance, uses an invalid date, or the purchase is already paid",
        });
}
async function paySale(r, s) {
    const result = await repo.markSalePaid(org(r), identity(r).userId, r.params.id, recycling_validator_1.salePaymentSchema.parse(r.body));
    return result
        ? s.json({ success: true, message: "Sale payment recorded", data: result })
        : s
            .status(409)
            .json({
            success: false,
            message: "Payment exceeds the remaining balance, uses an invalid date, or the sale is already paid",
        });
}
async function patchPurchaseDueDate(r, s) {
    const result = await repo.setPurchaseDueDate(org(r), r.params.id, recycling_validator_1.paymentDueDateSchema.parse(r.body).dueOn);
    return result
        ? s.json({
            success: true,
            message: "Supplier payment deadline updated",
            data: result,
        })
        : s
            .status(409)
            .json({
            success: false,
            message: "Choose a date on or after the purchase date for an unpaid credit purchase",
        });
}
async function patchSaleDueDate(r, s) {
    const result = await repo.setSaleDueDate(org(r), r.params.id, recycling_validator_1.paymentDueDateSchema.parse(r.body).dueOn);
    return result
        ? s.json({
            success: true,
            message: "Customer payment deadline updated",
            data: result,
        })
        : s
            .status(409)
            .json({
            success: false,
            message: "Choose a date on or after the sale date for an unpaid industrial sale",
        });
}
async function postPaymentFollowUp(r, s) {
    const result = await repo.createPaymentFollowUp(org(r), identity(r).userId, r.params.id, recycling_validator_1.paymentFollowUpSchema.parse(r.body));
    return result
        ? s
            .status(201)
            .json({
            success: true,
            message: "Payment follow-up recorded",
            data: result,
        })
        : s
            .status(409)
            .json({
            success: false,
            message: "Follow-up can only be recorded for an unpaid industrial sale",
        });
}
async function postDailyClose(r, s) {
    const result = await repo.closeRecyclingDay(org(r), identity(r).userId, recycling_validator_1.dailyCloseSchema.parse(r.body));
    return s
        .status(201)
        .json({
        success: true,
        message: `Business day ${result.operating_date} closed`,
        data: result,
    });
}
async function patchDailyReopen(r, s) {
    const result = await repo.reopenRecyclingDay(org(r), identity(r).userId, r.params.id, recycling_validator_1.dailyReopenSchema.parse(r.body).reason);
    return result
        ? s.json({
            success: true,
            message: `Business day ${result.operating_date} reopened`,
            data: result,
        })
        : s
            .status(404)
            .json({ success: false, message: "Closed business day not found" });
}

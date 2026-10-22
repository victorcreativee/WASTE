import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { requireOrganizationScope } from "../middlewares/organization-scope";
import * as repo from "../repositories/recycling.repository";
import {
  cashMovementSchema,
  dailyCloseSchema,
  dailyReopenSchema,
  lotSchema,
  lotUpdateSchema,
  managerFloatSchema,
  materialCatalogSchema,
  materialCatalogStateSchema,
  partnerSchema,
  partnerStateSchema,
  paymentDueDateSchema,
  paymentFollowUpSchema,
  salePaymentSchema,
  saleSchema,
  saleUpdateSchema,
  sortingSchema,
  stockAdjustmentSchema,
} from "../validators/recycling.validator";
const identity = (r: Request) => (r as AuthenticatedRequest).auth!;
const org = (r: Request) => {
  const id = identity(r).organizationId;
  if (!id)
    throw Object.assign(new Error("Account is not linked to an organization"), {
      statusCode: 403,
    });
  return id;
};
export async function getRecycling(r: Request, s: Response) {
  // Operational clients must always prefer the current organization ledger
  // while online. Device SQLite remains the fallback only when the API cannot
  // be reached.
  s.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
  s.set("Pragma", "no-cache");
  s.set("Expires", "0");
  const account = identity(r),
    roles = account.roles,
    data: any = await repo.findRecycling(requireOrganizationScope(r)),
    date = (value: any) => String(value || "").slice(0, 10),
    today = data.operations.operatingDate,
    byDate = (lots: any[], sales: any[]) => {
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
        const dayLots = lots.filter(
            (x) => date(x.collected_on) === activityDate,
          ),
          daySales = sales.filter((x) => date(x.sold_on) === activityDate);
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
    const sales = data.sales.filter(
        (item: any) => item.sale_channel === "local",
      ),
      saleIds = new Set(sales.map((item: any) => item.id)),
      ownLots = data.lots.filter(
        (item: any) =>
          item.created_by === account.userId && item.origin === "purchase",
      ),
      ownSales = sales.filter(
        (item: any) => item.recorded_by === account.userId,
      ),
      dailyActivity = byDate(ownLots, ownSales),
      myActivity = dailyActivity.find((item: any) => item.date === today) ?? {
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
        salePayments: data.salePayments.filter((item: any) =>
          saleIds.has(item.sale_id),
        ),
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
    const sales = data.sales.filter(
        (item: any) => item.sale_channel === "industrial",
      ),
      saleIds = new Set(sales.map((item: any) => item.id)),
      ownSales = sales.filter(
        (item: any) => item.recorded_by === account.userId,
      ),
      dailyActivity = byDate([], ownSales),
      todayActivity = dailyActivity.find((item: any) => item.date === today),
      myActivity = {
        ...(todayActivity ?? {
          date: today,
          sales: 0,
          soldKg: 0,
          saleValueUgx: 0,
        }),
        outstandingUgx: ownSales
          .filter((item: any) => item.status !== "paid")
          .reduce((n: number, item: any) => n + Number(item.balance_ugx), 0),
      };
    return s.json({
      success: true,
      message: "Industrial sales workspace fetched",
      data: {
        ...data,
        myActivity,
        dailyActivity,
        lots: data.lots.map((item: any) => ({
          ...item,
          unit_purchase_price_ugx: "0",
          material_cost_ugx: "0",
          total_cost_ugx: "0",
          paid_ugx: "0",
          balance_ugx: "0",
        })),
        sales,
        salePayments: data.salePayments.filter((item: any) =>
          saleIds.has(item.sale_id),
        ),
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
export async function postLot(r: Request, s: Response) {
  const organizationId = org(r),
    input = lotSchema.parse(r.body);
  await repo.assertPurchaseFunding(organizationId, input);
  const lot = await repo.createLot(organizationId, identity(r).userId, input);
  if (
    input.collectionLatitude !== undefined &&
    input.collectionLongitude !== undefined
  )
    await repo.setLotCollectionLocation(organizationId, lot.id, input);
  return s
    .status(201)
    .json({ success: true, message: "Recovered material recorded", data: lot });
}
export async function postSale(r: Request, s: Response) {
  const organizationId = org(r),
    input = saleSchema.parse(r.body),
    roles = identity(r).roles;
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
  await repo.assertCashFunding(
    organizationId,
    input.workerWagesUgx +
      input.foodUgx +
      input.transportUgx +
      input.otherExpenseUgx,
    "Sale expenses",
  );
  const result = await repo.createSale(
    organizationId,
    identity(r).userId,
    input,
  );
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
          message:
            "The material lot is missing or does not have enough available quantity",
        });
}
export async function patchLot(r:Request,s:Response){const result=await repo.updateLot(org(r),identity(r).userId,r.params.id as string,lotUpdateSchema.parse(r.body));return result?s.json({success:true,message:'Purchase transaction updated',data:result}):s.status(404).json({success:false,message:'Purchase transaction not found'});}
export async function patchSale(r:Request,s:Response){const input=saleUpdateSchema.parse(r.body),roles=identity(r).roles;if(roles.includes('recycling_collector')&&input.saleChannel!=='local')return s.status(403).json({success:false,message:'Collection workers may edit local sales only'});if(roles.includes('recycling_sales')&&input.saleChannel!=='industrial')return s.status(403).json({success:false,message:'Industrial sales staff may edit industry sales only'});const result=await repo.updateSale(org(r),identity(r).userId,r.params.id as string,input);return result?s.json({success:true,message:'Sale transaction updated',data:result}):s.status(404).json({success:false,message:'Sale transaction not found'});}
export async function postManagerFloat(r: Request, s: Response) {
  const organizationId = org(r),
    input = managerFloatSchema.parse(r.body);
  return s
    .status(201)
    .json({
      success: true,
      message: "Manager float transaction recorded",
      data: await repo.createFloatTransaction(
        organizationId,
        identity(r).userId,
        input,
      ),
    });
}
export async function postCashMovement(r:Request,s:Response){const input=cashMovementSchema.parse(r.body);return s.status(201).json({success:true,message:"Cash movement posted",data:await repo.createCashMovement(org(r),identity(r).userId,input)});}
export async function postSorting(r: Request, s: Response) {
  const organizationId = org(r),
    input = sortingSchema.parse(r.body);
  const result = await repo.createSortingBatch(
    organizationId,
    identity(r).userId,
    input,
  );
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
          message:
            "The input material lot is missing or does not have enough available quantity",
        });
}
export async function postStockAdjustment(r: Request, s: Response) {
  const result = await repo.createStockAdjustment(
    org(r),
    identity(r).userId,
    stockAdjustmentSchema.parse(r.body),
  );
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
          message:
            "The selected stock lot does not have enough available quantity for this adjustment",
        });
}
export async function postPartner(r: Request, s: Response) {
  return s
    .status(201)
    .json({
      success: true,
      message: "Trade partner created",
      data: await repo.createPartner(
        org(r),
        identity(r).userId,
        partnerSchema.parse(r.body),
      ),
    });
}
export async function patchPartner(r: Request, s: Response) {
  const result = await repo.updatePartner(
    org(r),
    r.params.id as string,
    partnerSchema.parse(r.body),
  );
  return result
    ? s.json({ success: true, message: "Trade partner details updated", data: result })
    : s.status(404).json({ success: false, message: "Trade partner not found" });
}
export async function patchPartnerState(r: Request, s: Response) {
  const result = await repo.setPartnerState(
    org(r),
    r.params.id as string,
    partnerStateSchema.parse(r.body).active,
  );
  return result
    ? s.json({ success: true, message: "Trade partner updated", data: result })
    : s
        .status(404)
        .json({ success: false, message: "Trade partner not found" });
}
export async function postMaterial(r: Request, s: Response) {
  return s
    .status(201)
    .json({
      success: true,
      message: "Material added to catalogue",
      data: await repo.createMaterial(
        org(r),
        identity(r).userId,
        materialCatalogSchema.parse(r.body),
      ),
    });
}
export async function patchMaterialState(r: Request, s: Response) {
  const result = await repo.setMaterialState(
    org(r),
    r.params.id as string,
    materialCatalogStateSchema.parse(r.body).active,
  );
  return result
    ? s.json({
        success: true,
        message: "Material catalogue updated",
        data: result,
      })
    : s.status(404).json({ success: false, message: "Material not found" });
}
export async function payPurchase(r: Request, s: Response) {
  const organizationId = org(r),
    input = salePaymentSchema.parse(r.body);
  await repo.assertCreditPurchasePaymentFunding(
    organizationId,
    input.amountUgx,
  );
  const result = await repo.markPurchasePaid(
    organizationId,
    identity(r).userId,
    r.params.id as string,
    input,
  );
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
          message:
            "Payment exceeds the remaining balance, uses an invalid date, or the purchase is already paid",
        });
}
export async function paySale(r: Request, s: Response) {
  const result = await repo.markSalePaid(
    org(r),
    identity(r).userId,
    r.params.id as string,
    salePaymentSchema.parse(r.body),
  );
  return result
    ? s.json({ success: true, message: "Sale payment recorded", data: result })
    : s
        .status(409)
        .json({
          success: false,
          message:
            "Payment exceeds the remaining balance, uses an invalid date, or the sale is already paid",
        });
}
export async function patchPurchaseDueDate(r: Request, s: Response) {
  const result = await repo.setPurchaseDueDate(
    org(r),
    r.params.id as string,
    paymentDueDateSchema.parse(r.body).dueOn,
  );
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
          message:
            "Choose a date on or after the purchase date for an unpaid credit purchase",
        });
}
export async function patchSaleDueDate(r: Request, s: Response) {
  const result = await repo.setSaleDueDate(
    org(r),
    r.params.id as string,
    paymentDueDateSchema.parse(r.body).dueOn,
  );
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
          message:
            "Choose a date on or after the sale date for an unpaid industrial sale",
        });
}
export async function postPaymentFollowUp(r: Request, s: Response) {
  const result = await repo.createPaymentFollowUp(
    org(r),
    identity(r).userId,
    r.params.id as string,
    paymentFollowUpSchema.parse(r.body),
  );
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
          message:
            "Follow-up can only be recorded for an unpaid industrial sale",
        });
}
export async function postDailyClose(r: Request, s: Response) {
  const result = await repo.closeRecyclingDay(
    org(r),
    identity(r).userId,
    dailyCloseSchema.parse(r.body),
  );
  return s
    .status(201)
    .json({
      success: true,
      message: `Business day ${result.operating_date} closed`,
      data: result,
    });
}
export async function patchDailyReopen(r: Request, s: Response) {
  const result = await repo.reopenRecyclingDay(
    org(r),
    identity(r).userId,
    r.params.id as string,
    dailyReopenSchema.parse(r.body).reason,
  );
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

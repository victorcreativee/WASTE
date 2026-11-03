export type CompanyReport = {
 organization:{id:string;name:string;type:string};range:{from:string;to:string};generatedAt:string;
 basis:{stock:string;balances:string;profit:string};warnings:string[];
 summary:Record<'purchases'|'purchasedKg'|'purchaseCostUgx'|'deliveries'|'sales'|'soldKg'|'revenueUgx'|'costOfGoodsUgx'|'grossProfitUgx'|'sellingCostsUgx'|'operatingExpensesUgx'|'stockLossUgx'|'operatingProfitUgx'|'marginPercent'|'buyerReceiptsUgx'|'supplierPaymentsUgx'|'receivablesUgx'|'payablesUgx'|'stockKg'|'stockValueUgx'|'draftExpensesUgx'|'workerAdvancesUgx',number>;
 stock:{material:string;quantityKg:number;valueUgx:number}[];
 daily:{date:string;purchases:number;purchaseCostUgx:number;purchasedKg:number;sales:number;revenueUgx:number;soldKg:number;operatingProfitUgx:number}[];
 suppliers:{name:string;transactions:number;quantityKg:number;valueUgx:number;paidUgx:number;balanceUgx:number}[];
 buyers:CompanyReport['suppliers'];
 purchases:{id:string;material_type:string;source_name:string;collected_on:string;quantity_kg:number|string;totalCostUgx:number;paidUgx:number;balanceUgx:number}[];
 sales:{id:string;material_type:string;buyer_name:string;sold_on:string;quantity_kg:number|string;revenueUgx:number;costOfGoodsUgx:number;sellingCostsUgx:number;paidUgx:number;balanceUgx:number}[];
 expenses:{id:string;expense_date:string;description:string;category:string;status:string;amount_ugx:number|string}[];
};

import { useEffect, useState } from 'react';
import { ActivityIndicator, Share, Text, View } from 'react-native';
import type { CompanyReport as Report } from '../lib/company-report-contract';
import { mobileRequest } from '../lib/mobile-api';
import { localDay } from '../lib/dates';
import { Banner, Button, Card, Chips, DateField, SectionHeader } from '../ui/kit';
import { color, space, type, ugx } from '../ui/theme';
const kg=(n:number)=>`${n.toLocaleString('en-GB',{maximumFractionDigits:2})} kg`;
export function CompanyReport({token,email}:{token:string;email:string}){
 const [details,setDetails]=useState('none');
 const [range,setRange]=useState(()=>({from:localDay().slice(0,7)+'-01',to:localDay()}));
 const [applied,setApplied]=useState(range),[report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[version,setVersion]=useState(0);
 useEffect(()=>{
  let active=true;
  void Promise.resolve().then(async()=>{
   if(!active)return;setLoading(true);setError('');
   try{const result=await mobileRequest<{data:Report}>(`/api/waste/reports/company?from=${applied.from}&to=${applied.to}`,token,email);if(active)setReport(result.data);}
   catch(e){if(active){setReport(null);setError(e instanceof Error?e.message:'Connect to load this report.');}}
   finally{if(active)setLoading(false);}
  });
  return()=>{active=false;};
 },[applied,email,token,version]);
 const valid=range.from&&range.to&&range.from<=range.to;
 const showing=report?.range.from===applied.from&&report.range.to===applied.to?report:null;
 const matches=range.from===applied.from&&range.to===applied.to;
 const share=async()=>{if(!showing)return;const r=showing,s=r.summary;try{await Share.share({message:[`${r.organization.name} · company report`,`${r.range.from} to ${r.range.to}`,`Generated ${new Date(r.generatedAt).toLocaleString('en-GB')}`,'',`Purchases: ${s.deliveries} deliveries · ${kg(s.purchasedKg)} · ${ugx(s.purchaseCostUgx)}`,`Sales: ${s.sales} · ${kg(s.soldKg)} · ${ugx(s.revenueUgx)}`,`Material sold cost: ${ugx(s.costOfGoodsUgx)}`,`Gross profit: ${ugx(s.grossProfitUgx)}`,`Selling costs: ${ugx(s.sellingCostsUgx)}`,`Operating expenses: ${ugx(s.operatingExpensesUgx)}`,`Stock losses: ${ugx(s.stockLossUgx)}`,`Operating profit estimate: ${ugx(s.operatingProfitUgx)}`,`Buyer receipts: ${ugx(s.buyerReceiptsUgx)}`,`Supplier payments: ${ugx(s.supplierPaymentsUgx)}`,`Buyers owe at period end: ${ugx(s.receivablesUgx)}`,`Suppliers owed at period end: ${ugx(s.payablesUgx)}`,'','Stock at report generation:',...r.stock.map(d=>`${d.material}: ${kg(d.quantityKg)} · ${ugx(d.valueUgx)}`),'','Daily performance:',...r.daily.map(d=>`${d.date}: sales ${ugx(d.revenueUgx)} · profit ${ugx(d.operatingProfitUgx)}`),'',r.basis.profit,...r.warnings].join('\n')});}catch{setError('Could not open sharing. Please try again.');}};
 return <View style={{gap:space.lg}}>
  <Card><Text style={type.heading}>Complete company report</Text><Text style={type.small}>Purchases, sales, expenses, stock and profit.</Text><Chips value="" onChange={value=>{const r={from:value==='today'?localDay():localDay().slice(0,7)+'-01',to:localDay()};setRange(r);setApplied(r);}} options={[{value:'today',label:'Today'},{value:'month',label:'This month'}]}/><Text style={type.label}>From</Text><DateField value={range.from} onChange={from=>setRange({...range,from})}/><Text style={type.label}>To</Text><DateField value={range.to} onChange={to=>setRange({...range,to})}/><Button title={loading?'Loading…':'Apply / refresh report'} disabled={!valid||loading} onPress={()=>{setApplied({...range});setVersion(v=>v+1);}}/></Card>
  {error?<Banner tone="warning" text={error}/>:null}{loading?<ActivityIndicator color={color.action}/>:null}
  {!matches?<Banner tone="warning" text="Apply the selected period to refresh these figures."/>:null}
  {showing?<>
   <Banner tone="neutral" title={`${showing.organization.name} · ${showing.range.from} to ${showing.range.to}`} text={`Generated ${new Date(showing.generatedAt).toLocaleString('en-GB')}. A saved report can be viewed offline. Synchronize pending entries and refresh for the latest figures.`}/>
   {showing.warnings.map(w=><Banner key={w} tone="warning" text={w}/>)}
   <Card><Text style={type.heading}>Trading summary</Text><Line label={`${showing.summary.deliveries} purchase deliveries · ${kg(showing.summary.purchasedKg)}`} value={ugx(showing.summary.purchaseCostUgx)}/><Line label={`${showing.summary.sales} sales · ${kg(showing.summary.soldKg)}`} value={ugx(showing.summary.revenueUgx)}/><Line label="Operating profit estimate" value={ugx(showing.summary.operatingProfitUgx)}/><Text style={type.small}>{showing.summary.marginPercent.toFixed(1)}% operating margin</Text></Card>
   <SectionHeader title="Profit breakdown"/><Card>{[['Sales value',showing.summary.revenueUgx],['Cost of material sold',showing.summary.costOfGoodsUgx],['Gross profit',showing.summary.grossProfitUgx],['Selling costs',showing.summary.sellingCostsUgx],['Operating expenses',showing.summary.operatingExpensesUgx],['Stock losses / outward corrections',showing.summary.stockLossUgx],['Operating profit estimate',showing.summary.operatingProfitUgx]].map(([label,value])=><Line key={String(label)} label={String(label)} value={ugx(Number(value))}/>)}</Card>
   <SectionHeader title="Payments and outstanding balances"/><Card>{[['Buyer receipts in period',showing.summary.buyerReceiptsUgx],['Supplier payments in period',showing.summary.supplierPaymentsUgx],['Buyers owe at period end',showing.summary.receivablesUgx],['Suppliers owed at period end',showing.summary.payablesUgx],['Draft expenses (excluded)',showing.summary.draftExpensesUgx],['Worker advances (excluded)',showing.summary.workerAdvancesUgx]].map(([label,value])=><Line key={String(label)} label={String(label)} value={ugx(Number(value))}/>)}<Text style={type.small}>Balances include earlier transactions through the period end. Payments use their actual payment dates.</Text></Card>
   <SectionHeader title={`Current stock · ${kg(showing.summary.stockKg)}`}/><Card>{showing.stock.map(d=><Line key={d.material} label={`${d.material} · ${kg(d.quantityKg)}`} value={ugx(d.valueUgx)}/>)}<Line label="Total stock value" value={ugx(showing.summary.stockValueUgx)}/><Text style={type.small}>Stock at report generation, including movements after the selected period. Historical stock is not reconstructed.</Text></Card>
   <SectionHeader title="Daily performance"/>{!showing.daily.length?<Text style={type.small}>No activity in this period.</Text>:showing.daily.map(d=><Card key={d.date}><Text style={type.label}>{d.date}</Text><Line label={`Purchased · ${kg(d.purchasedKg)}`} value={ugx(d.purchaseCostUgx)}/><Line label={`Sold · ${kg(d.soldKg)}`} value={ugx(d.revenueUgx)}/><Line label="Operating profit estimate" value={ugx(d.operatingProfitUgx)}/></Card>)}
   {(['suppliers','buyers'] as const).map(key=><View key={key} style={{gap:space.sm}}><SectionHeader title={key==='suppliers'?'Suppliers in this period':'Buyers in this period'}/>{showing[key].map(d=><Card key={d.name}><Text style={type.label}>{d.name}</Text><Line label={`${d.transactions} material lines · ${kg(d.quantityKg)}`} value={ugx(d.valueUgx)}/><Line label="Outstanding at period end" value={ugx(d.balanceUgx)}/></Card>)}</View>)}
   <SectionHeader title="Transaction details"/><Chips value={details} onChange={setDetails} options={[{value:'none',label:'Hide details'},{value:'purchases',label:'Purchases'},{value:'sales',label:'Sales'},{value:'expenses',label:'Expenses'}]}/>
   {details==='purchases'?showing.purchases.map(p=><Card key={p.id}><Text style={type.label}>{p.collected_on} · {p.material_type}</Text><Line label={`${p.source_name} · ${kg(Number(p.quantity_kg))}`} value={ugx(p.totalCostUgx)}/><Line label="Outstanding at period end" value={ugx(p.balanceUgx)}/></Card>):null}
   {details==='sales'?showing.sales.map(p=><Card key={p.id}><Text style={type.label}>{p.sold_on} · {p.material_type}</Text><Line label={`${p.buyer_name} · ${kg(Number(p.quantity_kg))}`} value={ugx(p.revenueUgx)}/><Line label="Outstanding at period end" value={ugx(p.balanceUgx)}/></Card>):null}
   {details==='expenses'?showing.expenses.map(p=><Card key={p.id}><Text style={type.label}>{p.expense_date} · {p.description}</Text><Line label={`${p.category.replaceAll('_',' ')} · ${p.status}`} value={ugx(Number(p.amount_ugx))}/></Card>):null}
   <Card><Text style={type.label}>Calculation basis</Text><Text style={type.small}>{showing.basis.profit}</Text></Card>
   <Button title="Share company report" variant="secondary" icon="share-outline" disabled={loading||!matches} onPress={()=>void share()}/>
  </>:null}
 </View>;
}
function Line({label,value}:{label:string;value:string}){return <View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:space.sm,paddingVertical:space.sm}}><Text style={[type.body,{flexGrow:1,flexBasis:'55%'}]}>{label}</Text><Text style={[type.body,{fontWeight:'700'}]}>{value}</Text></View>;}

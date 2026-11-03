import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, radius, space, type, ugx } from "../ui/theme";

type Row=Record<string,unknown>;
const n=(value:unknown)=>Number(value||0);
const t=(value:unknown,fallback="—")=>typeof value==="string"&&value.trim()?value:fallback;
const day=(value:unknown)=>value?new Date(String(value)).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"Date unavailable";

export function MaterialStockSummary({lots,sales=[],sorting=[],adjustments=[]}:{lots:Row[];sales?:Row[];sorting?:Row[];adjustments?:Row[]}){
 const [open,setOpen]=useState("");
 const groups=useMemo(()=>[...lots.reduce((map,lot)=>{const material=t(lot.material_type??lot.materialType,"Material"),key=material.toLowerCase(),current=map.get(key)??{material,available:0,received:0,value:0,lots:[] as Row[]};current.available+=n(lot.available_kg??lot.quantity_kg);current.received+=n(lot.quantity_kg);current.value+=n(lot.available_kg??lot.quantity_kg)*n(lot.unit_purchase_price_ugx);current.lots.push(lot);map.set(key,current);return map;},new Map<string,{material:string;available:number;received:number;value:number;lots:Row[]}>()).values()].filter(group=>group.available>0).sort((a,b)=>b.available-a.available),[lots]);
 return <View style={s.wrap}>
  <View style={s.head}><View><Text style={type.heading}>Final material stock</Text><Text style={type.small}>One balance per material. Tap it to review every movement.</Text></View><Text style={s.total}>{groups.reduce((sum,item)=>sum+item.available,0).toLocaleString("en-GB")} kg</Text></View>
  {groups.map(group=>{const expanded=open===group.material;const materialSales=sales.filter(row=>t(row.material_type,"Material")===group.material),materialSorting=sorting.filter(row=>t(row.input_material_type,"Material")===group.material),materialAdjustments=adjustments.filter(row=>t(row.material_type,"Material")===group.material);return <View key={group.material} style={s.group}>
   <Pressable onPress={()=>setOpen(expanded?"":group.material)} style={s.groupHead}><View style={{flex:1}}><Text style={s.material}>{group.material}</Text><Text style={type.small}>{group.lots.length} active lot{group.lots.length===1?"":"s"} · est. {ugx(group.value)}</Text></View><View style={s.balance}><Text style={s.balanceValue}>{group.available.toLocaleString("en-GB")} kg</Text><Text style={s.link}>{expanded?"Hide":"View history"}</Text></View></Pressable>
   <View style={s.track}><View style={[s.fill,{width:`${group.received?Math.min(100,group.available/group.received*100):0}%`}]} /></View>
   {expanded?<View style={s.history}>
    {group.lots.map((lot,index)=><Movement key={String(lot.id??index)} title={lot.origin==="sorting_output"?"Processing output":"Purchase received"} date={day(lot.collected_on)} detail={t(lot.source_name,"Source not recorded")} amount={`+${n(lot.quantity_kg).toLocaleString("en-GB")} kg`} tone="in" />)}
    {materialSorting.map((row,index)=><Movement key={`sorting-${String(row.id??index)}`} title="Sent to processing" date={day(row.processed_on)} detail={`Output: ${t(row.output_material,"Processed material")}`} amount={`−${n(row.input_kg).toLocaleString("en-GB")} kg`} tone="out" />)}
    {materialSales.map((row,index)=><Movement key={`sale-${String(row.id??index)}`} title={`Sold to ${t(row.buyer_name,"buyer")}`} date={day(row.sold_on)} detail={ugx(n(row.total_ugx))} amount={`−${n(row.quantity_kg).toLocaleString("en-GB")} kg`} tone="out" />)}
    {materialAdjustments.map((row,index)=><Movement key={`adjust-${String(row.id??index)}`} title="Stock correction" date={day(row.adjustment_date)} detail={t(row.reason,"Audit correction")} amount={`${row.adjustment_type==="correction_in"?"+":"−"}${n(row.quantity_kg).toLocaleString("en-GB")} kg`} tone={row.adjustment_type==="correction_in"?"in":"out"} />)}
   </View>:null}
  </View>})}
  {!groups.length?<View style={s.empty}><Text style={type.heading}>No stock available</Text><Text style={type.small}>Purchases and processing outputs will appear here.</Text></View>:null}
 </View>;
}
function Movement({title,date,detail,amount,tone}:{title:string;date:string;detail:string;amount:string;tone:"in"|"out"}){return <View style={s.movement}><View style={{flex:1}}><Text style={s.movementTitle}>{title}</Text><Text style={type.small}>{date} · {detail}</Text></View><Text style={[s.amount,tone==="in"?s.amountIn:s.amountOut]}>{amount}</Text></View>}
const s=StyleSheet.create({wrap:{gap:space.sm,marginBottom:space.lg},head:{flexDirection:"row",alignItems:"flex-start",justifyContent:"space-between",gap:12},total:{fontWeight:"800",fontSize:18,color:color.ink},group:{borderWidth:1,borderColor:color.line,borderRadius:radius.md,backgroundColor:color.surface,overflow:"hidden"},groupHead:{padding:14,flexDirection:"row",alignItems:"center",gap:12},material:{fontSize:16,fontWeight:"800",color:color.ink},balance:{alignItems:"flex-end"},balanceValue:{fontWeight:"800",fontSize:15,color:color.ink},link:{fontSize:11,fontWeight:"700",color:color.action,marginTop:3},track:{height:4,backgroundColor:color.fill},fill:{height:"100%",backgroundColor:color.action},history:{backgroundColor:color.fill,paddingHorizontal:12},movement:{flexDirection:"row",alignItems:"center",gap:12,paddingVertical:11,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:color.line},movementTitle:{fontSize:13,fontWeight:"700",color:color.ink},amount:{fontSize:12,fontWeight:"800"},amountIn:{color:color.success},amountOut:{color:color.danger},empty:{padding:space.lg,alignItems:"center",gap:4,borderWidth:1,borderColor:color.line,borderRadius:radius.md}});

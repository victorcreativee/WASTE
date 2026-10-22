"use client";
import {useEffect,useState} from "react";
import {apiRequest} from "@/lib/api";

type Factory={id:string;name:string;permit_in_force:boolean};

/**
 * Optional "sold to a licensed factory" choice on a recycler's sale. Naming the factory sends the delivery to the
 * factory's expected deliveries and lets KCCA follow the material from recycler to factory.
 */
export function FactoryBuyerSelect({defaultValue,className}:{defaultValue?:string|null;className?:string}){
  const [factories,setFactories]=useState<Factory[]>([]);
  useEffect(()=>{apiRequest<{data:Factory[]}>("/api/waste/factories/directory").then(r=>setFactories(r.data)).catch(()=>setFactories([]))},[]);
  if(!factories.length&&!defaultValue)return null;
  return <label className="text-sm font-semibold">
    Licensed recycling factory <span className="font-normal text-slate-500">(if the buyer is one)</span>
    <select name="buyerOrganizationId" defaultValue={defaultValue||""} className={className}>
      <option value="">Not a licensed factory</option>
      {factories.map(f=><option key={f.id} value={f.id}>{f.name}{f.permit_in_force?"":" — permit not in force"}</option>)}
    </select>
    <span className="mt-1 block text-xs font-normal text-slate-500">The factory confirms what it receives; KCCA sees any difference.</span>
  </label>;
}

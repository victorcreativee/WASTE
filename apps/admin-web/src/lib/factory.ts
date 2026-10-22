"use client";
import {useCallback,useEffect,useState} from "react";
import {apiRequest} from "@/lib/api";

// Shared types, labels and list loading for the recycling factory workspace.

export type Intake={id:string;intake_number:string;source_sale_id:string|null;supplier_organization_id:string|null;supplier_name:string;material_category:string;material_description:string;declared_kg:string|null;received_kg:string;rejected_kg:string;accepted_kg:string;available_kg:string;received_on:string;vehicle_registration:string|null;notes:string|null;status:string;void_reason:string|null;recorded_by_name:string};
export type Batch={id:string;batch_number:string;processed_on:string;product_name:string;input_kg:string;output_kg:string;residue_kg:string;residue_disposal:string|null;notes:string|null;dispatched_kg:string;yield_rate:number|null;recorded_by_name:string;inputs:Array<{intake_id:string;intake_number:string;supplier_name:string;material_category:string;kg:number}>};
export type Dispatch={id:string;dispatch_number:string;batch_id:string|null;batch_number:string|null;product_name:string;quantity_kg:string;buyer_name:string;destination:string|null;dispatched_on:string;recorded_by_name:string};
export type Delivery={sale_id:string;sold_on:string;sold_kg:number;invoice_number:string|null;seller_id:string;seller_name:string;material_type:string;material_category:string;state:"awaiting"|"overdue"};

export const MATERIALS:Array<[string,string]>=[["plastic","Plastic"],["paper","Paper and cardboard"],["metal","Metal"],["glass","Glass"],["organic","Organic"],["textile","Textile"],["other","Other"]];
export const materialLabel=(code:string)=>MATERIALS.find(([key])=>key===code)?.[1]||code;
export const kg=(value:string|number|null|undefined)=>value===null||value===undefined?"—":`${Number(value).toLocaleString("en-GB",{maximumFractionDigits:1})} kg`;
export const day=(iso:string|null)=>iso?new Date(`${iso.slice(0,10)}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"—";
export const todayIso=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};

/** Loads one server page of a list (?page=&pageSize=, added to any query the endpoint already has) and exposes what the Pagination component needs. */
export function useServerList<T>(endpoint:string,initialSize=25){
  const [rows,setRows]=useState<T[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(initialSize);
  const [error,setError]=useState(""),[loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    setLoading(true);
    try{const r=await apiRequest<{data:T[];pagination:{total:number}}>(`${endpoint}${endpoint.includes("?")?"&":"?"}page=${page}&pageSize=${pageSize}`);setRows(r.data);setTotal(r.pagination.total);setError("")}
    catch(e){setError(e instanceof Error?e.message:"Could not load the list")}
    finally{setLoading(false)}
  },[endpoint,page,pageSize]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  return {rows,total,page,pageSize,totalPages:Math.max(1,Math.ceil(total/pageSize)),error,loading,reload:load,setPage,setPageSize:(size:number)=>{setPageSize(size);setPage(1)}};
}

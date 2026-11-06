"use client";
import {useState} from "react";
import {openAuthenticatedFile} from "@/lib/api";

/** Downloads a recycling workbook for a period: the company report unless `report` names another. */
export function ExcelExportButton({from,to,disabled,report="reports/company"}:{from:string;to:string;disabled?:boolean;report?:string}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function download(){
    try{setBusy(true);setError("");await openAuthenticatedFile(`/api/waste/${report}.xlsx?from=${from}&to=${to}`,{download:`${report.split("/").pop()}-${from}-to-${to}.xlsx`})}
    catch(e){setError(e instanceof Error?e.message:"Could not export the report")}finally{setBusy(false)}
  }
  return <><button disabled={disabled||busy} onClick={()=>void download()} className="rounded-lg bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy?"Preparing…":"Export Excel"}</button>{error&&<span role="alert" className="self-center text-sm text-[var(--color-danger)]">{error}</span>}</>;
}

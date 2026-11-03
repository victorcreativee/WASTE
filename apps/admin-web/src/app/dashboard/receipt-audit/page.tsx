"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";
import {day,useServerList} from "@/lib/factory";
import {useHasRole} from "@/lib/session";
import {ChainCheck,Receipt,ReceiptExport,ReceiptOperator,ReceiptSettings,dateTime,kg,previewSerial,smsState} from "@/lib/receipts";

type View="operators"|"receipts"|"exports";
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

export default function ReceiptAuditPage(){
  const canEdit=useHasRole("kcca_admin");
  const [view,setView]=useState<View>("operators"),[operators,setOperators]=useState<ReceiptOperator[]|null>(null),[settings,setSettings]=useState<ReceiptSettings|null>(null);
  const [operator,setOperator]=useState(""),[search,setSearch]=useState(""),[applied,setApplied]=useState("");
  const [checks,setChecks]=useState<Record<string,ChainCheck|"checking">>({});
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[editingFormat,setEditingFormat]=useState(false),[editingCode,setEditingCode]=useState<ReceiptOperator|null>(null);

  const scope=operator?`organizationId=${operator}`:"";
  const receiptQuery=[scope,applied?`search=${encodeURIComponent(applied)}`:""].filter(Boolean).join("&");
  const receipts=useServerList<Receipt>(`/api/waste/receipts${receiptQuery?`?${receiptQuery}`:""}`);
  const exports=useServerList<ReceiptExport>(`/api/waste/receipts/exports${scope?`?${scope}`:""}`);
  const load=useCallback(async()=>{
    try{
      const [ops,config]=await Promise.all([apiRequest<{data:ReceiptOperator[]}>("/api/waste/receipts/city/operators"),apiRequest<{data:ReceiptSettings}>("/api/waste/receipts/settings")]);
      setOperators(ops.data);setSettings(config.data);
    }catch(e){setError(e instanceof Error?e.message:"Could not load receipting")}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);

  async function checkChain(id:string){
    setChecks(c=>({...c,[id]:"checking"}));
    try{const result=(await apiRequest<{data:ChainCheck}>(`/api/waste/receipts/city/operators/${id}/chain-check`)).data;setChecks(c=>({...c,[id]:result}))}
    catch(e){setChecks(c=>{const next={...c};delete next[id];return next});setError(e instanceof Error?e.message:"Could not check the ledger")}
  }
  async function download(e:ReceiptExport,part:"file"|"signature"){
    try{await openAuthenticatedFile(`/api/waste/receipts/exports/${e.id}/download${part==="signature"?"?part=signature":""}`,{download:`receipts-${e.organization_name.replace(/[^A-Za-z0-9]+/g,"-")}-${e.export_date}${part==="signature"?".sig":""}.json`})}
    catch(err){setError(err instanceof Error?err.message:"Could not download the export")}
  }
  function downloadKey(){
    if(!settings)return;const url=URL.createObjectURL(new Blob([settings.signing_public_key],{type:"application/x-pem-file"}));
    const link=document.createElement("a");link.href=url;link.download=`${settings.signing_key_id}.pem`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function saved(message:string){setEditingFormat(false);setEditingCode(null);setNotice(message);await load();}
  const missing=operators?.reduce((sum,o)=>sum+o.missing_exports,0)??0;

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="Regulation" title="Collection receipts" description="Licensed collectors issue a numbered electronic receipt for every household collection. Receipts cannot be changed or deleted; each operator's ledger is hash-chained and filed with KCCA as a signed export every day."/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}
    {settings?.development_key&&<Feedback tone="warning">Exports are signed with the development key. Set RECEIPT_SIGNING_KEY on the server before relying on exports.</Feedback>}

    {settings&&<section className="grid gap-px overflow-hidden rounded-[var(--ui-radius-lg)] border border-slate-200 bg-slate-200 text-sm sm:grid-cols-3">
      <div className="bg-white px-4 py-3"><p className="text-xs font-medium text-slate-500">Serial format</p><p className="mt-1 font-mono text-slate-900">{settings.serial_format}</p>
        <p className="text-xs text-slate-500">e.g. {previewSerial(settings.serial_format,operators?.[0]?.code||"ABC",new Date(),123)}</p>
        {canEdit&&<button onClick={()=>setEditingFormat(true)} className="mt-2 border border-slate-300 px-3 py-1.5 text-xs text-slate-700">Change</button>}</div>
      <div className="bg-white px-4 py-3"><p className="text-xs font-medium text-slate-500">Operators receipting</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{operators?.length??"—"}</p>
        <p className={`text-xs ${missing?"text-[var(--color-danger)]":"text-slate-500"}`}>{missing?`${missing} daily export${missing===1?"":"s"} not filed yet`:"Every finished day is filed"}</p></div>
      <div className="bg-white px-4 py-3"><p className="text-xs font-medium text-slate-500">Export signing key</p><p className="mt-1 break-all font-mono text-xs text-slate-900">{settings.signing_key_id}</p>
        <button onClick={downloadKey} className="mt-2 border border-slate-300 px-3 py-1.5 text-xs text-slate-700">Download public key</button></div>
    </section>}

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="radiogroup" aria-label="Show" className="inline-flex overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">
        {([["operators","Operators"],["receipts","Receipts"],["exports","Daily exports"]] as const).map(([value,label],i)=><button key={value} role="radio" aria-checked={view===value} onClick={()=>setView(value)} className={`min-h-0 rounded-none px-3 py-1.5 ${i?"border-l border-slate-300":""} ${view===value?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{label}</button>)}
      </div>
      {view!=="operators"&&<select aria-label="Operator" value={operator} onChange={e=>{setOperator(e.target.value);receipts.setPage(1);exports.setPage(1)}} className="border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">All operators</option>{operators?.map(o=><option key={o.organization_id} value={o.organization_id}>{o.organization_name}</option>)}</select>}
    </div>

    {view==="operators"?(operators?.length?<div className="table-wrap"><table className="w-full min-w-[960px] text-left">
      <thead><tr><th>Operator</th><th>Code</th><th className="text-right">Receipts</th><th className="text-right">Last 7 days</th><th className="text-right">Voids (30 days)</th><th>Exports</th><th>Ledger</th></tr></thead>
      <tbody>{operators.map(o=>{const check=checks[o.organization_id];return <tr key={o.organization_id}>
        <td><p className="table-primary">{o.organization_name}</p><p className="table-secondary">Receipting since {day(o.first_issued_on)}</p></td>
        <td><span className="font-mono">{o.code}</span>{canEdit&&<button onClick={()=>setEditingCode(o)} className="ml-2 text-xs text-slate-500 underline">Change</button>}</td>
        <td className="text-right tabular-nums">{Number(o.total_receipts).toLocaleString("en-GB")}</td>
        <td className="text-right tabular-nums">{o.receipts_7d.toLocaleString("en-GB")}</td>
        <td className={`text-right tabular-nums ${o.voids_30d?"font-medium text-slate-900":""}`}>{o.voids_30d}</td>
        <td>{o.missing_exports?<span className="status status-failed normal-case">{o.missing_exports} missing</span>:<span className="status status-active normal-case">Up to date</span>}<p className="table-secondary">Last {day(o.last_export_date)}</p></td>
        <td>{!check?<button onClick={()=>void checkChain(o.organization_id)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Check</button>
          :check==="checking"?<span className="text-xs text-slate-500">Checking…</span>
          :check.intact?<span className="status status-active normal-case">Intact · {check.checked.toLocaleString("en-GB")}</span>
          :<span className="status status-failed normal-case">Altered at {check.first_broken_serial}</span>}</td>
      </tr>})}</tbody>
    </table></div>:operators&&<EmptyState title="No operator has issued a receipt yet" description="Operators appear here once their drivers complete a household collection."/>)
    :view==="receipts"?<section>
      <form onSubmit={e=>{e.preventDefault();setApplied(search);receipts.setPage(1)}} className="mb-3 flex gap-2 text-sm"><input value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search receipts" placeholder="Receipt number, household or phone" className="w-72 border border-slate-300 px-3 py-2"/><button className="bg-slate-900 px-4 py-2 text-white">Search</button></form>
      {receipts.error&&<Feedback tone="error">{receipts.error}</Feedback>}
      {receipts.rows.length?<div className="table-wrap"><table className="w-full min-w-[960px] text-left">
        <thead><tr><th>Receipt</th><th>Operator</th><th>Collected</th><th>Household</th><th className="text-right">Weight</th><th>Delivery</th></tr></thead>
        <tbody>{receipts.rows.map(r=>{const sms=smsState(r);return <tr key={r.id}>
          <td><a href={`/r/${r.serial_number}`} target="_blank" rel="noreferrer" className="table-primary font-mono hover:underline">{r.serial_number}</a>{r.voided_at&&<p className="table-secondary text-[var(--color-danger)]">Voided: {r.void_reason}</p>}</td>
          <td>{r.company_name}<p className="table-secondary">{r.truck_plate||""}</p></td>
          <td>{dateTime(r.collected_at)}<p className="table-secondary">{r.zone_name||""}</p></td>
          <td><p className="table-primary">{r.customer_name}</p><p className="table-secondary">{r.location_label} · {r.address}</p></td>
          <td className="text-right tabular-nums">{kg(r.collected_weight_kg)}</td>
          <td><span className={sms.className}>{sms.label}</span></td>
        </tr>})}</tbody>
      </table></div>:!receipts.loading&&<EmptyState title="No receipts match"/>}
      <Pagination page={receipts.page} pageSize={receipts.pageSize} total={receipts.total} totalPages={receipts.totalPages} onPage={receipts.setPage} onPageSize={receipts.setPageSize}/>
    </section>:<section>
      <p className="mb-3 text-sm text-slate-600">Each file holds one operator&rsquo;s receipts and voids for one Kampala day. Check a file with its signature and the public key above; any change to the file makes the check fail.</p>
      {exports.error&&<Feedback tone="error">{exports.error}</Feedback>}
      {exports.rows.length?<div className="table-wrap"><table className="w-full min-w-[900px] text-left">
        <thead><tr><th>Day</th><th>Operator</th><th className="text-right">Receipts</th><th className="text-right">Voids</th><th>SHA-256</th><th/></tr></thead>
        <tbody>{exports.rows.map(e=><tr key={e.id}>
          <td className="table-primary">{day(e.export_date)}</td><td>{e.organization_name}</td>
          <td className="text-right tabular-nums">{e.receipt_count}</td><td className="text-right tabular-nums">{e.void_count}</td>
          <td className="font-mono text-xs" title={e.content_sha256}>{e.content_sha256.slice(0,16)}…</td>
          <td className="whitespace-nowrap text-right"><button onClick={()=>void download(e,"file")} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Download</button> <button onClick={()=>void download(e,"signature")} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Signature</button></td>
        </tr>)}</tbody>
      </table></div>:!exports.loading&&<EmptyState title="No exports yet"/>}
      <Pagination page={exports.page} pageSize={exports.pageSize} total={exports.total} totalPages={exports.totalPages} onPage={exports.setPage} onPageSize={exports.setPageSize}/>
    </section>}

    {settings&&<FormatDialog key={settings.serial_format} open={editingFormat} current={settings.serial_format} sampleCode={operators?.[0]?.code||"ABC"} onClose={()=>setEditingFormat(false)} onDone={saved}/>}
    <CodeDialog operator={editingCode} onClose={()=>setEditingCode(null)} onDone={saved}/>
  </div></AppShell>;
}

function FormatDialog({open,current,sampleCode,onClose,onDone}:{open:boolean;current:string;sampleCode:string;onClose:()=>void;onDone:(message:string)=>void}){
  const [format,setFormat]=useState(current),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError("");
    try{await apiRequest("/api/waste/receipts/settings",{method:"PUT",body:JSON.stringify({serialFormat:format})});onDone("Serial format saved. It applies to receipts issued from now on.")}
    catch(err){setError(err instanceof Error?err.message:"Could not save the format")}finally{setBusy(false)}
  }
  return <Modal open={open} title="Receipt serial format" description="Applies to every operator from the next receipt. Receipts already issued keep their numbers." onClose={onClose}>
    <form onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <label className="font-medium text-slate-700">Format<input value={format} onChange={e=>setFormat(e.target.value)} required maxLength={60} spellCheck={false} className={`${field} font-mono`}/></label>
      <p className="text-slate-600">Next receipt would read <span className="font-mono text-slate-900">{previewSerial(format,sampleCode,new Date(),1)}</span></p>
      <p className="text-xs leading-5 text-slate-500">{"{ORG}"} operator code · {"{YYYY}"} or {"{YY}"} year · {"{MM}"} month · {"{DD}"} day · {"{SEQ4}"} to {"{SEQ9}"} the operator&rsquo;s number for the year, padded to that many digits. The operator code, the year and one sequence are required.</p>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2 text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2 font-semibold text-white disabled:opacity-60">{busy?"Saving…":"Save format"}</button></div>
    </form>
  </Modal>;
}

function CodeDialog({operator,onClose,onDone}:{operator:ReceiptOperator|null;onClose:()=>void;onDone:(message:string)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!operator)return;setBusy(true);setError("");
    try{await apiRequest(`/api/waste/receipts/city/operators/${operator.organization_id}/code`,{method:"PUT",body:JSON.stringify({code:new FormData(e.currentTarget).get("code")})});onDone(`Receipt code for ${operator.organization_name} updated.`)}
    catch(err){setError(err instanceof Error?err.message:"Could not save the code")}finally{setBusy(false)}
  }
  return <Modal open={Boolean(operator)} title={`Receipt code for ${operator?.organization_name||""}`} description="The {ORG} part of this operator's serial numbers. Receipts already issued keep their numbers." onClose={onClose}>
    <form key={operator?.organization_id} onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <label className="font-medium text-slate-700">Code<input name="code" defaultValue={operator?.code} required pattern="[A-Za-z0-9]{2,8}" maxLength={8} className={`${field} font-mono uppercase`}/></label>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2 text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2 font-semibold text-white disabled:opacity-60">{busy?"Saving…":"Save code"}</button></div>
    </form>
  </Modal>;
}

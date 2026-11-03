"use client";
import {useCallback,useEffect,useState,useSyncExternalStore} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {API_BASE_URL,apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {dateTime} from "@/lib/receipts";

type Key={id:string;organization_id:string|null;organization_name:string|null;name:string;holder_name:string|null;contact_email:string|null;purpose:string|null;
  key_prefix:string;scopes:string[];rate_limit_per_minute:number;expires_at:string;created_by_name:string|null;created_at:string;last_used_at:string|null;
  last_used_ip:string|null;revoked_at:string|null;revoked_by_name:string|null;revoked_reason:string|null;requests_30d:number};
type Usage={day:string;endpoint:string;requests:number;refused:number};

const SCOPES:[string,string,string][]=[
  ["operators:read","Operators","Licensed collection companies and their permits"],
  ["tonnage:read","Tonnage","Weighed tonnage per day and facility"],
  ["certificates:read","Load certificates","Certificates for weighed loads, with composition"],
  ["carbon:read","Carbon baseline","Monthly tonnes landfilled and diverted, methane potential"],
  ["receipts:read","Collection receipts","Your receipts for a day; household names, no phone numbers"],
];
const SCOPE_NAME=Object.fromEntries(SCOPES.map(([code,name])=>[code,name]));
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const noSubscribe=()=>()=>undefined;

export default function ApiKeysPage(){
  const kcca=useHasRole("kcca_admin"),systemAdmin=useHasRole("system_admin"),companyAdmin=useHasRole("company_admin");
  const regulator=kcca||systemAdmin,canCreate=kcca||companyAdmin;
  const base=useSyncExternalStore(noSubscribe,()=>`${API_BASE_URL||window.location.origin}/api/v1`,()=>"/api/v1");
  const [keys,setKeys]=useState<Key[]|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [creating,setCreating]=useState(false),[issued,setIssued]=useState<{key:string;name:string}|null>(null);
  const [revoking,setRevoking]=useState<Key|null>(null),[usage,setUsage]=useState<{key:Key;rows:Usage[]}|null>(null);
  const load=useCallback(async()=>{
    try{setKeys((await apiRequest<{data:Key[]}>("/api/waste/api-keys")).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load the API keys")}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  async function showUsage(key:Key){
    try{setUsage({key,rows:(await apiRequest<{data:Usage[]}>(`/api/waste/api-keys/${key.id}/usage`)).data})}
    catch(e){setError(e instanceof Error?e.message:"Could not load the usage")}
  }
  const active=keys?.filter(k=>!k.revoked_at)??[],expired=(k:Key)=>new Date(k.expires_at)<new Date();

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow={regulator?"Regulation":"Administration"} title="API keys"
      description={regulator?"Partners such as NEMA, development finance institutions and carbon verifiers read KCCA-verified data through the open API with a key KCCA issues. Keys are read-only and city-wide; household receipts are never available to partners.":"Connect your own systems (accounting, reporting, your website) to your company's data in KWMS. Keys are read-only and see only your company."}
      action={canCreate?<button onClick={()=>setCreating(true)} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white">{kcca?"Issue partner key":"Create key"}</button>:undefined}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    <section className="rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white p-4 text-sm">
      <p className="font-semibold text-slate-900">Using a key</p>
      <p className="mt-1 text-slate-600">Send the key in the <code className="font-mono text-[13px]">Authorization</code> header. Every endpoint, field and limit is described in the <a href={`${base}/openapi.json`} target="_blank" rel="noreferrer" className="text-[var(--color-action)] underline-offset-2 hover:underline">OpenAPI document</a>.</p>
      <pre className="mt-3 overflow-x-auto bg-slate-50 px-3 py-2.5 font-mono text-[12.5px] leading-5 text-slate-800">{`curl -H "Authorization: Bearer kwms_..." \\\n  "${base}/tonnage?from=2026-10-01&to=2026-10-31"`}</pre>
    </section>

    <section>
      <h2 className="mb-3 text-lg font-semibold text-slate-950">{regulator?"All keys":"Your keys"} <span className="text-sm font-normal text-slate-500">· {active.length} active</span></h2>
      {keys===null?<p className="py-6 text-sm text-slate-500">Loading keys…</p>:keys.length?<div className="table-wrap"><table className="w-full min-w-[1080px] text-left">
        <thead><tr><th>Key</th>{regulator&&<th>Holder</th>}<th>Data</th><th className="text-right">Limit</th><th>Last used</th><th className="text-right">Requests, 30 days</th><th>Expires</th><th/></tr></thead>
        <tbody>{keys.map(k=><tr key={k.id} className={k.revoked_at||expired(k)?"text-slate-400":""}>
          <td><p className="table-primary">{k.name}</p><p className="table-secondary font-mono">kwms_{k.key_prefix}_…</p></td>
          {regulator&&<td>{k.organization_id?<><p>{k.organization_name}</p><p className="table-secondary">Company key</p></>:<><p>{k.holder_name}</p><p className="table-secondary">Partner · {k.contact_email}</p></>}</td>}
          <td className="max-w-64 text-sm">{k.scopes.map(s=>SCOPE_NAME[s]??s).join(", ")}</td>
          <td className="text-right tabular-nums">{k.rate_limit_per_minute}/min</td>
          <td>{k.last_used_at?<><p>{dateTime(k.last_used_at)}</p><p className="table-secondary">{k.last_used_ip}</p></>:"Never"}</td>
          <td className="text-right tabular-nums">{k.requests_30d.toLocaleString("en-GB")}</td>
          <td>{k.revoked_at?<><p className="text-[var(--color-danger)]">Revoked {dateTime(k.revoked_at)}</p><p className="table-secondary">{k.revoked_by_name}: {k.revoked_reason}</p></>
            :<p className={expired(k)?"text-[var(--color-danger)]":""}>{expired(k)?"Expired ":""}{new Date(k.expires_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</p>}</td>
          <td className="text-right"><div className="flex justify-end gap-2">
            <button onClick={()=>void showUsage(k)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Usage</button>
            {!k.revoked_at&&<button onClick={()=>setRevoking(k)} className="border border-red-300 px-3 py-2 text-xs font-semibold text-red-700">Revoke</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>:<EmptyState title="No keys yet" description={canCreate?"Create a key for each system that should read data, so each one can be revoked on its own.":"Companies and KCCA issue keys; they will be listed here."}/>}
    </section>

    {canCreate&&<CreateDialog open={creating} partner={kcca} onClose={()=>setCreating(false)} onCreated={async(key,name)=>{setCreating(false);setIssued({key,name});setError("");await load()}}/>}
    <Modal open={Boolean(issued)} title="Copy your key now" description="This is the only time the key is shown. KWMS keeps only a fingerprint of it; if it is lost, revoke it and create another." onClose={()=>setIssued(null)}>
      {issued&&<div className="grid gap-3 text-sm">
        <p className="font-medium text-slate-900">{issued.name}</p>
        <code className="block break-all border border-slate-300 bg-slate-50 px-3 py-2.5 font-mono text-[13px]">{issued.key}</code>
        <div className="flex gap-2">
          <button onClick={()=>void navigator.clipboard?.writeText(issued.key).then(()=>setNotice("Key copied. Store it in the other system's secret settings."))} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white">Copy key</button>
          <button onClick={()=>setIssued(null)} className="border border-slate-300 px-4 py-2.5 text-slate-700">I have stored it</button>
        </div>
      </div>}
    </Modal>
    <RevokeDialog keyToRevoke={revoking} onClose={()=>setRevoking(null)} onDone={async message=>{setRevoking(null);setNotice(message);setError("");await load()}}/>
    <Modal open={Boolean(usage)} title={usage?`Usage · ${usage.key.name}`:""} description="Requests per day and endpoint over the last 30 days. Refused requests were over the limit, missing a scope or invalid." onClose={()=>setUsage(null)}>
      {usage&&(usage.rows.length?<div className="table-wrap"><table className="w-full text-left text-sm"><thead><tr><th>Day</th><th>Endpoint</th><th className="text-right">Requests</th><th className="text-right">Refused</th></tr></thead>
        <tbody>{usage.rows.map(u=><tr key={`${u.day}${u.endpoint}`}><td>{u.day}</td><td className="font-mono text-[12.5px]">{u.endpoint}</td><td className="text-right tabular-nums">{u.requests}</td>
          <td className={`text-right tabular-nums ${u.refused?"text-[var(--color-warning)]":""}`}>{u.refused}</td></tr>)}</tbody></table></div>
        :<p className="text-sm text-slate-600">No requests in the last 30 days.</p>)}
    </Modal>
  </div></AppShell>;
}

function CreateDialog({open,partner,onClose,onCreated}:{open:boolean;partner:boolean;onClose:()=>void;onCreated:(key:string,name:string)=>Promise<void>}){
  const scopes=SCOPES.filter(([code])=>!partner||code!=="receipts:read");
  const [error,setError]=useState(""),[saving,setSaving]=useState(false);
  async function submit(form:FormData){
    setSaving(true);setError("");
    const body={name:form.get("name"),scopes:form.getAll("scopes"),expiresInDays:Number(form.get("expiresInDays")),
      ...(partner?{holderName:form.get("holderName"),contactEmail:form.get("contactEmail"),purpose:form.get("purpose"),rateLimitPerMinute:Number(form.get("rateLimitPerMinute"))}:{})};
    try{const r=await apiRequest<{data:{key:string;name:string}}>("/api/waste/api-keys",{method:"POST",body:JSON.stringify(body)});await onCreated(r.data.key,r.data.name)}
    catch(e){setError(e instanceof Error?e.message:"Could not create the key")}finally{setSaving(false)}
  }
  return <Modal open={open} title={partner?"Issue a partner key":"Create an API key"} description={partner?"The partner reads city-wide data with this key. Record who holds it and why, so the decision can be reviewed later.":"Create one key per system, named after it, so each can be revoked on its own."} onClose={()=>!saving&&onClose()}>
    <form key={String(open)} onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget))}} className="grid gap-4 text-sm">
      <label className="font-medium">Name<input name="name" required minLength={3} maxLength={100} className={field} placeholder={partner?"NEMA environmental reporting":"Accounting sync"}/></label>
      {partner&&<>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="font-medium">Partner<input name="holderName" required minLength={2} maxLength={150} className={field} placeholder="National Environment Management Authority"/></label>
          <label className="font-medium">Contact email<input name="contactEmail" type="email" required maxLength={200} className={field}/></label>
        </div>
        <label className="font-medium">What the data is for<textarea name="purpose" required minLength={10} maxLength={500} className={`${field} min-h-16`}/></label>
      </>}
      <fieldset><legend className="font-medium">Data the key can read</legend>
        <div className="mt-2 grid gap-2">{scopes.map(([code,name,text])=><label key={code} className="flex items-start gap-2.5 border border-slate-200 px-3 py-2">
          <input type="checkbox" name="scopes" value={code} defaultChecked={code!=="receipts:read"} className="mt-0.5"/><span><span className="font-medium text-slate-900">{name}</span><span className="block text-xs text-slate-500">{text}</span></span></label>)}</div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="font-medium">Expires after<select name="expiresInDays" defaultValue="365" className={field}><option value="90">90 days</option><option value="180">6 months</option><option value="365">1 year</option><option value="730">2 years</option></select></label>
        {partner&&<label className="font-medium">Requests a minute<input name="rateLimitPerMinute" type="number" required min={1} max={600} defaultValue={60} className={field}/></label>}
      </div>
      {error&&<p className="text-[var(--color-danger)]">{error}</p>}
      <button disabled={saving} className="bg-[var(--color-action)] px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?"Creating…":"Create key"}</button>
    </form>
  </Modal>;
}

function RevokeDialog({keyToRevoke,onClose,onDone}:{keyToRevoke:Key|null;onClose:()=>void;onDone:(m:string)=>Promise<void>}){
  const [error,setError]=useState(""),[saving,setSaving]=useState(false);
  async function submit(reason:string){
    if(!keyToRevoke)return;setSaving(true);setError("");
    try{await onDone((await apiRequest<{message:string}>(`/api/waste/api-keys/${keyToRevoke.id}/revoke`,{method:"POST",body:JSON.stringify({reason})})).message)}
    catch(e){setError(e instanceof Error?e.message:"Could not revoke the key")}finally{setSaving(false)}
  }
  return <Modal open={Boolean(keyToRevoke)} title="Revoke key" description={keyToRevoke?`${keyToRevoke.name} · kwms_${keyToRevoke.key_prefix}_… Requests with it are refused at once. This cannot be undone.`:""} onClose={()=>!saving&&onClose()}>
    <form key={keyToRevoke?.id} onSubmit={e=>{e.preventDefault();void submit(String(new FormData(e.currentTarget).get("reason")))}} className="grid gap-4 text-sm">
      <label className="font-medium">Reason<input name="reason" required minLength={5} maxLength={300} className={field} placeholder="Key rotated, system retired, key exposed…"/></label>
      {error&&<p className="text-[var(--color-danger)]">{error}</p>}
      <button disabled={saving} className="bg-red-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?"Revoking…":"Revoke key"}</button>
    </form>
  </Modal>;
}

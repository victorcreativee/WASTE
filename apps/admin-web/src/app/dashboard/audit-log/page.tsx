"use client";
import {useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {apiRequest} from "@/lib/api";
import {useServerList} from "@/lib/factory";
import {useHasRole} from "@/lib/session";
import {dateTime} from "@/lib/receipts";

type Entry={id:string;occurred_at:string;organization_id:string|null;organization_name:string|null;actor_id:string|null;actor_name:string|null;actor_email:string|null;
  actor_roles:string|null;actor_scope:string|null;ip:string|null;request_id:string|null;request_path:string|null;source:string|null;db_user:string|null;
  table_name:string;record_id:string|null;action:"insert"|"update"|"delete";changed_fields:string[]|null;
  before_state?:Record<string,unknown>|null;after_state?:Record<string,unknown>|null};
type Filters={tables:string[];organizations:{id:string;name:string}[]};
type Isolation={database_role:string;enforced:boolean;scope:string|null;log:{entries:number;since:string|null;direct_changes_30_days:number};
  tables:{table_name:string;isolated:boolean;forced:boolean;policies:number;audited:boolean}[]};

const RECORDS:Record<string,string>={organizations:"Organization",users:"User account",user_roles:"User role",organization_memberships:"Staff membership",
  organization_membership_roles:"Staff role",organization_roles:"Role template",organization_role_permissions:"Role permission",
  customer_service_relationships:"Customer link",customer_service_locations:"Service location",customer_contracts:"Contract",customer_subscriptions:"Subscription",
  service_plans:"Service package",customer_invoices:"Bill",customer_payments:"Payment",organization_payment_accounts:"Mobile money account",
  kcca_tariff_bands:"Tariff band",kcca_tariff_rates:"Tariff rate",receipt_settings:"Receipt format",receipt_series:"Receipt series",collection_receipt_voids:"Receipt void",
  organization_permit_applications:"Permit",organization_division_authorizations:"Division authorization",penalty_notices:"Penalty notice",
  collector_compliance_cases:"Compliance case",regulatory_returns:"Monthly return",waste_trucks:"Truck",drivers:"Driver",weighbridge_transactions:"Weighbridge ticket",
  organization_expenses:"Expense",supplier_payments:"Supplier payment",payroll_periods:"Payroll period",payroll_lines:"Payroll line",
  recycling_material_sales:"Recycling sale",recycling_purchase_payments:"Recycling purchase payment",recycling_sale_payments:"Recycling sale payment",
  recycling_cash_movements:"Recycling cash movement",recycling_stock_adjustments:"Stock adjustment",organization_subscriptions:"Platform subscription",
  subscription_invoices:"Platform invoice",organization_package_feature_overrides:"Package feature",organization_finance_settings:"Finance settings",truck_documents:"Truck document"};
const recordLabel=(t:string)=>RECORDS[t]??t.replace(/_/g," ").replace(/^./,c=>c.toUpperCase());
const ACTIONS={insert:"Created",update:"Changed",delete:"Deleted"} as const;
const fieldLabel=(f:string)=>f.replace(/_/g," ");
const show=(v:unknown)=>v===null||v===undefined?"—":typeof v==="object"?JSON.stringify(v):String(v);

export default function AuditLogPage(){
  const kcca=useHasRole("kcca_admin"),systemAdmin=useHasRole("system_admin"),regulator=kcca||systemAdmin;
  const blank={from:"",to:"",table:"",action:"",origin:"",organizationId:"",search:""};
  const [filters,setFilters]=useState(blank),[draft,setDraft]=useState(blank);
  const [options,setOptions]=useState<Filters>({tables:[],organizations:[]}),[isolation,setIsolation]=useState<Isolation|null>(null);
  const [open,setOpen]=useState<Entry|null>(null),[showTables,setShowTables]=useState(false),[error,setError]=useState("");
  const query=new URLSearchParams(Object.entries(filters).filter(([,v])=>v)).toString();
  const entries=useServerList<Entry>(`/api/waste/audit${query?`?${query}`:""}`,50);

  useEffect(()=>{
    apiRequest<{data:Filters}>("/api/waste/audit/filters").then(r=>setOptions(r.data)).catch(()=>undefined);
    if(regulator)apiRequest<{data:Isolation}>("/api/waste/audit/isolation").then(r=>setIsolation(r.data)).catch(e=>setError(e instanceof Error?e.message:"Could not check isolation"));
  },[regulator]);

  async function view(e:Entry){
    try{setOpen((await apiRequest<{data:Entry}>(`/api/waste/audit/${e.id}`)).data)}
    catch(err){setError(err instanceof Error?err.message:"Could not open the entry")}
  }
  const unisolated=isolation?.tables.filter(t=>!t.isolated)??[];

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow={regulator?"Regulation":"Administration"} title="Audit log"
      description={regulator?"Every change to operator, customer, billing and regulatory records across all operators: who made it, from which IP address, and the record before and after. The log is written by the database itself and cannot be edited or deleted."
        :"Every change to your company's customers, packages, bills, payments, staff and fleet records: who made it, from which IP address, and the record before and after. The log cannot be edited or deleted, and KCCA can read it."}/>
    {error&&<Feedback tone="error">{error}</Feedback>}

    {isolation&&<section className="rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white">
      <div className="grid sm:grid-cols-3">
        <div className="px-4 py-3"><p className="text-xs font-medium text-slate-500">Operator data isolation</p>
          <p className={`mt-1 text-lg font-semibold ${isolation.enforced?"text-slate-900":"text-[var(--color-danger)]"}`}>{isolation.enforced?"Enforced by the database":"Not enforced"}</p>
          <p className="text-xs text-slate-500">{isolation.enforced?`Services run as ${isolation.database_role}; each company sees only its own rows`:`Services run as ${isolation.database_role}, which bypasses isolation. Check DB_APP_ROLE.`}</p></div>
        <div className="border-t border-slate-200 px-4 py-3 sm:border-l sm:border-t-0"><p className="text-xs font-medium text-slate-500">Entries recorded</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{isolation.log.entries.toLocaleString("en-GB")}</p>
          <p className="text-xs text-slate-500">{isolation.log.since?`since ${dateTime(isolation.log.since)}`:"none yet"}</p></div>
        <div className="border-t border-slate-200 px-4 py-3 sm:border-l sm:border-t-0"><p className="text-xs font-medium text-slate-500">Changed outside the system, last 30 days</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${isolation.log.direct_changes_30_days?"text-[var(--color-warning)]":"text-slate-900"}`}>{isolation.log.direct_changes_30_days.toLocaleString("en-GB")}</p>
          <p className="text-xs text-slate-500">made directly in the database, not through the app</p></div>
      </div>
      <div className="border-t border-slate-200 px-4 py-2 text-sm">
        <button onClick={()=>setShowTables(!showTables)} className="min-h-0 px-0 py-1 text-[var(--color-action)]">{showTables?"Hide tables":`${isolation.tables.length-unisolated.length} of ${isolation.tables.length} operator tables isolated · show tables`}</button>
        {showTables&&<div className="table-wrap mt-2 mb-2"><table className="w-full min-w-[560px] text-left text-sm">
          <thead><tr><th>Table</th><th>Isolation</th><th>Audited</th></tr></thead>
          <tbody>{isolation.tables.map(t=><tr key={t.table_name}><td className="font-mono text-xs">{t.table_name}</td>
            <td>{t.isolated?(t.forced?"Each company sees its own":"Enabled"):<span className="text-slate-500">Shared by design</span>}</td><td>{t.audited?"Yes":"—"}</td></tr>)}</tbody>
        </table></div>}
      </div>
    </section>}

    <section>
      <form onSubmit={e=>{e.preventDefault();setFilters(draft);entries.setPage(1)}} className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="text-xs font-medium text-slate-600">Search<input value={draft.search} onChange={e=>setDraft({...draft,search:e.target.value})} placeholder="Person, email, IP, request id" className="mt-1 block w-60 border border-slate-300 px-3 py-2"/></label>
        <label className="text-xs font-medium text-slate-600">Record<select value={draft.table} onChange={e=>setDraft({...draft,table:e.target.value})} className="mt-1 block border border-slate-300 bg-white px-3 py-2"><option value="">All</option>{options.tables.map(t=><option key={t} value={t}>{recordLabel(t)}</option>)}</select></label>
        <label className="text-xs font-medium text-slate-600">Change<select value={draft.action} onChange={e=>setDraft({...draft,action:e.target.value})} className="mt-1 block border border-slate-300 bg-white px-3 py-2"><option value="">All</option><option value="insert">Created</option><option value="update">Changed</option><option value="delete">Deleted</option></select></label>
        <label className="text-xs font-medium text-slate-600">Made<select value={draft.origin} onChange={e=>setDraft({...draft,origin:e.target.value})} className="mt-1 block border border-slate-300 bg-white px-3 py-2"><option value="">Anywhere</option><option value="app">Through the system</option><option value="direct">Directly in the database</option></select></label>
        {regulator&&<label className="text-xs font-medium text-slate-600">Organization<select value={draft.organizationId} onChange={e=>setDraft({...draft,organizationId:e.target.value})} className="mt-1 block max-w-56 border border-slate-300 bg-white px-3 py-2"><option value="">All</option>{options.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
        <label className="text-xs font-medium text-slate-600">From<input type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})} className="mt-1 block border border-slate-300 px-3 py-2"/></label>
        <label className="text-xs font-medium text-slate-600">To<input type="date" value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})} className="mt-1 block border border-slate-300 px-3 py-2"/></label>
        <button className="bg-slate-900 px-4 py-2 text-white">Show</button>
        {query&&<button type="button" onClick={()=>{setDraft(blank);setFilters(blank);entries.setPage(1)}} className="border border-slate-300 bg-white px-3 py-2 text-slate-700">Clear</button>}
      </form>
      {entries.error&&<Feedback tone="error">{entries.error}</Feedback>}
      {entries.rows.length?<div className="table-wrap"><table className="w-full min-w-[980px] text-left">
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Fields</th>{regulator&&<th>Organization</th>}<th/></tr></thead>
        <tbody>{entries.rows.map(e=><tr key={e.id}>
          <td className="whitespace-nowrap">{dateTime(e.occurred_at)}</td>
          <td>{e.actor_scope?<><p className="table-primary">{e.actor_name??(e.actor_id?"Unknown user":e.actor_scope==="system"?"System (scheduled work)":"Not signed in")}</p>
            <p className="table-secondary">{[e.actor_roles?.replace(/_/g," "),e.ip].filter(Boolean).join(" · ")}</p></>
            :<><p className="table-primary text-[var(--color-warning)]">Directly in the database</p><p className="table-secondary">login {e.db_user}{e.source?` · ${e.source}`:""}</p></>}</td>
          <td><p className="table-primary">{ACTIONS[e.action]} {recordLabel(e.table_name).toLowerCase()}</p><p className="table-secondary font-mono">{e.record_id?.slice(0,8)}</p></td>
          <td className="max-w-72 text-sm text-slate-600">{e.action==="update"?(e.changed_fields??[]).map(fieldLabel).join(", "):"—"}</td>
          {regulator&&<td className="text-sm">{e.organization_name??"—"}</td>}
          <td className="text-right"><button onClick={()=>void view(e)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">View</button></td>
        </tr>)}</tbody>
      </table></div>:!entries.loading&&<EmptyState title={query?"No entries match":"No changes recorded yet"} description={query?undefined:"Changes appear here as soon as they are saved."}/>}
      <Pagination page={entries.page} pageSize={entries.pageSize} total={entries.total} totalPages={entries.totalPages} onPage={entries.setPage} onPageSize={entries.setPageSize}/>
    </section>

    <EntryDialog entry={open} onClose={()=>setOpen(null)}/>
  </div></AppShell>;
}

function EntryDialog({entry,onClose}:{entry:Entry|null;onClose:()=>void}){
  const before=entry?.before_state??{},after=entry?.after_state??{};
  const fields=entry?.action==="update"?entry.changed_fields??[]:Object.keys(entry?.action==="delete"?before:after);
  return <Modal open={Boolean(entry)} title={entry?`${ACTIONS[entry.action]} ${recordLabel(entry.table_name).toLowerCase()}`:"Audit entry"} description={entry?`${dateTime(entry.occurred_at)} · entry ${entry.id}`:undefined} onClose={onClose}>
    {entry&&<div className="grid gap-4 text-sm">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
        <dt className="text-slate-500">By</dt><dd>{entry.actor_scope?`${entry.actor_name??"Not signed in"}${entry.actor_email?` (${entry.actor_email})`:""}`:`Directly in the database, login ${entry.db_user}`}</dd>
        {entry.actor_roles&&<><dt className="text-slate-500">Roles</dt><dd>{entry.actor_roles.replace(/_/g," ").replace(/,/g,", ")}</dd></>}
        <dt className="text-slate-500">IP address</dt><dd className="font-mono">{entry.ip??"—"}</dd>
        <dt className="text-slate-500">Request</dt><dd className="break-all font-mono text-xs">{entry.request_path??"—"}</dd>
        <dt className="text-slate-500">Request id</dt><dd className="break-all font-mono text-xs">{entry.request_id??"—"}</dd>
        <dt className="text-slate-500">Recorded by</dt><dd>{entry.source??"—"}</dd>
        <dt className="text-slate-500">Record</dt><dd className="break-all font-mono text-xs">{entry.table_name} {entry.record_id}</dd>
        {entry.organization_name&&<><dt className="text-slate-500">Organization</dt><dd>{entry.organization_name}</dd></>}
      </dl>
      <div className="max-h-[50vh] overflow-auto border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50"><tr><th className="px-3 py-2">Field</th>{entry.action!=="insert"&&<th className="px-3 py-2">Before</th>}{entry.action!=="delete"&&<th className="px-3 py-2">After</th>}</tr></thead>
          <tbody>{fields.map(f=><tr key={f} className="border-t border-slate-100 align-top">
            <td className="px-3 py-1.5 font-medium text-slate-700">{fieldLabel(f)}</td>
            {entry.action!=="insert"&&<td className="break-all px-3 py-1.5 font-mono text-slate-600">{show(before[f])}</td>}
            {entry.action!=="delete"&&<td className="break-all px-3 py-1.5 font-mono text-slate-900">{show(after[f])}</td>}
          </tr>)}</tbody>
        </table>
      </div>
    </div>}
  </Modal>;
}

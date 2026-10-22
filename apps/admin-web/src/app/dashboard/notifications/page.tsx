"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,PageHeader,SectionHeading} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {AppNotification,SEVERITY_MARK,timeAgo} from "@/components/layout/NotificationBell";
import {apiRequest} from "@/lib/api";

type Preference={category:string;email:boolean;sms:boolean};
type Preferences={contact:{email:string|null;phone:string|null};categories:Preference[]};

const CATEGORY:Record<string,{label:string;hint:string}>={
  permit:{label:"Permit",hint:"Expiry reminders, expiry and suspension"},
  renewal:{label:"Renewals",hint:"Renewal requests and decisions"},
  returns:{label:"Monthly returns",hint:"Overdue returns and KCCA decisions"},
  compliance:{label:"Compliance",hint:"Notices, responses and case decisions"},
  custody:{label:"Chain of custody",hint:"Deliveries between recyclers and factories"},
  disposal:{label:"Disposal",hint:"Trips without a weighbridge ticket and KCCA decisions on explanations"},
  dumping:{label:"Illegal dumping",hint:"Reports, cleanup orders, deadlines and KCCA checks"},
  penalties:{label:"Penalties",hint:"Penalty notices, appeal decisions, payments and deadlines"},
  billing:{label:"Subscription and billing",hint:"Invoices, payments, trial and plan changes"},
  system:{label:"System",hint:"Platform announcements"},
};

export default function NotificationsPage(){
  const [rows,setRows]=useState<AppNotification[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(25),[unreadOnly,setUnreadOnly]=useState(false);
  const [prefs,setPrefs]=useState<Preferences|null>(null),[draft,setDraft]=useState<Record<string,{email:boolean;sms:boolean}>>({});
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[saving,setSaving]=useState(false);

  const load=useCallback(async()=>{
    try{const r=await apiRequest<{data:AppNotification[];pagination:{total:number}}>(`/api/waste/notifications?page=${page}&pageSize=${pageSize}${unreadOnly?"&unread=1":""}`);setRows(r.data);setTotal(r.pagination.total)}
    catch(e){setError(e instanceof Error?e.message:"Could not load notifications")}
  },[page,pageSize,unreadOnly]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  useEffect(()=>{apiRequest<{data:Preferences}>("/api/waste/notifications/preferences").then(r=>{
    setPrefs(r.data);
    setDraft(Object.fromEntries(r.data.categories.map(c=>[c.category,{email:c.email,sms:c.sms}])));
  }).catch(()=>undefined)},[]);

  async function markAll(){await apiRequest("/api/waste/notifications/read",{method:"POST",body:JSON.stringify({all:true})});await load();}
  async function markOne(n:AppNotification){if(!n.read_at){await apiRequest("/api/waste/notifications/read",{method:"POST",body:JSON.stringify({ids:[n.id]})}).catch(()=>undefined);}}
  async function savePrefs(){
    setSaving(true);setError("");setNotice("");
    try{await apiRequest("/api/waste/notifications/preferences",{method:"PUT",body:JSON.stringify({categories:Object.entries(draft).map(([category,v])=>({category,...v}))})});setNotice("Notification settings saved.")}
    catch(e){setError(e instanceof Error?e.message:"Could not save settings")}finally{setSaving(false)}
  }

  return <AppShell><div className="mx-auto max-w-4xl space-y-8">
    <PageHeader eyebrow="Account" title="Notifications" description="Everything the platform has told you, and how you want to hear about it."/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Show" className="flex overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">
          {([[false,"All"],[true,"Unread"]] as const).map(([value,label],i)=><button key={label} role="radio" aria-checked={unreadOnly===value} onClick={()=>{setUnreadOnly(value);setPage(1)}} className={`min-h-0 rounded-none px-3 py-1.5 ${i?"border-l border-slate-300":""} ${unreadOnly===value?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{label}</button>)}
        </div>
        <button onClick={()=>void markAll()} className="min-h-0 p-0 text-sm font-medium text-[var(--color-action)] hover:underline">Mark all as read</button>
      </div>
      {rows.length?<ul className="card divide-y divide-slate-100">{rows.map(n=><li key={n.id}>
        <Link href={n.link||"#"} onClick={()=>void markOne(n)} className="flex gap-3 px-5 py-4 hover:bg-slate-50">
          <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 ${SEVERITY_MARK[n.severity]}`}/>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-baseline justify-between gap-x-4"><span className={`text-sm ${n.read_at?"text-slate-700":"font-semibold text-slate-900"}`}>{n.title}</span><span className="text-xs text-slate-400">{CATEGORY[n.category]?.label} · {timeAgo(n.created_at)}</span></span>
            <span className="mt-0.5 block text-sm text-slate-600">{n.body}</span></span>
        </Link></li>)}</ul>:<EmptyState title={unreadOnly?"No unread notifications":"No notifications yet"}/>}
      <Pagination page={page} pageSize={pageSize} total={total} totalPages={Math.max(1,Math.ceil(total/pageSize))} onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/>
    </section>

    {prefs&&<section>
      <SectionHeading title="Email and SMS" description="Every notification appears here in the app. Email is used for warnings and urgent items, SMS for urgent items only; untick a channel to stop it for a category."/>
      <div className="table-wrap"><table className="w-full text-left">
        <thead><tr><th>Category</th><th className="text-center">Email{prefs.contact.email?"":" (no address)"}</th><th className="text-center">SMS{prefs.contact.phone?"":" (no number)"}</th></tr></thead>
        <tbody>{prefs.categories.map(c=><tr key={c.category}>
          <td><p className="table-primary">{CATEGORY[c.category]?.label||c.category}</p><p className="table-secondary">{CATEGORY[c.category]?.hint}</p></td>
          {(["email","sms"] as const).map(channel=><td key={channel} className="text-center"><input type="checkbox" aria-label={`${CATEGORY[c.category]?.label} by ${channel}`} disabled={channel==="email"?!prefs.contact.email:!prefs.contact.phone} checked={draft[c.category]?.[channel]??false} onChange={e=>setDraft(d=>({...d,[c.category]:{...d[c.category],[channel]:e.target.checked}}))} className="h-4 w-4"/></td>)}
        </tr>)}</tbody>
      </table></div>
      <p className="mt-2 text-xs text-slate-500">Sent to {prefs.contact.email||"no email address"}{prefs.contact.phone?` and ${prefs.contact.phone}`:""}; change these under My account.</p>
      <button onClick={()=>void savePrefs()} disabled={saving} className="mt-4 bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?"Saving…":"Save settings"}</button>
    </section>}
  </div></AppShell>;
}

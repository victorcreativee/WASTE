"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {AppShell} from "@/components/layout/AppShell";
import {Pager,usePagination} from "@/components/ui/Pagination";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";

type Investor={id:string;user_id:string|null;display_name:string;share_percent:string|null;notes:string|null;active:boolean;account_name:string|null;invested_ugx:string;paid_out_ugx:string};
type Movement={id:string;display_name:string;transaction_type:"investment"|"payout";amount_ugx:string;transaction_date:string;reference:string;moved_cash:boolean;reversed_at:string|null;reversal_reason:string|null;balanceUgx:number};
type Update={id:string;title:string;body:string;created_at:string;posted_by_name:string|null};
type Account={id:string;full_name:string;email:string};
type Data={investors:Investor[];transactions:Movement[];updates:Update[];accounts:Account[]};

const ugx=(value:number|string)=>`UGX ${Math.round(Number(value)).toLocaleString("en-GB")}`;
const day=(value:string)=>new Date(value).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Kampala"}).format(new Date());
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const primary="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const secondary="border border-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-[var(--color-action)]";
const small="border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700";
/** Matches the server's split: each investor's share of the whole amount, rounded down. */
const partOf=(total:number,share:string|null)=>Math.floor(total*Math.round(Number(share??0)*100)/10000);

export default function InvestorsPage(){
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[saving,setSaving]=useState(false);
  const [editing,setEditing]=useState<Investor|"new"|null>(null),[money,setMoney]=useState<Investor|null>(null),[posting,setPosting]=useState(false);
  const [cancelling,setCancelling]=useState<Movement|null>(null),[sharing,setSharing]=useState(false),[shareTotal,setShareTotal]=useState("");
  const load=useCallback(async()=>{
    try{setData((await apiRequest<{data:Data}>("/api/waste/recycling/investors")).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load investors")}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  const investorsPage=usePagination(data?.investors??[]),movementsPage=usePagination(data?.transactions??[]),updatesPage=usePagination(data?.updates??[]);

  /** Sends one change, then closes the dialog and reloads. */
  async function save(path:string,method:string,body:unknown,done:()=>void){
    try{
      setSaving(true);setError("");
      const result=await apiRequest<{message:string}>(path,{method,...(body?{body:JSON.stringify(body)}:{})});
      done();setNotice(result.message);await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not save")}finally{setSaving(false)}
  }
  function submitInvestor(form:FormData){
    const share=String(form.get("sharePercent")??"").trim(),isNew=editing==="new";
    const body={displayName:form.get("displayName"),userId:form.get("userId")||undefined,notes:form.get("notes")||undefined,...(share?{sharePercent:Number(share)}:{}),...(isNew?{}:{active:form.get("active")==="on"})};
    void save(isNew?"/api/waste/recycling/investors":`/api/waste/recycling/investors/${(editing as Investor).id}`,isNew?"POST":"PATCH",body,()=>setEditing(null));
  }
  function submitMoney(form:FormData){
    if(!money)return;
    void save(`/api/waste/recycling/investors/${money.id}/transactions`,"POST",{transactionType:form.get("transactionType"),amountUgx:Number(form.get("amountUgx")),transactionDate:form.get("transactionDate"),reference:form.get("reference"),movesCash:form.get("movesCash")==="yes",notes:form.get("notes")||undefined},()=>setMoney(null));
  }
  function submitShare(form:FormData){
    void save("/api/waste/recycling/investor-distributions","POST",{totalUgx:Number(shareTotal),transactionDate:form.get("transactionDate"),reference:form.get("reference"),movesCash:form.get("movesCash")==="yes",notes:form.get("notes")||undefined},()=>{setSharing(false);setShareTotal("")});
  }
  const current=editing&&editing!=="new"?editing:null;
  const shareParts=(data?.investors??[]).filter(row=>row.active&&Number(row.share_percent)>0).map(row=>({row,amount:partOf(Number(shareTotal),row.share_percent)}));
  const sharePaid=shareParts.reduce((sum,part)=>sum+part.amount,0);
  const cashChoice=<label className="font-medium sm:col-span-2">Office cash<select name="movesCash" defaultValue="yes" className={field}><option value="yes">Update office cash now</option><option value="no">Don’t change office cash (already counted)</option></select><span className="mt-1 block text-xs font-normal text-slate-500">Choose “already counted” for money moved before the opening balance was set, so it isn’t counted twice.</span></label>;

  return <AppShell><div className="mx-auto max-w-[1200px] space-y-6">
    <PageHeader eyebrow="Finance" title="Investors" description="Record who has invested, what they put in and took out, and write updates they read on their investor page."
      action={<div className="flex flex-wrap gap-2"><Link href="/dashboard/investor" className={secondary}>View investor page</Link><button onClick={()=>{setError("");setEditing("new")}} className={primary}>Add investor</button></div>}/>
    {error&&!editing&&!money&&!posting&&!cancelling&&!sharing&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}
    {!data&&!error&&<p className="py-6 text-sm text-slate-500">Loading investors…</p>}
    {data&&<>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-950">Investors</h2>
        {data.investors.length?<div className="table-wrap"><table className="w-full min-w-[620px] text-left">
          <thead><tr><th>Investor</th><th>Sign-in</th><th className="text-right!">Share</th><th className="text-right!">Invested</th><th className="text-right!">Paid out</th></tr></thead>
          <tbody>{investorsPage.paged.map(row=><tr key={row.id} className={row.active?"":"text-slate-400"}>
            <td><p className="table-primary">{row.display_name}</p>{!row.active&&<p className="table-secondary">No longer an investor</p>}
              <div className="mt-2 flex gap-2">{row.active&&<button onClick={()=>{setError("");setMoney(row)}} className={small}>Record money</button>}<button onClick={()=>{setError("");setEditing(row)}} className={small}>Edit</button></div></td>
            <td>{row.account_name??<span className="text-slate-500">No sign-in linked</span>}</td>
            <td className="text-right tabular-nums">{row.share_percent===null?"—":`${Number(row.share_percent)}%`}</td>
            <td className="text-right tabular-nums">{ugx(row.invested_ugx)}</td>
            <td className="text-right tabular-nums">{ugx(row.paid_out_ugx)}</td>
          </tr>)}</tbody></table><Pager of={investorsPage}/></div>
        :<EmptyState title="No investors yet" description="Add each investor, then link their sign-in so they see their own position."/>}
        <p className="mt-2 text-xs text-slate-500">Investors sign in with an “Investor / guest” account, created under Staff management.</p>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-950">Investments and payouts</h2><button onClick={()=>{setError("");setSharing(true)}} className={secondary}>Share a payout</button></div>
        {data.transactions.length?<div className="table-wrap"><table className="w-full min-w-[860px] text-left">
          <thead><tr><th>Date</th><th>Investor</th><th>Type</th><th>Reference</th><th>Office cash</th><th className="text-right!">Amount</th><th className="text-right!">Invested less payouts</th></tr></thead>
          <tbody>{movementsPage.paged.map(row=><tr key={row.id} className={row.reversed_at?"text-slate-400":""}><td className="whitespace-nowrap">{day(row.transaction_date)}</td>
            <td><p className="table-primary">{row.display_name}</p>{row.reversed_at?<p className="table-secondary">Cancelled: {row.reversal_reason}</p>:<div className="mt-2"><button onClick={()=>{setError("");setCancelling(row)}} className={small}>Cancel entry</button></div>}</td>
            <td>{row.transaction_type==="investment"?"Investment":"Payout"}</td><td>{row.reference}</td><td>{row.reversed_at?(row.moved_cash?"Returned":"Not changed"):row.moved_cash?(row.transaction_type==="investment"?"Added":"Paid from"):"Not changed"}</td>
            <td className={`text-right tabular-nums ${row.reversed_at?"line-through":""}`}>{ugx(row.amount_ugx)}</td><td className="text-right tabular-nums">{ugx(row.balanceUgx)}</td></tr>)}</tbody></table><Pager of={movementsPage}/></div>
        :<EmptyState title="No investments recorded" description="Use Record money on an investor."/>}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-950">Updates to investors</h2><button onClick={()=>{setError("");setPosting(true)}} className={secondary}>Write an update</button></div>
        {data.updates.length?<div className="space-y-3">{updatesPage.paged.map(update=><article key={update.id} className="border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="font-medium text-slate-900">{update.title}</p><p className="text-xs text-slate-500">{day(update.created_at)}{update.posted_by_name?` · ${update.posted_by_name}`:""}</p></div>
            <button disabled={saving} onClick={()=>void save(`/api/waste/recycling/investor-updates/${update.id}`,"DELETE",null,()=>undefined)} className={small}>Remove</button></div>
          <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{update.body}</p>
        </article>)}<Pager of={updatesPage}/></div>:<EmptyState title="No updates yet" description="Share news, milestones or challenges. Every investor sees them on their page."/>}
      </section>

      <Modal open={Boolean(editing)} title={current?"Edit investor":"Add investor"} description="The name and share are shown to the investor on their page." onClose={()=>!saving&&setEditing(null)}>
        <form key={current?.id??"new"} onSubmit={e=>{e.preventDefault();submitInvestor(new FormData(e.currentTarget))}} className="grid gap-4 text-sm">
          <label className="font-medium">Name<input name="displayName" required minLength={2} maxLength={160} defaultValue={current?.display_name} className={field}/></label>
          <label className="font-medium">Share of the company (%) <span className="font-normal text-slate-500">(optional)</span><input name="sharePercent" type="number" min="0" max="100" step="0.01" defaultValue={current?.share_percent?Number(current.share_percent):""} className={field}/></label>
          <label className="font-medium">Sign-in account <span className="font-normal text-slate-500">(optional)</span><select name="userId" defaultValue={current?.user_id??""} className={field}><option value="">No sign-in linked</option>{data.accounts.map(account=><option key={account.id} value={account.id}>{account.full_name} · {account.email}</option>)}</select></label>
          <label className="font-medium">Private notes <span className="font-normal text-slate-500">(not shown to the investor)</span><textarea name="notes" rows={2} maxLength={500} defaultValue={current?.notes??""} className={field}/></label>
          {current&&<label className="flex items-center gap-2 font-medium"><input type="checkbox" name="active" defaultChecked={current.active}/> Still an investor</label>}
          {error&&<p className="text-[var(--color-danger)]">{error}</p>}
          <button disabled={saving} className={primary}>{saving?"Saving…":"Save investor"}</button>
        </form>
      </Modal>

      <Modal open={Boolean(money)} title="Record investment or payout" description={money?money.display_name:""} onClose={()=>!saving&&setMoney(null)}>
        <form key={money?.id} onSubmit={e=>{e.preventDefault();submitMoney(new FormData(e.currentTarget))}} className="grid gap-4 text-sm sm:grid-cols-2">
          <label className="font-medium">Type<select name="transactionType" className={field}><option value="investment">Investment received</option><option value="payout">Payout to investor</option></select></label>
          <label className="font-medium">Amount (UGX)<input name="amountUgx" type="number" min="1" required className={field}/></label>
          <label className="font-medium">Date<input name="transactionDate" type="date" required defaultValue={today()} max={today()} className={field}/></label>
          <label className="font-medium">Reference<input name="reference" required minLength={2} maxLength={120} placeholder="Agreement or transfer number" className={field}/></label>
          {cashChoice}
          <label className="font-medium sm:col-span-2">Notes <span className="font-normal text-slate-500">(optional)</span><textarea name="notes" rows={2} maxLength={500} className={field}/></label>
          {error&&<p className="text-[var(--color-danger)] sm:col-span-2">{error}</p>}
          <p className="text-xs text-slate-500 sm:col-span-2">A mistake can’t be edited. Cancel the entry and record it again.</p>
          <button disabled={saving} className={`${primary} sm:col-span-2`}>{saving?"Saving…":"Record"}</button>
        </form>
      </Modal>

      <Modal open={Boolean(cancelling)} title="Cancel this entry" description={cancelling?`${cancelling.transaction_type==="investment"?"Investment by":"Payout to"} ${cancelling.display_name}, ${ugx(cancelling.amount_ugx)}, reference ${cancelling.reference}`:""} onClose={()=>!saving&&setCancelling(null)}>
        <form key={cancelling?.id} onSubmit={e=>{e.preventDefault();if(cancelling)void save(`/api/waste/recycling/investor-transactions/${cancelling.id}/reverse`,"POST",{reason:new FormData(e.currentTarget).get("reason")},()=>setCancelling(null))}} className="grid gap-4 text-sm">
          <p className="text-slate-600">{cancelling?.moved_cash?`${ugx(cancelling.amount_ugx)} ${cancelling.transaction_type==="investment"?"leaves":"returns to"} office cash today as a correction. `:"Office cash doesn’t change. "}The entry stays on the record, marked cancelled, and the investor is told.</p>
          <label className="font-medium">Reason<input name="reason" required minLength={3} maxLength={300} placeholder="For example: wrong amount entered" className={field}/></label>
          {error&&<p className="text-[var(--color-danger)]">{error}</p>}
          <button disabled={saving} className={primary}>{saving?"Cancelling…":"Cancel entry"}</button>
        </form>
      </Modal>

      <Modal open={sharing} title="Share a payout" description="Enter the amount for the whole company. Each investor receives their share of it." onClose={()=>!saving&&setSharing(false)}>
        <form onSubmit={e=>{e.preventDefault();submitShare(new FormData(e.currentTarget))}} className="grid gap-4 text-sm sm:grid-cols-2">
          <label className="font-medium sm:col-span-2">Amount for the whole company (UGX)<input type="number" min="1" required value={shareTotal} onChange={e=>setShareTotal(e.target.value)} className={field}/></label>
          <label className="font-medium">Date<input name="transactionDate" type="date" required defaultValue={today()} max={today()} className={field}/></label>
          <label className="font-medium">Reference<input name="reference" required minLength={2} maxLength={110} placeholder="For example: 2026 dividend" className={field}/></label>
          {cashChoice}
          <label className="font-medium sm:col-span-2">Notes <span className="font-normal text-slate-500">(optional)</span><textarea name="notes" rows={2} maxLength={500} className={field}/></label>
          <div className="sm:col-span-2">{shareParts.length?<div className="divide-y divide-slate-100 border-y border-slate-200">
            {shareParts.map(({row,amount})=><div key={row.id} className="flex justify-between gap-4 py-2"><span>{row.display_name} ({Number(row.share_percent)}%)</span><span className="tabular-nums">{ugx(amount)}</span></div>)}
            <div className="flex justify-between gap-4 py-2 font-semibold text-slate-950"><span>Paid out</span><span className="tabular-nums">{ugx(sharePaid)}</span></div>
          </div>:<p className="text-slate-500">No investor has a share yet. Set shares with Edit first.</p>}
          {sharePaid>0&&Number(shareTotal)>sharePaid&&<p className="mt-2 text-xs text-slate-500">The remaining {ugx(Number(shareTotal)-sharePaid)} isn’t held by these investors, so it stays in the company.</p>}</div>
          {error&&<p className="text-[var(--color-danger)] sm:col-span-2">{error}</p>}
          <button disabled={saving||!sharePaid} className={`${primary} sm:col-span-2`}>{saving?"Paying…":`Pay ${ugx(sharePaid)}`}</button>
        </form>
      </Modal>

      <Modal open={posting} title="Write an update" description="Every investor sees this on their page and gets a notification." onClose={()=>!saving&&setPosting(false)}>
        <form onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void save("/api/waste/recycling/investor-updates","POST",{title:form.get("title"),body:form.get("body")},()=>setPosting(false))}} className="grid gap-4 text-sm">
          <label className="font-medium">Title<input name="title" required minLength={3} maxLength={160} className={field}/></label>
          <label className="font-medium">Message<textarea name="body" required minLength={3} maxLength={4000} rows={6} className={field}/></label>
          {error&&<p className="text-[var(--color-danger)]">{error}</p>}
          <button disabled={saving} className={primary}>{saving?"Posting…":"Post update"}</button>
        </form>
      </Modal>
    </>}
  </div></AppShell>;
}

"use client";
import type {ReactNode} from "react";
import {ACTION,SOURCE,STATUS,SiteDetail,day,sizeLabel,useAuthenticatedImage,when,WASTE_TYPES} from "@/lib/dumping";

const STAGE:Record<string,string>={report:"Report",inspection:"Inspection",cleanup:"Cleanup",verification:"KCCA check"};

function Photo({id,stage,at}:{id:string;stage:string;at:string}){
  const url=useAuthenticatedImage(`/api/waste/dumping/photos/${id}`);
  return <figure className="w-36 shrink-0"><div className="flex h-28 items-center justify-center overflow-hidden border border-slate-200 bg-slate-50">{url?<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`${STAGE[stage]} photo`} className="h-28 w-36 object-cover"/></a>:<span className="text-xs text-slate-400">Loading…</span>}</div>
    <figcaption className="mt-1 text-[11px] text-slate-500">{STAGE[stage]} · {day(at)}</figcaption></figure>;
}

/** Side panel with everything known about a site; the caller supplies the actions its role may take. */
export function SitePanel({site,onClose,actions}:{site:SiteDetail;onClose:()=>void;actions?:ReactNode}){
  return <div className="anim-fade fixed inset-0 z-[1500] flex justify-end bg-slate-900/40" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="h-full w-full max-w-2xl overflow-y-auto bg-white">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-slate-200 bg-white px-6 py-5">
        <div><p className="text-xs font-medium text-slate-500">{site.site_number}{site.division_name?` · ${site.division_name}`:""}</p><h2 className="mt-1 text-xl font-semibold">{site.landmark||"Dumping site"}</h2>
          <div className="mt-2 flex flex-wrap gap-2"><span className={STATUS[site.status].className}>{STATUS[site.status].label}</span>{site.hazardous&&<span className="status status-failed normal-case">Hazardous</span>}{site.hotspot&&<span className="status status-failed normal-case">Hotspot</span>}{site.overdue&&<span className="status status-failed normal-case">Cleanup overdue</span>}</div></div>
        <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-900">Close</button>
      </header>
      <div className="space-y-6 px-6 py-6 text-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div><dt className="text-xs text-slate-500">Size</dt><dd className="text-slate-900">{sizeLabel(site.size)}</dd></div>
          <div><dt className="text-xs text-slate-500">Waste</dt><dd className="text-slate-900">{site.waste_types.length?site.waste_types.map(w=>WASTE_TYPES.find(([v])=>v===w)?.[1]||w).join(", "):"Not inspected yet"}</dd></div>
          <div><dt className="text-xs text-slate-500">First reported</dt><dd className="text-slate-900">{when(site.first_reported_at)}</dd></div>
          <div><dt className="text-xs text-slate-500">Reports</dt><dd className="text-slate-900">{site.report_count}{site.recurrence_count?` · came back ${site.recurrence_count} time${site.recurrence_count===1?"":"s"}`:""}</dd></div>
          {site.cleanup_due_on&&<div><dt className="text-xs text-slate-500">Cleanup</dt><dd className={site.overdue?"font-medium text-[var(--color-danger)]":"text-slate-900"}>{site.cleanup_organization_name||"KCCA crew"}, due {day(site.cleanup_due_on)}</dd></div>}
          {site.responsible_organization_name&&<div className="col-span-2"><dt className="text-xs text-slate-500">Held responsible</dt><dd className="text-slate-900">{site.responsible_organization_name}<span className="block text-slate-600">{site.responsibility_basis}</span></dd></div>}
          {site.closed_reason&&<div className="col-span-2"><dt className="text-xs text-slate-500">Closed because</dt><dd className="text-slate-900">{site.closed_reason}</dd></div>}
          <div className="col-span-2"><dt className="text-xs text-slate-500">Location</dt><dd><a className="text-[var(--color-action)] hover:underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${site.latitude}&mlon=${site.longitude}#map=18/${site.latitude}/${site.longitude}`}>{Number(site.latitude).toFixed(5)}, {Number(site.longitude).toFixed(5)}</a></dd></div>
        </dl>

        {actions}

        {site.photos.length>0&&<div><h3 className="font-semibold">Photos</h3><div className="mt-3 flex gap-3 overflow-x-auto pb-1">{site.photos.map(p=><Photo key={p.id} id={p.id} stage={p.stage} at={p.created_at}/>)}</div></div>}

        <div><h3 className="font-semibold">Reports</h3><ul className="mt-3 space-y-3">{site.reports.map(r=><li key={r.id}><p className="text-xs text-slate-500">{when(r.created_at)} · {SOURCE[r.source]||r.source}{r.reporter_name?` · ${r.reporter_name}`:""}{r.reporter_organization_name?` · ${r.reporter_organization_name}`:""}</p><p className="text-slate-800">{r.description}</p></li>)}</ul></div>

        <div><h3 className="font-semibold">History</h3><ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">{site.history.map((h,i)=><li key={i}><p className="text-xs text-slate-500">{when(h.created_at)}{h.actor_name?` · ${h.actor_name}`:""}</p><p className="font-medium text-slate-800">{ACTION[h.action]||h.action}</p>{h.note&&<p className="text-slate-600">{h.note}</p>}</li>)}</ol></div>
      </div>
    </section>
  </div>;
}

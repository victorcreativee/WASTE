"use client";
import type {ReactNode} from "react";
import {ACTION,NoticeDetail,STATUS,day,ugx,when} from "@/lib/penalties";

/** Side panel with a penalty notice, its appeal and its history; the caller supplies the actions its role may take. */
export function NoticePanel({notice,onClose,actions}:{notice:NoticeDetail;onClose:()=>void;actions?:ReactNode}){
  const source=notice.site_number?`Dumping site ${notice.site_number}`:notice.case_number?`Compliance case ${notice.case_number}`:notice.return_period?`Monthly return ${notice.return_period}`:null;
  return <div className="anim-fade fixed inset-0 z-[1500] flex justify-end bg-slate-900/40" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="h-full w-full max-w-2xl overflow-y-auto bg-white">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-slate-200 bg-white px-6 py-5">
        <div><p className="text-xs font-medium text-slate-500">{notice.notice_number} · {notice.organization_name}</p><h2 className="mt-1 text-xl font-semibold">{notice.offence}</h2>
          <div className="mt-2 flex flex-wrap gap-2"><span className={STATUS[notice.status].className}>{STATUS[notice.status].label}</span>{notice.overdue&&<span className="status status-failed normal-case">Overdue</span>}{notice.escalated_at&&<span className="status status-failed normal-case">Permit suspended</span>}{notice.offence_number>1&&<span className="status normal-case">Repeat offence {notice.offence_number}</span>}</div></div>
        <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-900">Close</button>
      </header>
      <div className="space-y-6 px-6 py-6 text-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div><dt className="text-xs text-slate-500">Amount</dt><dd className="text-lg font-semibold tabular-nums text-slate-900">{ugx(notice.amount_ugx)}</dd>{notice.amount_ugx<notice.original_amount_ugx&&<dd className="text-xs text-slate-500">Reduced from {ugx(notice.original_amount_ugx)}</dd>}</div>
          <div><dt className="text-xs text-slate-500">Due</dt><dd className={notice.overdue?"font-medium text-[var(--color-danger)]":"text-slate-900"}>{day(notice.due_on)}</dd></div>
          <div><dt className="text-xs text-slate-500">Issued</dt><dd className="text-slate-900">{day(notice.issued_at)}</dd></div>
          <div><dt className="text-xs text-slate-500">Appeal by</dt><dd className="text-slate-900">{notice.appealed_before?"Appeal filed":day(notice.appeal_deadline)}</dd></div>
          {source&&<div className="col-span-2"><dt className="text-xs text-slate-500">Arises from</dt><dd className="text-slate-900">{source}</dd></div>}
          <div className="col-span-2"><dt className="text-xs text-slate-500">Grounds</dt><dd className="whitespace-pre-line text-slate-800">{notice.grounds}</dd></div>
          {notice.payment_reference&&<div className="col-span-2"><dt className="text-xs text-slate-500">Payment</dt><dd className="text-slate-900">{notice.payment_reference}, paid {day(notice.paid_on)}{notice.payment_confirmed_at?" · confirmed by KCCA":" · waiting for KCCA"}</dd></div>}
          {notice.waived_reason&&<div className="col-span-2"><dt className="text-xs text-slate-500">Withdrawn because</dt><dd className="text-slate-900">{notice.waived_reason}</dd></div>}
        </dl>
        {actions}
        {notice.appeal&&<div><h3 className="font-semibold">Appeal</h3><p className="mt-2 text-xs text-slate-500">{when(notice.appeal.submitted_at)} · {notice.appeal.submitted_by_name}</p><p className="text-slate-800">{notice.appeal.grounds}</p>
          {notice.appeal.decision&&<p className="mt-2 text-slate-800"><span className="font-medium">KCCA decision ({notice.appeal.decision}):</span> {notice.appeal.decision_note}</p>}</div>}
        <div><h3 className="font-semibold">History</h3><ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">{notice.history.map((h,i)=><li key={i}><p className="text-xs text-slate-500">{when(h.created_at)}{h.actor_name?` · ${h.actor_name}`:""}</p><p className="font-medium text-slate-800">{ACTION[h.action]||h.action}</p>{h.note&&<p className="text-slate-600">{h.note}</p>}</li>)}</ol></div>
      </div>
    </section>
  </div>;
}

export type FundingPosition = {
  cash_position_ugx: string;
  committed_funds_ugx: string;
  available_to_commit_ugx: string;
};

export function FundingSummary({ funding }: { funding?: FundingPosition | null }) {
  if (!funding) return null;
  return <section aria-label="Organization funds" className="mt-6 border-y border-slate-300 py-3">
    <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
      {[["Cash balance", funding.cash_position_ugx], ["Committed funds", funding.committed_funds_ugx], ["Available to commit", funding.available_to_commit_ugx]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-semibold">UGX {Number(value).toLocaleString("en-UG")}</dd></div>)}
    </dl>
    <p className="mt-3 text-xs text-slate-500">Orders reserve funds when issued. Payments reduce cash. Refresh this page after changes in another tab.</p>
  </section>;
}

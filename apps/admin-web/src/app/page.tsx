import Link from "next/link";

const capabilities = [
  ["Operations", "Plan collections, assign vehicles and drivers, follow routes, and handle service exceptions from one operational record."],
  ["Customers & contracts", "Connect every customer location to an approved provider, package, contract, service level, and collection history."],
  ["Fleet & workforce", "Keep vehicles compliant, control maintenance and fuel records, and manage staff, attendance, access, and payroll."],
  ["Income & expenditure", "Move from contracted service to invoice and receipt, with controlled expenses, suppliers, procurement, and available-funds checks."],
  ["Resident services", "Give residents one clear place to follow collections, billing, provider requests, and service issues."],
  ["KCCA command centre", "Monitor city coverage and service performance while each organization’s private records stay protected."],
];
const roles = [
  ["Waste organizations", "Run service delivery and business administration in one connected workspace."],
  ["Drivers and field teams", "Receive assigned work, navigate stops, capture outcomes, and report blockers."],
  ["Residents and customers", "See their own service, contracts, invoices, collections, and support requests."],
  ["KCCA", "Coordinate providers, monitor coverage, and act on accountable operational evidence."],
];
const flow = [
  ["Set up", "Provider, staff, fleet, customer, package, and contract."],
  ["Plan", "Turn schedules and eligible locations into assigned routes."],
  ["Complete", "Capture arrival, collection, weight, and field exceptions."],
  ["Account", "Update customer service, billing, reports, and KCCA oversight."],
];
const entryPoints = [
  ["New waste organization", "Create a secure applicant account, apply for a KCCA permit, then request platform access.", "Start organization onboarding", "/register/organization"],
  ["Returning applicant", "Continue a permit application, respond to KCCA requests, or download an approved certificate.", "Continue onboarding", "/login"],
  ["Existing platform user", "Company staff, drivers, KCCA officers, residents, and System Admins use the same secure sign-in.", "Sign in to your workspace", "/login"],
];

export default function Home() {
  return <main className="min-h-screen bg-[#f7f7f5] text-[#18202f]">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-[#f7f7f5]/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-6 px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-3" aria-label="Kampala WMS home"><span className="grid h-8 w-8 place-items-center bg-[#151b2b] text-xs font-semibold text-[#f0b35a]">KW</span><span><strong className="block text-sm font-semibold">Kampala WMS</strong><span className="block text-[11px] text-slate-500">City waste operations</span></span></Link>
        <nav aria-label="Public navigation" className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex"><a href="#platform">Platform</a><a href="#people">Who it serves</a><a href="#governance">KCCA oversight</a><a href="#workflow">How it works</a></nav>
        <div className="flex items-center gap-2"><Link href="/register/organization" className="hidden px-3 py-2 text-sm font-semibold text-[#3156a3] sm:inline-block">Register organization</Link><Link href="/login" className="border border-[#3156a3] px-4 py-2 text-sm font-semibold text-[#3156a3] hover:bg-blue-50">Sign in</Link></div>
      </div>
    </header>

    <section className="border-b border-slate-300">
      <div className="mx-auto grid max-w-7xl gap-14 px-5 py-20 lg:grid-cols-[1.15fr_.85fr] lg:px-8 lg:py-28">
        <div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#3156a3]">One accountable waste ecosystem</p><h1 className="mt-5 max-w-4xl text-5xl font-semibold leading-[1.06] tracking-[-.035em] text-slate-950 sm:text-6xl">Cleaner city services, connected from the household to KCCA.</h1><p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600">Kampala WMS brings waste organizations, field teams, customers, and city oversight into one practical system—without mixing the private operations of different providers.</p><div className="mt-9 flex flex-wrap gap-3"><Link href="/register/organization" className="bg-[#3156a3] px-6 py-3 text-sm font-semibold text-white hover:bg-[#24447f]">Register a waste organization</Link><Link href="/login" className="border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800">Sign in to an existing account</Link></div><p className="mt-4 text-sm text-slate-500">New organizations register first. All existing users sign in.</p></div>
        <div className="border-l-2 border-[#c6842f] pl-6 lg:pl-9"><p className="text-sm font-semibold text-slate-950">Built around real service delivery</p><div className="mt-7 divide-y divide-slate-300 border-y border-slate-300">{[["01","Plan","Eligible locations become accountable collection work."],["02","Deliver","Drivers update every stop and report field outcomes."],["03","Serve","Customers receive clear service and billing records."],["04","Oversee","KCCA follows coverage and performance citywide."]].map(([n,title,text])=><div key={n} className="grid grid-cols-[34px_72px_1fr] gap-3 py-4 text-sm"><span className="text-[#c6842f]">{n}</span><strong>{title}</strong><span className="leading-6 text-slate-600">{text}</span></div>)}</div></div>
      </div>
    </section>

    <section className="border-b border-slate-300 bg-white" aria-labelledby="choose-start"><div className="mx-auto max-w-7xl px-5 py-16 lg:px-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#3156a3]">Start here</p><h2 id="choose-start" className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Choose what you need to do.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">The platform opens the correct, role-controlled workspace after sign-in.</p><div className="mt-8 overflow-x-auto border-y border-slate-300"><table className="w-full min-w-[720px] text-left"><thead><tr><th>You are</th><th>Your next step</th><th>Continue</th></tr></thead><tbody>{entryPoints.map(([role,description,action,href])=><tr key={role}><td className="table-primary">{role}</td><td className="max-w-2xl text-sm leading-6 text-slate-600">{description}</td><td><Link href={href} className="inline-block border border-[#3156a3] px-3 py-2 text-xs font-semibold text-[#3156a3] hover:bg-blue-50">{action}</Link></td></tr>)}</tbody></table></div></div></section>

    <section id="platform" className="mx-auto max-w-7xl px-5 py-20 lg:px-8"><div className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#3156a3]">End-to-end platform</p><h2 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">The work stays connected.</h2><p className="mt-4 leading-7 text-slate-600">Each module supports the next decision, reducing repeated data and helping teams deliver reliable collections.</p></div><div className="mt-12 grid border-t border-slate-300 md:grid-cols-2 lg:grid-cols-3">{capabilities.map(([title,text],index)=><article key={title} className="border-b border-slate-300 py-7 md:px-6 lg:border-l"><p className="text-xs font-semibold text-[#c6842f]">0{index+1}</p><h3 className="mt-3 text-lg font-semibold text-slate-950">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{text}</p></article>)}</div></section>

    <section id="people" className="bg-[#151b2b] text-white"><div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-[.7fr_1.3fr] lg:px-8"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#f0b35a]">Designed for people</p><h2 className="mt-4 text-4xl font-semibold tracking-tight">One system. Clear views for every role.</h2><p className="mt-5 leading-7 text-slate-300">People see the tasks and information they need—not someone else’s complexity or private data.</p></div><div className="divide-y divide-slate-700 border-y border-slate-700">{roles.map(([title,text])=><article key={title} className="grid gap-2 py-5 sm:grid-cols-[190px_1fr]"><h3 className="font-semibold">{title}</h3><p className="text-sm leading-6 text-slate-300">{text}</p></article>)}</div></div></section>

    <section id="governance" className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-2 lg:px-8"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#3156a3]">Kampala’s distinguishing layer</p><h2 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">Business operations with public accountability.</h2><p className="mt-5 leading-7 text-slate-600">Organizations operate independently while KCCA coordinates approved providers, coverage, service evidence, issues, and regulatory performance—not unrestricted access to private company accounts or HR.</p></div><div className="border-y border-slate-300">{["Provider approval and coverage oversight","City, division, zone, route, and service drill-down","Traceable household collection outcomes","Protected organization finance, workforce, and customer records"].map((item,index)=><p key={item} className="flex gap-4 border-b border-slate-300 py-4 text-sm last:border-0"><span className="font-semibold text-[#c6842f]">{index+1}</span><span>{item}</span></p>)}</div></section>

    <section id="workflow" className="border-y border-slate-300 bg-white"><div className="mx-auto max-w-7xl px-5 py-20 lg:px-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#3156a3]">A simpler operating day</p><h2 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">From agreement to verified service.</h2><div className="mt-10 grid gap-px bg-slate-300 md:grid-cols-4">{flow.map(([title,text],index)=><article key={title} className="bg-[#f7f7f5] p-6"><span className="text-xs font-semibold text-[#c6842f]">0{index+1}</span><h3 className="mt-5 font-semibold">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{text}</p></article>)}</div></div></section>

    <section className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-5 py-20 md:flex-row md:items-end lg:px-8"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#3156a3]">Kampala WMS</p><h2 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-slate-950">One clear operating system for cleaner, more accountable city services.</h2></div><Link href="/login" className="flex-none bg-[#3156a3] px-6 py-3 text-sm font-semibold text-white">Sign in to continue</Link></section>
    <footer className="border-t border-slate-300"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 px-5 py-7 text-xs text-slate-500 sm:flex-row lg:px-8"><p>© 2026 Kampala Smart Waste Management System</p><p>Operations · Residents · City oversight</p></div></footer>
  </main>;
}

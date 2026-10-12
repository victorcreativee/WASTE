"use client";

import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";
import { OrganizationWorkspaceNav } from "@/components/layout/OrganizationWorkspaceNav";
import {EmptyState,Feedback,Modal,PageHeader,Status} from "@/components/ui/System";
import {Pagination,usePagination} from "@/components/ui/Pagination";

type Schedule = { id: string; name: string; frequency: string; preferred_time: string | null };
type Collection = { id: string; job_date: string; status: string; waste_type: string };
type Overview = {
  customer_type: string;
  service_status: string;
  label: string;
  address: string;
  zone_name: string | null;
  area_type: string | null;
  organization_name: string | null;
  organization_phone: string | null;
  schedules: Schedule[];
  upcoming_collection: Collection | null;
  collection_history: Collection[];
};
type Customer = { planning_ready:boolean;planning_reasons:string[];
  relationship_id:string;relationship_status:string;relationship_started_on:string;
  id: string; customer_number:string; agreement_confirmed:boolean; latest_contract_status:string|null;
  full_name: string;
  email: string;
  phone: string | null;
  customer_type: string;
  service_status: string;
  address: string | null;
  zone_name: string | null;
  organization_name: string | null;
};
type ProviderOption={id:string;name:string;phone:string|null;matching_zones:number};
type ZoneOption={id:string;name:string;division_name:string|null;latitude:string|null;longitude:string|null;is_active:boolean};
type ProviderRequest={id:string;status:string;customer_note:string|null;review_note:string|null;created_at:string;
  requested_organization_name:string;current_organization_name:string|null;customer_name:string;customer_email:string;
  address:string;organization_action:"review_release"|"review_acceptance"|null};
type Response<T> = { data: T };

function snapshotRoles() {
  try { return JSON.parse(sessionStorage.getItem("currentUser") || "{}").roles?.join(",") || "unknown"; }
  catch { return "unknown"; }
}
function subscribe() { return () => undefined; }
function label(value: string) { return value.replaceAll("_", " "); }
function requestLabel(value:string){return ({pending_current_provider:"Awaiting current provider",pending_new_provider:"Awaiting new provider",approved:"Approved",rejected:"Rejected",cancelled:"Cancelled"} as Record<string,string>)[value]||label(value);}

export default function CustomerServicePage() {
  const roles = useSyncExternalStore(subscribe, snapshotRoles, () => "hydrating");
  const isCitizen = roles.split(",").includes("citizen");
  const isCompanyAdmin=roles.split(",").includes("company_admin");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form, setForm] = useState({
    customerType: "residential", label: "Primary location", address: "",
    latitude: "", longitude: "",
  });
  const [showCustomerForm,setShowCustomerForm]=useState(false);
  const [customerForm,setCustomerForm]=useState({fullName:"",email:"",phone:"",password:"",confirmPassword:"",customerType:"residential",zoneId:"",locationLabel:"Primary location",address:"",latitude:"",longitude:""});
  const [createdCustomer,setCreatedCustomer]=useState<{id:string;number:string;name:string}|null>(null);
  const [zones,setZones]=useState<ZoneOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query,setQuery]=useState("");
  const [providerOptions,setProviderOptions]=useState<ProviderOption[]>([]);
  const [providerRequests,setProviderRequests]=useState<ProviderRequest[]>([]);
  const [selectedProvider,setSelectedProvider]=useState("");
  const [providerNote,setProviderNote]=useState("");
  const filteredCustomers=useMemo(()=>customers.filter(customer=>`${customer.full_name} ${customer.email} ${customer.address||""} ${customer.zone_name||""}`.toLowerCase().includes(query.trim().toLowerCase())),[customers,query]);
  const pages=usePagination(filteredCustomers,10);

  async function loadOverview() {
    const response = await apiRequest<Response<Overview | null>>("/api/waste/customer-service/me");
    setOverview(response.data);
  }
  async function loadCustomers(){const response=await apiRequest<Response<Customer[]>>("/api/waste/customers");setCustomers(response.data);}
  async function loadProviderRequests(){const response=await apiRequest<Response<ProviderRequest[]>>(isCitizen?"/api/waste/customer-service/provider-requests":"/api/waste/customers/provider-requests");setProviderRequests(response.data);}
  async function loadCitizenWorkspace(){const [service,providers,requests]=await Promise.all([apiRequest<Response<Overview|null>>("/api/waste/customer-service/me"),apiRequest<Response<ProviderOption[]>>("/api/waste/customer-service/provider-options"),apiRequest<Response<ProviderRequest[]>>("/api/waste/customer-service/provider-requests")]);setOverview(service.data);setProviderOptions(providers.data);setProviderRequests(requests.data);}
  async function loadOrganizationWorkspace(){await Promise.all([loadCustomers(),...(isCompanyAdmin?[loadProviderRequests(),apiRequest<Response<ZoneOption[]>>("/api/waste/zones").then(result=>setZones(result.data.filter(zone=>zone.is_active)))]:[])]);}

  useEffect(() => {
    if (roles === "hydrating" || roles === "unknown") return;
    const request = isCitizen
      ? Promise.all([apiRequest<Response<Overview|null>>("/api/waste/customer-service/me"),apiRequest<Response<ProviderOption[]>>("/api/waste/customer-service/provider-options"),apiRequest<Response<ProviderRequest[]>>("/api/waste/customer-service/provider-requests")]).then(([service,providers,requests])=>{setOverview(service.data);setProviderOptions(providers.data);setProviderRequests(requests.data)})
      : Promise.all([apiRequest<Response<Customer[]>>("/api/waste/customers"),...(isCompanyAdmin?[apiRequest<Response<ProviderRequest[]>>("/api/waste/customers/provider-requests"),apiRequest<Response<ZoneOption[]>>("/api/waste/zones")]:[])]).then(([customerResult,requestResult,zoneResult])=>{setCustomers(customerResult.data);if(requestResult)setProviderRequests((requestResult as Response<ProviderRequest[]>).data);if(zoneResult)setZones((zoneResult as Response<ZoneOption[]>).data.filter(zone=>zone.is_active))});
    request.catch((loadError: unknown) =>
      setError(loadError instanceof Error ? loadError.message : "Failed to load customer services")
    ).finally(() => setLoading(false));
  }, [roles, isCitizen, isCompanyAdmin]);

  function useCurrentLocation() {
    setError("");
    if (!navigator.geolocation) {
      setError("Location is not supported by this browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => setForm((current) => ({
        ...current,
        latitude: position.coords.latitude.toString(),
        longitude: position.coords.longitude.toString(),
      })),
      () => setError("Location permission was denied. Enter coordinates manually.")
    );
  }

  async function saveService(event: FormEvent) {
    event.preventDefault();
    try {
      setSaving(true); setError(""); setMessage("");
      await apiRequest("/api/waste/customer-service/me", {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
        }),
      });
      setMessage("Address saved. Your existing provider is unchanged. If no service zone is shown, contact your provider for coverage review. A new unassigned customer needs provider onboarding.");
      await loadOverview();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save service location");
    } finally { setSaving(false); }
  }

  async function createCustomer(event:FormEvent){event.preventDefault();if(customerForm.password!==customerForm.confirmPassword){setError("The passwords do not match");return;}try{setSaving(true);setError("");setMessage("");const result=await apiRequest<{data:{customer:{id:string;customer_number:string}}}>("/api/auth/organization-customers",{method:"POST",body:JSON.stringify({fullName:customerForm.fullName,email:customerForm.email,phone:customerForm.phone||undefined,password:customerForm.password,customerType:customerForm.customerType,zoneId:customerForm.zoneId,locationLabel:customerForm.locationLabel,address:customerForm.address,...(customerForm.latitude&&customerForm.longitude?{latitude:Number(customerForm.latitude),longitude:Number(customerForm.longitude)}:{})})});setCreatedCustomer({id:result.data.customer.id,number:result.data.customer.customer_number,name:customerForm.fullName});setCustomerForm({fullName:"",email:"",phone:"",password:"",confirmPassword:"",customerType:"residential",zoneId:"",locationLabel:"Primary location",address:"",latitude:"",longitude:""});setShowCustomerForm(false);setMessage("Customer account and service location created successfully.");await loadCustomers();}catch(e){setError(e instanceof Error?e.message:"Failed to create customer");}finally{setSaving(false);}}
  function captureCustomerLocation(){if(!navigator.geolocation){setError("Location is not supported by this browser");return;}navigator.geolocation.getCurrentPosition(position=>setCustomerForm(current=>({...current,latitude:String(position.coords.latitude),longitude:String(position.coords.longitude)})),()=>setError("Location permission was denied. The selected zone location will be used instead."));}
  async function changeCustomerStatus(customer:Customer,status:"active"|"suspended"|"inactive"){if(status!=="active"&&!window.confirm(`Suspend service for ${customer.full_name}? Their active contract and billing subscription will also be paused.`))return;try{setSaving(true);setError("");setMessage("");await apiRequest(`/api/waste/customers/${customer.id}/status`,{method:"PATCH",body:JSON.stringify({status})});setMessage(status==="active"?`${customer.full_name}'s customer service is active. Resume a suspended contract separately after review.`:`${customer.full_name}'s service, contract and billing subscription are suspended.`);await loadCustomers();}catch(e){setError(e instanceof Error?e.message:"Failed to update customer service");}finally{setSaving(false);}}
  async function requestProvider(event:FormEvent){event.preventDefault();try{setSaving(true);setError("");setMessage("");await apiRequest('/api/waste/customer-service/provider-requests',{method:'POST',body:JSON.stringify({organizationId:selectedProvider,note:providerNote||undefined})});setSelectedProvider('');setProviderNote('');setMessage('Provider request submitted. Follow its review status below.');await loadCitizenWorkspace();}catch(e){setError(e instanceof Error?e.message:'Failed to submit provider request');}finally{setSaving(false);}}
  async function cancelProviderRequest(id:string){try{setSaving(true);setError("");setMessage("");await apiRequest(`/api/waste/customer-service/provider-requests/${id}`,{method:'DELETE'});setMessage('Provider request cancelled.');await loadCitizenWorkspace();}catch(e){setError(e instanceof Error?e.message:'Failed to cancel request');}finally{setSaving(false);}}
  async function reviewProviderRequest(request:ProviderRequest,action:'approve'|'reject'){try{setSaving(true);setError("");setMessage("");const result=await apiRequest<{message:string}>(`/api/waste/customers/provider-requests/${request.id}`,{method:'PATCH',body:JSON.stringify({action})});setMessage(result.message);await loadOrganizationWorkspace();}catch(e){setError(e instanceof Error?e.message:'Failed to review provider request');}finally{setSaving(false);}}

  return <AppShell><div className="mx-auto max-w-7xl">
    <OrganizationWorkspaceNav/>
    <PageHeader eyebrow={isCitizen?"My waste service":"People & customers"} title={isCitizen?"Service area and collections":"Customer management"} description={isCitizen ? "Update your service address and review provider and area information. Address changes do not switch providers." : "Onboard customers, confirm service responsibility and identify who is ready for collection planning."} action={isCompanyAdmin?<button onClick={()=>setShowCustomerForm(true)} className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white">Add customer</button>:undefined}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{message&&<Feedback tone="success">{message}</Feedback>}
    {createdCustomer&&!isCitizen&&<div className="mt-5 flex flex-col justify-between gap-4 border-l-2 border-emerald-600 bg-emerald-50 p-5 sm:flex-row sm:items-center"><div><p className="font-semibold text-emerald-950">{createdCustomer.name} is registered</p><p className="mt-1 text-sm text-emerald-800">Customer number {createdCustomer.number}. Create the service contract next to activate billing and route eligibility.</p></div><a href={`/dashboard/contracts?customerId=${createdCustomer.id}`} className="shrink-0 bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white">Continue to contract →</a></div>}

    {loading ? <p className="py-8 text-slate-500">Loading customer services...</p> : isCitizen ? (
      <div className="grid gap-8 py-8 lg:grid-cols-[380px_1fr]">
        <form onSubmit={saveService} className="h-fit border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-black">Your service location</h2>
          <label className="mt-5 block text-sm font-bold">Property type
            <select value={form.customerType} onChange={(event) => setForm({...form, customerType:event.target.value})} className="mt-2 w-full border p-3">
              <option value="residential">Residential</option><option value="commercial">Commercial</option>
              <option value="office_business">Office / business</option><option value="industrial">Industrial</option>
            </select>
          </label>
          <label className="mt-4 block text-sm font-bold">Location name<input required value={form.label} onChange={(event)=>setForm({...form,label:event.target.value})} className="mt-2 w-full border p-3" /></label>
          <label className="mt-4 block text-sm font-bold">Address<input required minLength={5} value={form.address} onChange={(event)=>setForm({...form,address:event.target.value})} className="mt-2 w-full border p-3" /></label>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-sm font-bold">Latitude<input required type="number" step="any" value={form.latitude} onChange={(event)=>setForm({...form,latitude:event.target.value})} className="mt-2 w-full border p-3" /></label>
            <label className="text-sm font-bold">Longitude<input required type="number" step="any" value={form.longitude} onChange={(event)=>setForm({...form,longitude:event.target.value})} className="mt-2 w-full border p-3" /></label>
          </div>
          <button type="button" onClick={useCurrentLocation} className="mt-3 w-full border border-emerald-700 px-4 py-3 text-sm font-black text-emerald-800">Use my current location</button>
          <button disabled={saving} className="mt-3 w-full bg-emerald-700 px-4 py-3 font-black text-white disabled:opacity-50">{saving ? "Saving..." : "Save service location"}</button>
        </form>

        <section className="space-y-6">
          <div className="border border-slate-200 bg-white p-6"><div><h2 className="text-xl font-semibold">{overview?.organization_name?"Change service provider":"Connect a service provider"}</h2><p className="mt-1 text-sm leading-6 text-slate-500">Only active providers whose mapped boundary covers this address are available. A transfer requires release by your current provider before the new provider can approve it.</p></div>
            {providerRequests.some(request=>request.status.startsWith('pending_'))?<Feedback tone="info">You already have a provider request under review. Cancel it below before starting another.</Feedback>:providerOptions.length?<form onSubmit={requestProvider} className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-sm font-semibold">Requested provider<select required value={selectedProvider} onChange={e=>setSelectedProvider(e.target.value)} className="mt-1 w-full border p-2.5"><option value="">Choose covered provider</option>{providerOptions.map(provider=><option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label><Field label="Reason or note" value={providerNote} set={setProviderNote}/><button disabled={saving||!selectedProvider} className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Submit request</button></form>:<p className="mt-4 text-sm text-slate-500">{overview?.address?"No alternative provider has confirmed mapped coverage for this address.":"Save your service address to find covered providers."}</p>}
            {providerRequests.length>0&&<div className="mt-6 table-wrap"><table className="text-left"><thead><tr><th>Provider request</th><th>Status</th><th>Date</th><th className="text-right">Action</th></tr></thead><tbody>{providerRequests.map(request=><tr key={request.id}><td><p className="table-primary">{request.current_organization_name?`${request.current_organization_name} → `:""}{request.requested_organization_name}</p><p className="table-secondary">{request.review_note||request.customer_note||"No note"}</p></td><td><Status value={request.status}/><p className="table-secondary">{requestLabel(request.status)}</p></td><td>{new Date(request.created_at).toLocaleDateString('en-GB')}</td><td><div className="table-actions">{request.status.startsWith('pending_')&&<button disabled={saving} onClick={()=>cancelProviderRequest(request.id)} className="border border-slate-300 px-3 text-slate-700">Cancel</button>}</div></td></tr>)}</tbody></table></div>}
          </div>
          {!overview ? <EmptyState title="No service location yet" description="Save your address, then arrange provider onboarding. Saving an address does not assign a new company."/> : <>
            <div className="border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-[#3156a3]">Responsible provider</p><h2 className="mt-2 text-2xl font-semibold">{overview.organization_name || "Awaiting provider onboarding"}</h2></div><Status value={overview.service_status}/></div>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="font-bold text-slate-500">Service zone</dt><dd className="mt-1 font-black">{overview.zone_name || "Not matched"}</dd></div><div><dt className="font-bold text-slate-500">Property</dt><dd className="mt-1 font-black capitalize">{label(overview.customer_type)}</dd></div><div><dt className="font-bold text-slate-500">Address</dt><dd className="mt-1 font-black">{overview.address}</dd></div><div><dt className="font-bold text-slate-500">Provider contact</dt><dd className="mt-1 font-black">{overview.organization_phone || "Not supplied"}</dd></div></dl>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="border border-slate-200 bg-white p-6"><h2 className="text-xl font-black">Your next pickup</h2>{overview.upcoming_collection ? <div className="mt-4"><p className="text-3xl font-black text-emerald-700">{new Date(overview.upcoming_collection.job_date).toLocaleDateString("en-GB",{day:"2-digit",month:"short"})}</p><p className="mt-2 text-sm capitalize">{label(overview.upcoming_collection.waste_type)} · {label(overview.upcoming_collection.status)}</p></div> : <p className="mt-4 text-sm text-slate-500">No customer pickup has been planned yet.</p>}</div>
              <div className="border border-slate-200 bg-white p-6"><h2 className="text-xl font-black">Schedules</h2>{overview.schedules.length ? <div className="mt-3 divide-y">{overview.schedules.map((schedule)=><div key={schedule.id} className="py-3"><p className="font-black">{schedule.name}</p><p className="text-sm capitalize text-slate-500">{label(schedule.frequency)}{schedule.preferred_time ? ` · ${schedule.preferred_time}` : ""}</p></div>)}</div> : <p className="mt-4 text-sm text-slate-500">No active schedule for this zone.</p>}</div>
            </div>
            <div className="border border-slate-200 bg-white"><h2 className="border-b p-5 text-xl font-black">Your pickup history</h2><p className="px-5 py-3 text-sm text-slate-600">These records belong to your service location. Completed entries are household-level service records, not general area activity.</p>{overview.collection_history.length ? <div className="table-wrap"><table className="text-left"><thead><tr><th>Collection</th><th>Date</th><th>Status</th></tr></thead><tbody>{overview.collection_history.map((collection)=><tr key={collection.id}><td className="table-primary capitalize">{label(collection.waste_type)} collection</td><td>{new Date(collection.job_date).toLocaleDateString("en-GB")}</td><td><span className={`status status-${collection.status.replaceAll("_","-")}`}>{label(collection.status)}</span></td></tr>)}</tbody></table></div> : <p className="p-5 text-sm text-slate-500">No customer pickup history yet.</p>}</div>
          </>}
        </section>
      </div>
    ) : (
      <div className="py-8">
      <Modal open={showCustomerForm&&isCompanyAdmin} onClose={()=>!saving&&setShowCustomerForm(false)} title="Register service customer" description="Complete the account and service location once. The contract and billing step follows after registration."><form onSubmit={createCustomer}><p className="mb-3 text-xs font-semibold uppercase tracking-[.14em] text-[#3156a3]">1 · Customer account</p><div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" value={customerForm.fullName} set={v=>setCustomerForm({...customerForm,fullName:v})} required/><Field label="Email address" value={customerForm.email} set={v=>setCustomerForm({...customerForm,email:v})} type="email" required/><Field label="Phone number" value={customerForm.phone} set={v=>setCustomerForm({...customerForm,phone:v})}/><div/><Field label="Temporary password" value={customerForm.password} set={v=>setCustomerForm({...customerForm,password:v})} type="password" required minLength={8}/><Field label="Confirm password" value={customerForm.confirmPassword} set={v=>setCustomerForm({...customerForm,confirmPassword:v})} type="password" required minLength={8}/>
      </div><p className="mb-3 mt-6 border-t pt-5 text-xs font-semibold uppercase tracking-[.14em] text-[#3156a3]">2 · Service location</p><div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Customer type<select value={customerForm.customerType} onChange={e=>setCustomerForm({...customerForm,customerType:e.target.value})} className="mt-1 w-full border p-2.5"><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="office_business">Office / business</option><option value="industrial">Industrial</option></select></label><label className="text-sm font-semibold">Service zone<select required value={customerForm.zoneId} onChange={e=>setCustomerForm({...customerForm,zoneId:e.target.value})} className="mt-1 w-full border p-2.5"><option value="">Choose the customer’s zone</option>{zones.map(zone=><option key={zone.id} value={zone.id}>{zone.division_name?`${zone.division_name} → `:""}{zone.name}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Zones are prepared under Service Areas.</span></label><Field label="Location name" value={customerForm.locationLabel} set={v=>setCustomerForm({...customerForm,locationLabel:v})} required/><Field label="Service address" value={customerForm.address} set={v=>setCustomerForm({...customerForm,address:v})} required minLength={5}/>
        <Field label="Latitude (optional)" value={customerForm.latitude} set={v=>setCustomerForm({...customerForm,latitude:v})} type="number"/><Field label="Longitude (optional)" value={customerForm.longitude} set={v=>setCustomerForm({...customerForm,longitude:v})} type="number"/>
      </div><button type="button" onClick={captureCustomerLocation} className="mt-3 text-sm font-semibold text-[#3156a3]">Use current device location</button>{!zones.length&&<Feedback tone="warning">No active service zone is ready. Set up a zone before registering a customer.</Feedback>}<div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4"><button type="button" disabled={saving} onClick={()=>setShowCustomerForm(false)} className="border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button><button disabled={saving||!zones.length} className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?"Creating account…":"Register customer"}</button></div></form></Modal>
      {isCompanyAdmin&&<section className="mb-10"><div className="pb-3"><h2 className="text-xl font-semibold">Provider review queue</h2><p className="mt-1 text-sm text-slate-500">Release current customers only after agreements and balances are closed. Accept new customers only after the address still passes mapped coverage.</p></div>{providerRequests.length?<div className="table-wrap"><table className="min-w-[860px] text-left"><thead><tr><th>Customer</th><th>Provider change</th><th>Status</th><th>Requested</th><th className="text-right">Review</th></tr></thead><tbody>{providerRequests.map(request=><tr key={request.id}><td><p className="table-primary">{request.customer_name}</p><p className="table-secondary">{request.customer_email} · {request.address}</p></td><td>{request.current_organization_name||"Not assigned"} → {request.requested_organization_name}</td><td><Status value={request.status}/><p className="table-secondary">{requestLabel(request.status)}</p></td><td>{new Date(request.created_at).toLocaleDateString('en-GB')}</td><td><div className="table-actions">{request.organization_action&&<><button disabled={saving} onClick={()=>reviewProviderRequest(request,'reject')} className="border border-slate-300 px-3 text-slate-700">Reject</button><button disabled={saving} onClick={()=>reviewProviderRequest(request,'approve')} className="border border-[#3156a3] px-3 text-[#3156a3]">{request.organization_action==='review_release'?'Release':'Accept'}</button></>}</div></td></tr>)}</tbody></table></div>:<EmptyState title="No provider requests" description="Requests requiring this organization’s review will appear here."/>}</section>}
      <section><div className="pb-3"><h2 className="text-xl font-semibold">Registered service customers</h2><p className="mt-1 text-sm text-slate-500">Customers connected to this organization.</p></div>{customers.length>0&&<div className="table-toolbar"><input type="search" aria-label="Search customers" value={query} onChange={e=>{setQuery(e.target.value);pages.setPage(1)}} placeholder="Search customer, address or zone" className="table-search"/><span className="table-count">{filteredCustomers.length} results</span></div>}
        {filteredCustomers.length ? <><div className="table-wrap"><table className="min-w-[1040px] text-left"><thead><tr><th>Customer</th><th>Type</th><th>Service area</th><th>Relationship</th><th>Contract & planning</th>{isCompanyAdmin&&<th className="text-right">Action</th>}</tr></thead><tbody>{pages.paged.map((customer)=><tr key={customer.id}><td><p className="table-primary">{customer.full_name}</p><p className="table-secondary">{customer.customer_number} · {customer.email}</p><p className="table-secondary">{customer.address||"No address"}</p></td><td className="capitalize">{label(customer.customer_type)}</td><td>{customer.zone_name||"Coverage review"}</td><td><Status value={customer.relationship_status}/><p className="table-secondary">{customer.organization_name} · since {new Date(customer.relationship_started_on).toLocaleDateString("en-GB")}</p><p className="table-secondary">Service: {label(customer.service_status)}</p></td><td><p className={`text-xs font-semibold ${customer.planning_ready?"text-emerald-700":"text-amber-700"}`}>{customer.planning_ready?"Ready for route planning":"Setup incomplete"}</p><p className="table-secondary">Contract: {customer.latest_contract_status?label(customer.latest_contract_status):"not created"}</p><p className="table-secondary">{(customer.planning_reasons||[]).join(" · ")||"Coverage, service and agreement checks passed"}</p></td>{isCompanyAdmin&&<td><div className="table-actions">{!customer.agreement_confirmed&&<a href={`/dashboard/contracts?customerId=${customer.id}`} className="border border-[#3156a3] px-3 py-2 text-xs font-semibold text-[#3156a3]">{customer.latest_contract_status==="draft"?"Review contract":"Create contract"}</a>}{customer.service_status==="active"?<button disabled={saving} onClick={()=>changeCustomerStatus(customer,"suspended")} className="border border-red-300 px-3 text-red-700">Suspend</button>:<button disabled={saving} onClick={()=>changeCustomerStatus(customer,"active")} className="border border-[#3156a3] px-3 text-[#3156a3]">Activate</button>}</div></td>}</tr>)}</tbody></table></div><Pagination page={pages.page} pageSize={pages.pageSize} total={pages.total} totalPages={pages.totalPages} onPage={pages.setPage} onPageSize={pages.setPageSize}/></> : customers.length?<EmptyState title="No customers match this search" description="Try a name, email, address or service zone."/>:<EmptyState title="No service customers" description="Add the first customer to connect contracts, billing and collections." action={isCompanyAdmin?<button onClick={()=>setShowCustomerForm(true)} className="bg-[#3156a3] px-4 py-2 text-sm font-semibold text-white">Add first customer</button>:undefined}/>}</section>
      </div>
    )}
  </div></AppShell>;
}

function Field({label,value,set,type="text",required=false,minLength}:{label:string;value:string;set:(value:string)=>void;type?:string;required?:boolean;minLength?:number}){return <label className="text-sm font-semibold">{label}<input value={value} onChange={e=>set(e.target.value)} type={type} required={required} minLength={minLength} step={type==="number"?"any":undefined} className="mt-1 w-full border p-2.5"/></label>}

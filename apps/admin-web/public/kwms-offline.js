const CACHE="kwms-application-v4";
const CORE_ROUTES=["/","/login","/dashboard","/dashboard/account","/dashboard/access","/dashboard/account-applications","/dashboard/account-verification","/dashboard/accounts-payable","/dashboard/billing","/dashboard/citizen-issues","/dashboard/city-reports","/dashboard/company","/dashboard/company-settings","/dashboard/compliance","/dashboard/contracts","/dashboard/customer-service","/dashboard/driver-mobile","/dashboard/fleet","/dashboard/gis","/dashboard/inventory","/dashboard/organizations","/dashboard/payroll","/dashboard/permits","/dashboard/platform-packages","/dashboard/platform-users","/dashboard/procurement","/dashboard/recycling","/dashboard/recycling-field","/dashboard/recycling-reports","/dashboard/reports","/dashboard/service-areas","/dashboard/team","/dashboard/tonnage","/dashboard/waste","/dashboard/weighbridge","/dashboard/weighbridge-workers","/dashboard/weighbridge/operations"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>Promise.allSettled(CORE_ROUTES.map(route=>cache.add(route)))));self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE&&key.startsWith("kwms-application-")).map(key=>caches.delete(key)))));self.clients.claim();});
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}
  catch{
   const direct=await cache.match(request,{ignoreSearch:true});
   if(direct)return direct;
   if(request.mode==="navigate")return(await cache.match(url.pathname,{ignoreSearch:true}))||(await cache.match("/dashboard"))||(await cache.match("/login"));
   return Response.error();
  }
 })());
});

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export async function queueDesktopOperation(input:{endpoint:string;method:"POST"|"PUT"|"PATCH";body:unknown;organizationId:string;userId:string}){
  if(typeof window==="undefined"||!window.kwmsDesktop)throw new Error("Offline saving is available only in the Kampala WMS desktop application");
  return window.kwmsDesktop.queue(input);
}

export async function queueDesktopWhenUnavailable(failure:unknown,input:{endpoint:string;method:"POST"|"PUT"|"PATCH";body:unknown}){
  const unavailable=failure instanceof Error&&failure.message.includes("temporarily unavailable");
  if(!unavailable||typeof window==="undefined"||!window.kwmsDesktop)throw failure;
  const user=JSON.parse(sessionStorage.getItem("currentUser")||"{}");
  if(!user.id||!user.organizationId)throw failure;
  await queueDesktopOperation({...input,organizationId:user.organizationId,userId:user.id});
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  hasRefreshed = false,
): Promise<T> {
  const accessToken = typeof window === "undefined" ? null : sessionStorage.getItem("accessToken");
  let response: Response;
  const method=(options.method||"GET").toUpperCase();
  const desktop=typeof window!=="undefined"&&window.kwmsDesktop
    ? window.kwmsDesktop as typeof window.kwmsDesktop&{
        centralApiRequest:(input:{path:string;method?:string;headers?:Record<string,string>;body?:string|null})=>Promise<{status:number;headers:Record<string,string>;body:string}>;
        getCachedApiResponse:(path:string)=>Promise<{data:unknown}|null>;
        cacheApiResponse:(path:string,data:unknown)=>Promise<boolean>;
      }
    : null;

  // The installed application talks to the central API through Electron's main
  // process. This preserves the authenticated session and avoids the embedded
  // Next.js proxy turning a valid login into a redirect loop.
  if(desktop&&(options.body==null||typeof options.body==="string")){
    try{
      const inputHeaders:Record<string,string>={};
      new Headers(options.headers||{}).forEach((value,key)=>{if(key.toLowerCase()!=="authorization")inputHeaders[key]=value;});
      const result=await desktop.centralApiRequest({path,method,headers:inputHeaders,body:typeof options.body==="string"?options.body:null});
      const raw=result.body;
      let data:{message?:string}&Record<string,unknown>;
      try{data=raw?JSON.parse(raw):{};}catch{data={message:raw||`Service returned ${result.status}`};}
      if(result.status<200||result.status>=300){
        if(result.status===401){
          sessionStorage.removeItem("accessToken");sessionStorage.removeItem("refreshToken");sessionStorage.removeItem("currentUser");
          if(window.location.pathname!=="/login"&&!window.location.pathname.startsWith("/my"))window.location.href="/login";
        }
        throw new Error(`KWMS_HTTP_${result.status}:${typeof data.message==="string"?data.message:"The request could not be completed. Please try again."}`);
      }
      if(method==="GET")void desktop.cacheApiResponse(path,data).catch(()=>undefined);
      return data as T;
    }catch(failure){
      if(failure instanceof Error&&failure.message.startsWith("KWMS_HTTP_"))throw new Error(failure.message.slice(failure.message.indexOf(":")+1));
      if(method==="GET"){
        const cached=await desktop.getCachedApiResponse(path).catch(()=>null);
        if(cached)return cached.data as T;
      }
      if(["POST","PUT","PATCH"].includes(method)){
        const body=typeof options.body==="string"&&options.body?JSON.parse(options.body):{};
        const queued=await desktop.queueOffline({endpoint:path,method:method as "POST"|"PUT"|"PATCH",body});
        return {success:true,message:"Saved on this computer. It will synchronize automatically when the server is available.",data:{id:queued.id,...body},offlineQueued:true} as T;
      }
      if(failure instanceof Error&&/invalid email|password|unauthor/i.test(failure.message))throw failure;
      throw new Error("The platform service is temporarily unavailable. Please try again.");
    }
  }
  for(let attempt=0;;attempt++){
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        cache: method==="GET"?"no-store":options.cache,
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(options.headers || {}),
        },
      });
      if(method==="GET"&&attempt===0&&[502,503,504].includes(response.status)){
        await new Promise(resolve=>setTimeout(resolve,300));
        continue;
      }
      break;
    } catch {
      if(method==="GET"&&attempt===0){await new Promise(resolve=>setTimeout(resolve,300));continue;}
      if(method==="GET"&&typeof window!=="undefined"&&window.kwmsDesktop){
        const desktop=window.kwmsDesktop as typeof window.kwmsDesktop&{getCachedApiResponse:(path:string)=>Promise<{data:unknown}|null>};
        const cached=await desktop.getCachedApiResponse(path).catch(()=>null);
        if(cached)return cached.data as T;
      }
      throw new Error("The platform service is temporarily unavailable. Please try again.");
    }
  }

  if(response.status===401&&typeof window!=="undefined"&&path!=="/api/auth/refresh"&&!hasRefreshed){
    const refreshToken=sessionStorage.getItem("refreshToken");
    if(refreshToken){
      try{
        const refreshed=await fetch(`${API_BASE_URL}/api/auth/refresh`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refreshToken})});
        if(refreshed.ok){
          const payload=await refreshed.json() as{data:{user:{id:string;fullName:string;email:string;organizationId:string|null};roles:{name:string}[];tokens:{accessToken:string;refreshToken:string}}};
          sessionStorage.setItem("accessToken",payload.data.tokens.accessToken);sessionStorage.setItem("refreshToken",payload.data.tokens.refreshToken);sessionStorage.setItem("currentUser",JSON.stringify({...payload.data.user,roles:payload.data.roles.map(role=>role.name)}));
          return apiRequest<T>(path,options,true);
        }
      }catch{/* Fall through to secure session revocation. */}
    }
  }

  const responseType = response.headers.get("content-type") || "";
  const raw = await response.text();
  let data: { message?: string } & Record<string, unknown>;
  try {
    data = responseType.includes("application/json") && raw
      ? JSON.parse(raw)
      : { message: raw || `Service returned ${response.status}` };
  } catch {
    data = { message: raw || "The service returned an unreadable response" };
  }

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      try{const user=JSON.parse(sessionStorage.getItem("currentUser")||"{}");if(user.id)void window.kwmsDesktop?.revokeOfflineAuth(user.id);}catch{}
      sessionStorage.removeItem("accessToken");
      sessionStorage.removeItem("refreshToken");
      sessionStorage.removeItem("currentUser");
      // Households on /my sign in again on that page; everyone else goes to the staff sign-in.
      if (window.location.pathname !== "/login" && !window.location.pathname.startsWith("/my")) window.location.href = "/login";
    }
    const responseMessage =
      typeof data?.message === "string" ? data.message.trim() : "";
    const isUnavailable =
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504 ||
      /trying to proxy|econnrefused|connect econn|socket hang up|localhost:\d+/i.test(
        responseMessage,
      );

    if(method==="GET"&&isUnavailable&&typeof window!=="undefined"&&window.kwmsDesktop){
      const desktop=window.kwmsDesktop as typeof window.kwmsDesktop&{getCachedApiResponse:(path:string)=>Promise<{data:unknown}|null>};
      const cached=await desktop.getCachedApiResponse(path).catch(()=>null);
      if(cached)return cached.data as T;
    }

    throw new Error(
      isUnavailable
        ? "The platform service is temporarily unavailable. Please try again."
        : responseMessage || "The request could not be completed. Please try again.",
    );
  }

  if(method==="GET"&&typeof window!=="undefined"&&window.kwmsDesktop){
    const desktop=window.kwmsDesktop as typeof window.kwmsDesktop&{cacheApiResponse:(path:string,data:unknown)=>Promise<boolean>};
    void desktop.cacheApiResponse(path,data).catch(()=>undefined);
  }
  return data as T;
}

/** Opens or downloads a file from an authenticated endpoint (certificates, evidence). */
export async function openAuthenticatedFile(path:string,options:{download?:string}={}){
  const token=sessionStorage.getItem("accessToken");
  const response=await fetch(`${API_BASE_URL}${path}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok){const body=await response.json().catch(()=>({message:"The file could not be opened"}));throw new Error(body.message||"The file could not be opened");}
  const url=URL.createObjectURL(await response.blob());
  if(options.download){const link=document.createElement("a");link.href=url;link.download=options.download;link.click();}
  else window.open(url,"_blank","noopener,noreferrer");
  window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}

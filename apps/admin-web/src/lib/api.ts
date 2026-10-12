const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const accessToken = typeof window === "undefined" ? null : sessionStorage.getItem("accessToken");
  let response: Response;
  const method=(options.method||"GET").toUpperCase();
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
      throw new Error("The platform service is temporarily unavailable. Please try again.");
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
      sessionStorage.removeItem("accessToken");
      sessionStorage.removeItem("refreshToken");
      sessionStorage.removeItem("currentUser");
      if (window.location.pathname !== "/login") window.location.href = "/login";
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

    throw new Error(
      isUnavailable
        ? "The platform service is temporarily unavailable. Please try again."
        : responseMessage || "The request could not be completed. Please try again.",
    );
  }

  return data as T;
}

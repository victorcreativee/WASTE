const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8090";

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const accessToken = typeof window === "undefined" ? null : sessionStorage.getItem("accessToken");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {}),
    },
  });

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
    throw new Error(data.message || "API request failed");
  }

  return data as T;
}

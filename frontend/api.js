export const API_BASE =
  (window.APP_CONFIG?.API_BASE_URL || "").replace(/\/+$/, "");

export function apiUrl(path) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
}

export async function apiFetch(path, options = {}) {
  const url = apiUrl(path);

  const finalOptions = {
    credentials: "include",
    ...options,
    headers: {
      ...(options.headers || {})
    }
  };

  return fetch(url, finalOptions);
}
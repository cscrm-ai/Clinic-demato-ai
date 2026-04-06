// ─── Cookie utilities ──────────────────────────────────────────────────────
export function getCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(
    new RegExp("(^| )" + name + "=([^;]+)")
  );
  return match ? decodeURIComponent(match[2]) : "";
}

export function setCookie(name: string, value: string, days = 7) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
}

export function deleteCookie(name: string) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
}

export function getToken(): string {
  return getCookie("sb-access-token");
}

// ─── Fetch wrapper ──────────────────────────────────────────────────────────
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
}

// ─── Clinic config types ────────────────────────────────────────────────────
export interface ClinicColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

export interface ClinicFooter {
  phone: string;
  instagram: string;
  address: string;
}

export interface Procedure {
  nome: string;
  tipo: string;
  marca: string;
  video: string;
  ativo: boolean;
  padrao: boolean;
}

export interface ClinicConfig {
  clinic_name: string;
  welcome_text: string;
  logo_url: string;
  colors: ClinicColors;
  font: string;
  footer: ClinicFooter;
  disclaimer: string;
  analyses_count: number;
  videos: string[];
  procedures_catalog: Procedure[];
  _font_options?: string[];
}

// ─── Apply branding CSS vars ────────────────────────────────────────────────
export function applyBranding(cfg: ClinicConfig) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--color-primary", cfg.colors.primary);
  root.style.setProperty("--color-secondary", cfg.colors.secondary);
  root.style.setProperty("--color-accent", cfg.colors.accent);
  root.style.setProperty("--color-background", cfg.colors.background);
  root.style.setProperty("--color-text", cfg.colors.text);
}

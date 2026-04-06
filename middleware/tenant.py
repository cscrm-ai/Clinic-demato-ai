"""Middleware de resolução de tenant por subdomínio.

Extrai o subdomínio do header Host, resolve a clínica no Supabase
(com cache em memória de 60s) e injeta em request.state.clinic.

Subdomínios reservados (admin, www, api, app) não resolvem como clínica.
O subdomínio 'admin' marca a request como super portal.
"""

import os
import time
from typing import Any

from fastapi import Request
from fastapi.responses import HTMLResponse
from starlette.middleware.base import BaseHTTPMiddleware

from db.supabase_client import get_clinic_by_subdomain

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

APP_BASE_DOMAIN = os.environ.get("APP_BASE_DOMAIN", "cscrm.ai")

# Subdomínios que não representam clínicas
RESERVED_SUBDOMAINS = {"admin", "www", "api", "app"}

# Rotas que não precisam de tenant resolvido
EXEMPT_PREFIXES = (
    "/webhooks/",
    "/health",
    "/api/auth/",
    "/api/super/",
    "/super",
    "/static/",
    "/favicon",
)

# Cache em memória: subdomain -> (clinic_dict, expires_at)
_tenant_cache: dict[str, tuple[dict, float]] = {}
CACHE_TTL = 60  # segundos


# ---------------------------------------------------------------------------
# Helpers de cache
# ---------------------------------------------------------------------------

def _cache_get(subdomain: str) -> dict | None:
    """Retorna clínica do cache se ainda válida."""
    entry = _tenant_cache.get(subdomain)
    if entry and time.monotonic() < entry[1]:
        return entry[0]
    return None


def _cache_set(subdomain: str, clinic: dict) -> None:
    """Armazena clínica no cache com TTL."""
    _tenant_cache[subdomain] = (clinic, time.monotonic() + CACHE_TTL)


def invalidate_tenant_cache(subdomain: str) -> None:
    """Remove entradas do cache (chamar após update de config da clínica)."""
    _tenant_cache.pop(subdomain, None)


# ---------------------------------------------------------------------------
# Extração do subdomínio
# ---------------------------------------------------------------------------

def _extract_subdomain(host: str) -> str | None:
    """Extrai subdomínio do header Host.

    Regras:
    - localhost / 127.0.0.1 → None (usa query param ?tenant=X)
    - *.vercel.app           → None (usa query param ?tenant=X)
    - {sub}.{APP_BASE_DOMAIN} → retorna sub
    - Outros hosts           → None
    """
    # Remove porta se presente
    host = host.split(":")[0].lower().strip()

    if host in ("localhost", "127.0.0.1", "0.0.0.0"):
        return None

    if host.endswith(".vercel.app"):
        return None

    base = APP_BASE_DOMAIN.lower()
    if host.endswith(f".{base}"):
        sub = host[: -(len(base) + 1)]
        return sub if sub else None

    return None


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

class TenantMiddleware(BaseHTTPMiddleware):
    """Resolve tenant por subdomínio e injeta em request.state."""

    async def dispatch(self, request: Request, call_next):
        # Inicializa state com defaults
        request.state.clinic = None
        request.state.is_super_portal = False

        # Rotas isentas — passa direto
        path = request.url.path
        if any(path.startswith(prefix) for prefix in EXEMPT_PREFIXES):
            return await call_next(request)

        host = request.headers.get("host", "")
        subdomain = _extract_subdomain(host)

        # Desenvolvimento local / Vercel preview → usa query param ?tenant=
        if subdomain is None:
            subdomain = request.query_params.get("tenant")

        # Sem subdomínio identificável → passa sem tenant (serve index genérico)
        if not subdomain:
            return await call_next(request)

        # Subdomínio reservado "admin" → super portal
        base = APP_BASE_DOMAIN.lower()
        if subdomain == "admin" or host.lower() == f"admin.{base}":
            request.state.is_super_portal = True
            return await call_next(request)

        # Outros subdomínios reservados → 404 direto
        if subdomain in RESERVED_SUBDOMAINS:
            return HTMLResponse(
                content="<h1>404 — Página não encontrada</h1>",
                status_code=404,
            )

        # Resolve clínica com cache
        clinic = _cache_get(subdomain)
        if clinic is None:
            try:
                clinic = get_clinic_by_subdomain(subdomain)
            except Exception as exc:
                print(f"[TENANT] Erro ao resolver subdomínio '{subdomain}': {exc}")
                clinic = None

            if clinic:
                _cache_set(subdomain, clinic)

        # Clínica não encontrada
        if not clinic:
            return HTMLResponse(
                content="""
                <html><head><title>Clínica não encontrada</title></head>
                <body style="font-family:sans-serif;text-align:center;padding:4rem">
                    <h1>Clínica não encontrada</h1>
                    <p>O endereço <strong>{subdomain}.{base}</strong> não existe ou foi removido.</p>
                </body></html>
                """.format(subdomain=subdomain, base=APP_BASE_DOMAIN),
                status_code=404,
            )

        # Clínica suspensa
        if clinic.get("status") == "suspended":
            return HTMLResponse(
                content="""
                <html><head><title>Conta suspensa</title></head>
                <body style="font-family:sans-serif;text-align:center;padding:4rem">
                    <h1>Conta suspensa</h1>
                    <p>Esta clínica está temporariamente suspensa. Entre em contato com o suporte.</p>
                </body></html>
                """,
                status_code=403,
            )

        # Injeta clínica na request
        request.state.clinic = clinic
        return await call_next(request)

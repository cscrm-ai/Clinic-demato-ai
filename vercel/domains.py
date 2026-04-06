"""Integração com Vercel API para gerenciamento automático de domínios.

Adiciona/remove domínios de subdomínios de clínicas no projeto Vercel.
Necessário porque wildcard *.allbele.app não funciona com nameservers externos (Cloudflare).
"""

import os
import httpx

VERCEL_TOKEN      = os.environ.get("VERCEL_TOKEN", "").strip()
VERCEL_PROJECT_ID = os.environ.get("VERCEL_PROJECT_ID", "prj_pjm5GRolxUUvurq8xRkL9YT8lBj1").strip()
VERCEL_TEAM_ID    = os.environ.get("VERCEL_TEAM_ID", "team_btZscduNUAy6bL3SIFD0a0QD").strip()
VERCEL_API_BASE   = "https://api.vercel.com"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {VERCEL_TOKEN}",
        "Content-Type":  "application/json",
    }


def _available() -> bool:
    return bool(VERCEL_TOKEN)


def add_clinic_domain(subdomain: str) -> dict:
    """Adiciona {subdomain}.allbele.app ao projeto Vercel.

    Retorna dict com {ok, message}.
    Se VERCEL_TOKEN não estiver configurado, retorna {ok: False, skipped: True}.
    """
    if not _available():
        return {"ok": False, "skipped": True, "message": "VERCEL_TOKEN não configurado"}

    base_domain = os.environ.get("APP_BASE_DOMAIN", "allbele.app")
    full_domain = f"{subdomain}.{base_domain}"

    params = {}
    if VERCEL_TEAM_ID:
        params["teamId"] = VERCEL_TEAM_ID

    try:
        resp = httpx.post(
            f"{VERCEL_API_BASE}/v10/projects/{VERCEL_PROJECT_ID}/domains",
            headers=_headers(),
            params=params,
            json={"name": full_domain},
            timeout=10,
        )
        data = resp.json()
        if resp.status_code in (200, 201):
            print(f"[VERCEL] Domínio adicionado: {full_domain}")
            return {"ok": True, "message": f"Domínio {full_domain} adicionado ao Vercel"}
        elif resp.status_code == 409:
            # Já existe
            print(f"[VERCEL] Domínio já existe: {full_domain}")
            return {"ok": True, "message": "Domínio já existe no Vercel"}
        else:
            error = data.get("error", {}).get("message", str(data))
            print(f"[VERCEL] Erro ao adicionar domínio '{full_domain}': {error}")
            return {"ok": False, "message": error}
    except Exception as e:
        print(f"[VERCEL] Exceção ao adicionar domínio '{full_domain}': {e}")
        return {"ok": False, "message": str(e)}


def remove_clinic_domain(subdomain: str) -> dict:
    """Remove {subdomain}.allbele.app do projeto Vercel.

    Retorna dict com {ok, message}.
    """
    if not _available():
        return {"ok": False, "skipped": True, "message": "VERCEL_TOKEN não configurado"}

    base_domain = os.environ.get("APP_BASE_DOMAIN", "allbele.app")
    full_domain = f"{subdomain}.{base_domain}"

    params = {}
    if VERCEL_TEAM_ID:
        params["teamId"] = VERCEL_TEAM_ID

    try:
        resp = httpx.delete(
            f"{VERCEL_API_BASE}/v10/projects/{VERCEL_PROJECT_ID}/domains/{full_domain}",
            headers=_headers(),
            params=params,
            timeout=10,
        )
        if resp.status_code == 200:
            print(f"[VERCEL] Domínio removido: {full_domain}")
            return {"ok": True, "message": f"Domínio {full_domain} removido do Vercel"}
        elif resp.status_code == 404:
            return {"ok": True, "message": "Domínio não encontrado (já removido)"}
        else:
            data = resp.json()
            error = data.get("error", {}).get("message", str(data))
            print(f"[VERCEL] Erro ao remover domínio '{full_domain}': {error}")
            return {"ok": False, "message": error}
    except Exception as e:
        print(f"[VERCEL] Exceção ao remover domínio '{full_domain}': {e}")
        return {"ok": False, "message": str(e)}

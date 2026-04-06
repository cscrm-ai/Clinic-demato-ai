"""Integração com Cloudflare API para gerenciamento automático de DNS.

Cria/remove registros CNAME para subdomínios de clínicas automaticamente.
"""

import os
import httpx

CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
CLOUDFLARE_ZONE_ID   = os.environ.get("CLOUDFLARE_ZONE_ID", "").strip()
CLOUDFLARE_API_BASE  = "https://api.cloudflare.com/client/v4"

VERCEL_CNAME_TARGET  = "cname.vercel-dns.com"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type":  "application/json",
    }


def _available() -> bool:
    """Retorna True se as credenciais Cloudflare estão configuradas."""
    return bool(CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID)


# ---------------------------------------------------------------------------
# Criar registro CNAME para nova clínica
# ---------------------------------------------------------------------------

def create_clinic_dns(subdomain: str) -> dict:
    """Cria CNAME {subdomain}.allbele.app → cname.vercel-dns.com.

    Retorna dict com {ok, record_id, message}.
    Se as credenciais não estiverem configuradas, retorna {ok: False, skipped: True}.
    """
    if not _available():
        return {"ok": False, "skipped": True, "message": "Cloudflare não configurado"}

    # Verifica se já existe
    existing = _find_record(subdomain)
    if existing:
        return {"ok": True, "record_id": existing["id"], "message": "Registro já existe"}

    try:
        resp = httpx.post(
            f"{CLOUDFLARE_API_BASE}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
            headers=_headers(),
            json={
                "type":    "CNAME",
                "name":    subdomain,
                "content": VERCEL_CNAME_TARGET,
                "ttl":     1,       # Auto
                "proxied": False,   # DNS only — Vercel precisa que proxy esteja off
            },
            timeout=10,
        )
        data = resp.json()
        if data.get("success"):
            record_id = data["result"]["id"]
            print(f"[DNS] CNAME criado: {subdomain} → {VERCEL_CNAME_TARGET} (id={record_id})")
            return {"ok": True, "record_id": record_id, "message": "CNAME criado"}
        else:
            errors = data.get("errors", [])
            print(f"[DNS] Erro ao criar CNAME '{subdomain}': {errors}")
            return {"ok": False, "message": str(errors)}
    except Exception as e:
        print(f"[DNS] Exceção ao criar CNAME '{subdomain}': {e}")
        return {"ok": False, "message": str(e)}


# ---------------------------------------------------------------------------
# Remover registro ao deletar clínica
# ---------------------------------------------------------------------------

def delete_clinic_dns(subdomain: str) -> dict:
    """Remove o CNAME de uma clínica do Cloudflare.

    Retorna dict com {ok, message}.
    """
    if not _available():
        return {"ok": False, "skipped": True, "message": "Cloudflare não configurado"}

    record = _find_record(subdomain)
    if not record:
        return {"ok": True, "message": "Registro não encontrado (já removido)"}

    try:
        resp = httpx.delete(
            f"{CLOUDFLARE_API_BASE}/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record['id']}",
            headers=_headers(),
            timeout=10,
        )
        data = resp.json()
        if data.get("success"):
            print(f"[DNS] CNAME removido: {subdomain} (id={record['id']})")
            return {"ok": True, "message": "CNAME removido"}
        else:
            return {"ok": False, "message": str(data.get("errors", []))}
    except Exception as e:
        return {"ok": False, "message": str(e)}


# ---------------------------------------------------------------------------
# Helper interno
# ---------------------------------------------------------------------------

def _find_record(subdomain: str) -> dict | None:
    """Busca registro DNS existente pelo nome."""
    base_domain = os.environ.get("APP_BASE_DOMAIN", "allbele.app")
    full_name   = f"{subdomain}.{base_domain}"
    try:
        resp = httpx.get(
            f"{CLOUDFLARE_API_BASE}/zones/{CLOUDFLARE_ZONE_ID}/dns_records",
            headers=_headers(),
            params={"name": full_name, "type": "CNAME"},
            timeout=10,
        )
        data = resp.json()
        records = data.get("result", [])
        return records[0] if records else None
    except Exception:
        return None

"""Camada de acesso ao Supabase — singleton admin (service_role).

Todas as funções usam a service_role key e bypassam RLS de propósito.
As policies de RLS existem para proteger acessos diretos via anon key
no frontend — o backend nunca usa a anon key.
"""

import os
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

from supabase import Client, create_client

# ---------------------------------------------------------------------------
# Singleton do client admin
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_client() -> Client:
    """Retorna o client Supabase autenticado com service_role (singleton)."""
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def get_db() -> Client:
    """Atalho público para obter o client admin."""
    return _get_client()


# ---------------------------------------------------------------------------
# Clínicas (tenants)
# ---------------------------------------------------------------------------

def get_clinic_by_subdomain(subdomain: str) -> dict | None:
    """Busca clínica pelo subdomínio. Retorna dict ou None."""
    db = get_db()
    result = (
        db.table("clinics")
        .select("*, plans(*)")
        .eq("subdomain", subdomain)
        .single()
        .execute()
    )
    return result.data


def get_clinic_by_id(clinic_id: str) -> dict | None:
    """Busca clínica pelo UUID. Retorna dict ou None."""
    db = get_db()
    result = (
        db.table("clinics")
        .select("*, plans(*)")
        .eq("id", clinic_id)
        .single()
        .execute()
    )
    return result.data


def create_clinic(data: dict) -> dict:
    """Cria nova clínica. Retorna o registro criado."""
    db = get_db()
    result = db.table("clinics").insert(data).execute()
    return result.data[0]


def update_clinic(clinic_id: str, patch: dict) -> dict:
    """Atualiza campos de uma clínica. Retorna registro atualizado."""
    db = get_db()
    result = (
        db.table("clinics")
        .update(patch)
        .eq("id", clinic_id)
        .execute()
    )
    return result.data[0]


def list_clinics(filters: dict | None = None) -> list[dict]:
    """Lista todas as clínicas com join no plano. Aceita filtros opcionais."""
    db = get_db()
    query = db.table("clinics").select("*, plans(name, monthly_analyses_limit, price_cents)")
    if filters:
        for key, value in filters.items():
            query = query.eq(key, value)
    result = query.order("created_at", desc=True).execute()
    return result.data or []


# ---------------------------------------------------------------------------
# Análises
# ---------------------------------------------------------------------------

def save_analysis(
    clinic_id: str,
    report: dict,
    image_path: str,
    duration_ms: int,
    total_cost_cents: float,
) -> dict:
    """Salva laudo no banco. Retorna registro com ID gerado."""
    db = get_db()
    record = {
        "clinic_id": clinic_id,
        "fitzpatrick_type": report.get("fitzpatrick_type"),
        "skin_type": report.get("skin_type"),
        "findings": report.get("findings"),
        "plano_terapeutico": report.get("plano_terapeutico"),
        "am_routine": report.get("am_routine"),
        "pm_routine": report.get("pm_routine"),
        "general_observations": report.get("general_observations"),
        "image_path": image_path,
        "duration_ms": duration_ms,
        "total_cost_cents": total_cost_cents,
    }
    result = db.table("analyses").insert(record).execute()
    return result.data[0]


def list_analyses_for_clinic(clinic_id: str, limit: int = 100) -> list[dict]:
    """Retorna análises de uma clínica, ordenadas por data desc."""
    db = get_db()
    result = (
        db.table("analyses")
        .select("*")
        .eq("clinic_id", clinic_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data or []


def delete_analysis(analysis_id: str) -> None:
    """Remove uma análise pelo ID."""
    db = get_db()
    db.table("analyses").delete().eq("id", analysis_id).execute()


# ---------------------------------------------------------------------------
# Eventos de uso (custo de AI)
# ---------------------------------------------------------------------------

def log_usage_event(event: dict) -> None:
    """Grava um evento de uso de AI (Gemini ou Moondream)."""
    db = get_db()
    db.table("usage_events").insert(event).execute()


def get_clinic_usage_stats(clinic_id: str, period: str = "month") -> dict:
    """Retorna estatísticas de uso de uma clínica no período.

    period: 'month' (mês corrente UTC) ou 'all'
    """
    db = get_db()

    # Conta análises do período
    analyses_query = (
        db.table("analyses")
        .select("id", count="exact")
        .eq("clinic_id", clinic_id)
    )
    if period == "month":
        # Início do mês corrente em UTC
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
        analyses_query = analyses_query.gte("created_at", month_start)

    analyses_result = analyses_query.execute()
    analyses_count = analyses_result.count or 0

    # Soma custo total do período
    cost_query = (
        db.table("usage_events")
        .select("cost_cents")
        .eq("clinic_id", clinic_id)
    )
    if period == "month":
        cost_query = cost_query.gte("created_at", month_start)

    cost_result = cost_query.execute()
    total_cost = sum(float(r["cost_cents"]) for r in (cost_result.data or []))

    return {
        "analyses_count": analyses_count,
        "total_cost_cents": round(total_cost, 4),
        "period": period,
    }


def get_super_admin_overview(days: int = 30) -> dict:
    """Retorna visão geral do SaaS para o super admin."""
    db = get_db()

    now = datetime.now(timezone.utc)
    period_start = (now - timedelta(days=days)).isoformat()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    # Total de clínicas ativas
    active = db.table("clinics").select("id", count="exact").eq("status", "active").execute()

    # Análises do período
    analyses = (
        db.table("analyses")
        .select("id", count="exact")
        .gte("created_at", period_start)
        .execute()
    )

    # Custo do período
    costs = (
        db.table("usage_events")
        .select("cost_cents")
        .gte("created_at", period_start)
        .execute()
    )
    total_cost = sum(float(r["cost_cents"]) for r in (costs.data or []))

    # MRR: soma price_cents das clínicas ativas com subscription ativa
    mrr_clinics = (
        db.table("clinics")
        .select("plans(price_cents)")
        .in_("subscription_status", ["active", "trialing"])
        .execute()
    )
    mrr = sum(
        (r.get("plans") or {}).get("price_cents", 0)
        for r in (mrr_clinics.data or [])
    )

    # Inadimplentes
    past_due = (
        db.table("clinics")
        .select("id", count="exact")
        .eq("subscription_status", "past_due")
        .execute()
    )

    # Total de clínicas (todas)
    total = db.table("clinics").select("id", count="exact").execute()

    # Chart: análises por dia no período
    chart_raw = (
        db.table("analyses")
        .select("created_at")
        .gte("created_at", period_start)
        .execute()
    )
    from collections import Counter
    day_counts: Counter[str] = Counter()
    for row in chart_raw.data or []:
        day = row["created_at"][:10]
        day_counts[day] += 1
    chart_data = []
    for i in range(days):
        d = now - timedelta(days=days - 1 - i)
        ds = d.strftime("%Y-%m-%d")
        chart_data.append({"date": ds, "count": day_counts.get(ds, 0)})

    return {
        "active_clinics": active.count or 0,
        "total_clinics": total.count or 0,
        "analyses_period": analyses.count or 0,
        "cost_period_cents": round(total_cost, 2),
        "days": days,
        "mrr_cents": mrr,
        "past_due_clinics": past_due.count or 0,
        "chart_data": chart_data,
    }


# ---------------------------------------------------------------------------
# Storage — imagens de análises e logos
# ---------------------------------------------------------------------------

def upload_analysis_image(clinic_id: str, file_bytes: bytes, filename: str) -> str:
    """Faz upload de imagem de análise para o bucket 'analyses'.

    Retorna o image_path relativo: {clinic_id}/{filename}
    """
    db = get_db()
    path = f"{clinic_id}/{filename}"
    db.storage.from_("analyses").upload(
        path=path,
        file=file_bytes,
        file_options={"content-type": "image/jpeg", "upsert": "true"},
    )
    return path


def get_signed_url(image_path: str, expires_in: int = 3600) -> str:
    """Gera URL assinada temporária para uma imagem de análise."""
    db = get_db()
    result = db.storage.from_("analyses").create_signed_url(image_path, expires_in)
    return result.get("signedURL", "")


def upload_logo(clinic_id: str, file_bytes: bytes, filename: str) -> str:
    """Faz upload de logo para o bucket público 'logos'.

    Retorna a URL pública direta.
    """
    db = get_db()
    path = f"{clinic_id}/{filename}"
    db.storage.from_("logos").upload(
        path=path,
        file=file_bytes,
        file_options={"content-type": "image/png", "upsert": "true"},
    )
    # URL pública — bucket logos é público
    supabase_url = os.environ["SUPABASE_URL"]
    return f"{supabase_url}/storage/v1/object/public/logos/{path}"


# ---------------------------------------------------------------------------
# Auth — JWT e membros
# ---------------------------------------------------------------------------

def verify_jwt(token: str) -> str | None:
    """Valida JWT do Supabase. Retorna user_id (str) ou None se inválido."""
    db = get_db()
    try:
        result = db.auth.get_user(token)
        return str(result.user.id) if result.user else None
    except Exception as exc:
        print(f"[AUTH] JWT inválido: {exc}")
        return None


def is_super_admin(user_id: str) -> bool:
    """Verifica se user_id está na tabela super_admins."""
    db = get_db()
    result = (
        db.table("super_admins")
        .select("user_id")
        .eq("user_id", user_id)
        .execute()
    )
    return bool(result.data)


def get_user_clinic_ids(user_id: str) -> list[str]:
    """Retorna lista de clinic_ids que o usuário pode acessar."""
    db = get_db()
    result = (
        db.table("clinic_members")
        .select("clinic_id")
        .eq("user_id", user_id)
        .execute()
    )
    return [r["clinic_id"] for r in (result.data or [])]


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------

def upsert_invoice(data: dict) -> dict:
    """Insere ou atualiza invoice pelo stripe_invoice_id."""
    db = get_db()
    result = (
        db.table("invoices")
        .upsert(data, on_conflict="stripe_invoice_id")
        .execute()
    )
    return result.data[0]


def list_invoices_for_clinic(clinic_id: str) -> list[dict]:
    """Lista faturas de uma clínica, mais recentes primeiro."""
    db = get_db()
    result = (
        db.table("invoices")
        .select("*")
        .eq("clinic_id", clinic_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


# ---------------------------------------------------------------------------
# Payment events (webhook Stripe)
# ---------------------------------------------------------------------------

def insert_payment_event(data: dict) -> dict:
    """Insere evento de pagamento. Retorna o registro."""
    db = get_db()
    result = db.table("payment_events").insert(data).execute()
    return result.data[0]


def get_payment_event(stripe_event_id: str) -> dict | None:
    """Busca payment_event pelo stripe_event_id (para idempotência)."""
    db = get_db()
    result = (
        db.table("payment_events")
        .select("*")
        .eq("stripe_event_id", stripe_event_id)
        .execute()
    )
    return result.data[0] if result.data else None


def mark_payment_event_processed(event_id: str, error: str | None = None) -> None:
    """Marca evento como processado (ou com erro)."""
    db = get_db()
    patch = {"processed": True}
    if error:
        patch["error"] = error
    db.table("payment_events").update(patch).eq("id", event_id).execute()

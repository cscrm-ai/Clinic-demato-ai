"""Controle de quota de análises por plano.

Regras de bloqueio:
  - subscription_status in ('canceled', 'unpaid')   → bloqueado
  - status = 'suspended'                             → bloqueado
  - analyses >= monthly_limit (plano com limite)     → bloqueado
  - subscription_status = 'past_due'                 → permitido com aviso
"""

import datetime
from typing import Tuple

from db.supabase_client import get_db

# Tipo de retorno: (permitido, motivo, contagem_atual, limite_ou_None)
QuotaResult = Tuple[bool, str, int, int | None]


def check_quota(clinic: dict) -> QuotaResult:
    """Verifica se a clínica pode realizar uma nova análise.

    Retorna (allowed, reason, current_count, monthly_limit).
    """
    status         = clinic.get("status", "trial")
    sub_status     = clinic.get("subscription_status", "trialing")
    plan           = clinic.get("plans") or {}
    monthly_limit  = plan.get("monthly_analyses_limit")  # None = ilimitado

    # Clínica manualmente suspensa pelo super admin
    if status == "suspended":
        return False, "Conta suspensa. Entre em contato com o suporte.", 0, monthly_limit

    # Assinatura cancelada ou inadimplente há muito tempo
    if sub_status in ("canceled", "unpaid"):
        return (
            False,
            "Sua assinatura foi cancelada ou está com pagamento em atraso. "
            "Renove seu plano para continuar.",
            0,
            monthly_limit,
        )

    # Conta análises do mês corrente
    current_count = _count_analyses_this_month(str(clinic["id"]))

    # Plano ilimitado (Enterprise) — sempre permitido
    if monthly_limit is None:
        return True, "ok", current_count, None

    # Limite atingido
    if current_count >= monthly_limit:
        return (
            False,
            f"Limite mensal de {monthly_limit} análises atingido "
            f"({current_count}/{monthly_limit}). Faça upgrade para continuar.",
            current_count,
            monthly_limit,
        )

    # past_due → permitido mas pode ter aviso no frontend
    return True, "ok", current_count, monthly_limit


def get_month_usage(clinic_id: str) -> dict:
    """Retorna dados de uso do mês para exibir no painel admin."""
    db = get_db()

    # Início do mês corrente em UTC
    now         = datetime.datetime.now(datetime.timezone.utc)
    month_start = now.replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ).isoformat()

    # Conta análises
    count_result = (
        db.table("analyses")
        .select("id", count="exact")
        .eq("clinic_id", clinic_id)
        .gte("created_at", month_start)
        .execute()
    )
    analyses_count = count_result.count or 0

    # Soma custo
    cost_result = (
        db.table("usage_events")
        .select("cost_cents")
        .eq("clinic_id", clinic_id)
        .gte("created_at", month_start)
        .execute()
    )
    total_cost = sum(float(r["cost_cents"]) for r in (cost_result.data or []))

    return {
        "analyses_count":    analyses_count,
        "total_cost_cents":  round(total_cost, 4),
        "month_start":       month_start,
        "period":            now.strftime("%B %Y"),
    }


# ---------------------------------------------------------------------------
# Helper interno
# ---------------------------------------------------------------------------

def _count_analyses_this_month(clinic_id: str) -> int:
    """Conta análises do mês corrente em UTC."""
    db = get_db()

    now         = datetime.datetime.now(datetime.timezone.utc)
    month_start = now.replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ).isoformat()

    result = (
        db.table("analyses")
        .select("id", count="exact")
        .eq("clinic_id", clinic_id)
        .gte("created_at", month_start)
        .execute()
    )
    return result.count or 0

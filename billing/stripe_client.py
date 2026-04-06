"""Client Stripe — operações de billing do SaaS.

Todas as funções assumem que STRIPE_SECRET_KEY está configurada.
Chamar init_stripe() antes de usar (feito automaticamente no primeiro import).
"""

import os

import stripe

# ---------------------------------------------------------------------------
# Inicialização
# ---------------------------------------------------------------------------

def init_stripe() -> None:
    """Configura a API key do Stripe a partir das env vars."""
    key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY não configurada.")
    stripe.api_key = key


# Inicializa automaticamente ao importar o módulo
init_stripe()


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------

def create_customer(clinic_id: str, email: str, name: str) -> str:
    """Cria um Customer no Stripe e retorna o stripe_customer_id.

    O metadata clinic_id é fundamental para correlacionar eventos
    de webhook com o tenant correto.
    """
    customer = stripe.Customer.create(
        email=email,
        name=name,
        metadata={"clinic_id": clinic_id},
    )
    return customer.id


# ---------------------------------------------------------------------------
# Checkout — criação de assinatura
# ---------------------------------------------------------------------------

def create_checkout_session(
    clinic: dict,
    plan: dict,
    success_url: str,
    cancel_url: str,
) -> str:
    """Cria sessão de checkout para assinatura e retorna a URL.

    Inclui trial de 14 dias e vincula o metadata clinic_id
    para o webhook poder identificar a clínica.
    """
    params: dict = {
        "mode": "subscription",
        "line_items": [{
            "price":    plan["stripe_price_id"],
            "quantity": 1,
        }],
        "success_url": success_url,
        "cancel_url":  cancel_url,
        "metadata":    {"clinic_id": str(clinic["id"])},
        "subscription_data": {
            "trial_period_days": 14,
            "metadata": {"clinic_id": str(clinic["id"])},
        },
    }

    # Vincula ao customer Stripe existente se disponível
    stripe_customer_id = clinic.get("stripe_customer_id")
    if stripe_customer_id:
        params["customer"] = stripe_customer_id
    else:
        params["customer_email"] = clinic.get("owner_email", "")

    session = stripe.checkout.Session.create(**params)
    return session.url


# ---------------------------------------------------------------------------
# Portal de gerenciamento
# ---------------------------------------------------------------------------

def create_portal_session(clinic: dict, return_url: str) -> str:
    """Cria sessão do portal do cliente Stripe para gerenciar assinatura."""
    stripe_customer_id = clinic.get("stripe_customer_id")
    if not stripe_customer_id:
        raise ValueError(
            f"Clínica '{clinic.get('subdomain')}' não tem stripe_customer_id."
        )

    session = stripe.billing_portal.Session.create(
        customer=stripe_customer_id,
        return_url=return_url,
    )
    return session.url


# ---------------------------------------------------------------------------
# Cancelamento
# ---------------------------------------------------------------------------

def cancel_subscription(
    stripe_subscription_id: str,
    at_period_end: bool = True,
) -> None:
    """Cancela assinatura no Stripe.

    at_period_end=True → cancela no fim do período atual (padrão).
    at_period_end=False → cancela imediatamente.
    """
    if at_period_end:
        stripe.Subscription.modify(
            stripe_subscription_id,
            cancel_at_period_end=True,
        )
    else:
        stripe.Subscription.cancel(stripe_subscription_id)


# ---------------------------------------------------------------------------
# Sync de assinatura (chamado pelo webhook)
# ---------------------------------------------------------------------------

def sync_subscription_from_stripe(stripe_subscription_id: str) -> dict:
    """Busca assinatura no Stripe e atualiza a clínica no banco.

    Retorna o patch aplicado à clínica.
    """
    from db.supabase_client import get_db, update_clinic

    sub = stripe.Subscription.retrieve(stripe_subscription_id)

    # Mapeia status Stripe → subscription_status local
    status_map = {
        "trialing":  "trialing",
        "active":    "active",
        "past_due":  "past_due",
        "canceled":  "canceled",
        "unpaid":    "unpaid",
        "incomplete": "incomplete",
        "incomplete_expired": "canceled",
        "paused":    "past_due",
    }
    sub_status = status_map.get(sub.status, "incomplete")

    # Descobre o plan_id local pelo stripe_price_id
    price_id = sub["items"]["data"][0]["price"]["id"] if sub["items"]["data"] else None
    plan_id  = None
    if price_id:
        db = get_db()
        plan_result = (
            db.table("plans")
            .select("id")
            .eq("stripe_price_id", price_id)
            .execute()
        )
        if plan_result.data:
            plan_id = plan_result.data[0]["id"]

    import datetime as _dt
    patch: dict = {
        "stripe_subscription_id": stripe_subscription_id,
        "subscription_status":    sub_status,
        "cancel_at_period_end":   sub.cancel_at_period_end,
        "current_period_end": _dt.datetime.fromtimestamp(
            sub.current_period_end, tz=_dt.timezone.utc
        ).isoformat(),
    }
    if plan_id:
        patch["plan_id"] = plan_id

    # Clínica identificada pelo metadata clinic_id
    clinic_id = (sub.metadata or {}).get("clinic_id")
    if not clinic_id:
        # Fallback: busca pelo stripe_subscription_id
        db = get_db()
        result = (
            db.table("clinics")
            .select("id, subdomain")
            .eq("stripe_subscription_id", stripe_subscription_id)
            .execute()
        )
        if result.data:
            clinic_id = result.data[0]["id"]

    if clinic_id:
        # Atualiza status da clínica também se assinatura ativa
        if sub_status == "active":
            patch["status"] = "active"
        elif sub_status in ("canceled", "unpaid"):
            patch["status"] = "suspended"

        from middleware.tenant import invalidate_tenant_cache
        clinic_result = get_db().table("clinics").select("subdomain").eq("id", clinic_id).execute()
        if clinic_result.data:
            invalidate_tenant_cache(clinic_result.data[0]["subdomain"])

        update_clinic(str(clinic_id), patch)

    return patch


# ---------------------------------------------------------------------------
# Sync de planos Supabase → Stripe
# ---------------------------------------------------------------------------

def sync_plans_to_stripe() -> list[dict]:
    """Lê planos do Supabase e cria/atualiza Products + Prices no Stripe.

    Idempotente: planos com stripe_product_id existente são atualizados;
    os demais são criados. Retorna lista com resultado de cada plano.
    """
    from db.supabase_client import get_db

    db      = get_db()
    plans   = db.table("plans").select("*").execute().data or []
    results = []

    for plan in plans:
        plan_id    = plan["id"]
        price_brl  = plan["price_cents"]  # centavos de BRL
        plan_name  = plan["name"]

        # Plano gratuito — não cria no Stripe
        if price_brl == 0:
            results.append({"plan": plan_name, "skipped": True, "reason": "free plan"})
            continue

        try:
            # Produto
            existing_product_id = plan.get("stripe_product_id")
            if existing_product_id:
                product = stripe.Product.modify(
                    existing_product_id,
                    name=plan_name,
                    metadata={"plan_id": plan_id},
                )
            else:
                product = stripe.Product.create(
                    name=plan_name,
                    metadata={"plan_id": plan_id},
                )

            # Preço — sempre cria novo se não existir (Stripe não permite editar preço)
            existing_price_id = plan.get("stripe_price_id")
            if not existing_price_id:
                price = stripe.Price.create(
                    product=product.id,
                    unit_amount=price_brl,
                    currency=plan.get("currency", "brl"),
                    recurring={"interval": plan.get("interval", "month")},
                    metadata={"plan_id": plan_id},
                )
                existing_price_id = price.id

            # Grava IDs de volta no Supabase
            db.table("plans").update({
                "stripe_product_id": product.id,
                "stripe_price_id":   existing_price_id,
            }).eq("id", plan_id).execute()

            results.append({
                "plan":               plan_name,
                "stripe_product_id":  product.id,
                "stripe_price_id":    existing_price_id,
                "ok": True,
            })
            print(f"[STRIPE SYNC] {plan_name}: product={product.id} price={existing_price_id}")

        except Exception as e:
            results.append({"plan": plan_name, "ok": False, "error": str(e)})
            print(f"[STRIPE SYNC] Erro em '{plan_name}': {e}")

    return results

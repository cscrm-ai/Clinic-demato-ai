"""Handler de webhooks Stripe — processamento idempotente.

Fluxo:
  1. Valida assinatura HMAC com STRIPE_WEBHOOK_SECRET
  2. Insere em payment_events (com stripe_event_id único)
  3. Checa se já foi processado (idempotência)
  4. Despacha para o handler correto
  5. Marca payment_events.processed = True
  6. Em caso de exceção, grava o erro e re-levanta para Stripe re-tentar

Eventos tratados:
  checkout.session.completed
  customer.subscription.created
  customer.subscription.updated
  customer.subscription.deleted
  invoice.finalized
  invoice.paid
  invoice.payment_failed
"""

import os

import stripe

from db.supabase_client import (
    get_db,
    get_payment_event,
    insert_payment_event,
    mark_payment_event_processed,
    update_clinic,
    upsert_invoice,
)
from billing.stripe_client import sync_subscription_from_stripe


# ---------------------------------------------------------------------------
# Entry point principal
# ---------------------------------------------------------------------------

def process_stripe_event(raw_body: bytes, signature: str) -> dict:
    """Valida e processa um evento Stripe.

    Retorna dict com informações do processamento.
    Lança ValueError se a assinatura for inválida.
    """
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
    if not webhook_secret:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET não configurada.")

    # 1. Valida assinatura — lança stripe.error.SignatureVerificationError se inválida
    try:
        event = stripe.Webhook.construct_event(raw_body, signature, webhook_secret)
    except stripe.error.SignatureVerificationError as e:
        raise ValueError(f"Assinatura Stripe inválida: {e}") from e

    stripe_event_id = event["id"]
    event_type      = event["type"]

    # 2. Insere em payment_events (pode falhar se duplicata — tratado abaixo)
    db_event_id = None
    try:
        # Tenta buscar se já existe (idempotência)
        existing = get_payment_event(stripe_event_id)
        if existing:
            if existing.get("processed"):
                return {"status": "already_processed", "event_id": stripe_event_id}
            db_event_id = existing["id"]
        else:
            # Extrai clinic_id do metadata se disponível
            clinic_id = _extract_clinic_id_from_event(event)
            record = insert_payment_event({
                "stripe_event_id": stripe_event_id,
                "type":            event_type,
                "clinic_id":       clinic_id,
                "payload":         dict(event),
                "processed":       False,
            })
            db_event_id = record["id"]
    except Exception as insert_exc:
        # Se falhou por duplicata de stripe_event_id, tenta buscar novamente
        existing = get_payment_event(stripe_event_id)
        if existing:
            if existing.get("processed"):
                return {"status": "already_processed", "event_id": stripe_event_id}
            db_event_id = existing["id"]
        else:
            raise insert_exc

    # 3. Processa o evento
    try:
        result = _dispatch(event)
        if db_event_id:
            mark_payment_event_processed(db_event_id)
        return {"status": "processed", "event_type": event_type, "result": result}

    except Exception as handler_exc:
        # Grava erro e re-levanta para Stripe re-tentar (retornará status 500)
        if db_event_id:
            mark_payment_event_processed(db_event_id, error=str(handler_exc))
        raise


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

def _dispatch(event: dict) -> dict:
    """Roteia o evento para o handler correto."""
    event_type = event["type"]
    handlers   = {
        "checkout.session.completed":       _handle_checkout_completed,
        "customer.subscription.created":    _handle_subscription_updated,
        "customer.subscription.updated":    _handle_subscription_updated,
        "customer.subscription.deleted":    _handle_subscription_deleted,
        "invoice.finalized":                _handle_invoice_finalized,
        "invoice.paid":                     _handle_invoice_paid,
        "invoice.payment_failed":           _handle_invoice_payment_failed,
    }
    handler = handlers.get(event_type)
    if handler:
        return handler(event["data"]["object"])

    # Evento não tratado — ok, apenas registrado
    return {"skipped": True, "reason": f"event type '{event_type}' not handled"}


# ---------------------------------------------------------------------------
# Handlers individuais
# ---------------------------------------------------------------------------

def _handle_checkout_completed(session: dict) -> dict:
    """checkout.session.completed → vincula subscription à clínica."""
    clinic_id  = (session.get("metadata") or {}).get("clinic_id")
    sub_id     = session.get("subscription")
    customer_id = session.get("customer")

    if not clinic_id:
        return {"warning": "clinic_id não encontrado no metadata do checkout"}

    patch: dict = {}
    if sub_id:
        patch["stripe_subscription_id"] = sub_id
        patch["subscription_status"]    = "active"
        patch["status"]                 = "active"
    if customer_id:
        patch["stripe_customer_id"] = customer_id

    if patch:
        update_clinic(clinic_id, patch)
        _invalidate_cache(clinic_id)

    # Sincroniza detalhes completos da subscription
    if sub_id:
        sync_subscription_from_stripe(sub_id)

    return {"clinic_id": clinic_id, "subscription_id": sub_id}


def _handle_subscription_updated(subscription: dict) -> dict:
    """customer.subscription.created / updated → sync completo."""
    sub_id = subscription.get("id")
    if not sub_id:
        return {"warning": "subscription id não encontrado"}

    patch = sync_subscription_from_stripe(sub_id)
    return {"subscription_id": sub_id, "patch": patch}


def _handle_subscription_deleted(subscription: dict) -> dict:
    """customer.subscription.deleted → marca clínica como canceled."""
    sub_id    = subscription.get("id")
    clinic_id = _clinic_id_from_subscription(subscription)

    if clinic_id:
        update_clinic(clinic_id, {
            "subscription_status": "canceled",
            "status":              "canceled",
        })
        _invalidate_cache(clinic_id)

    return {"subscription_id": sub_id, "clinic_id": clinic_id}


def _handle_invoice_finalized(invoice: dict) -> dict:
    """invoice.finalized → insere/atualiza invoice local."""
    clinic_id = _clinic_id_from_invoice(invoice)
    if not clinic_id:
        return {"warning": "clinic_id não encontrado para invoice"}

    import datetime as _dt
    record = {
        "clinic_id":          clinic_id,
        "stripe_invoice_id":  invoice["id"],
        "amount_cents":       invoice.get("amount_due", 0),
        "currency":           invoice.get("currency", "brl"),
        "status":             invoice.get("status", "open"),
        "hosted_invoice_url": invoice.get("hosted_invoice_url"),
        "invoice_pdf":        invoice.get("invoice_pdf"),
    }

    # Período da fatura
    if invoice.get("period_start"):
        record["period_start"] = _dt.datetime.fromtimestamp(
            invoice["period_start"], tz=_dt.timezone.utc
        ).isoformat()
    if invoice.get("period_end"):
        record["period_end"] = _dt.datetime.fromtimestamp(
            invoice["period_end"], tz=_dt.timezone.utc
        ).isoformat()

    upsert_invoice(record)
    return {"invoice_id": invoice["id"], "clinic_id": clinic_id}


def _handle_invoice_paid(invoice: dict) -> dict:
    """invoice.paid → atualiza status e paid_at."""
    import datetime as _dt

    clinic_id = _clinic_id_from_invoice(invoice)
    if not clinic_id:
        return {"warning": "clinic_id não encontrado para invoice"}

    paid_at = None
    if invoice.get("status_transitions", {}).get("paid_at"):
        paid_at = _dt.datetime.fromtimestamp(
            invoice["status_transitions"]["paid_at"], tz=_dt.timezone.utc
        ).isoformat()

    upsert_invoice({
        "clinic_id":         clinic_id,
        "stripe_invoice_id": invoice["id"],
        "amount_cents":      invoice.get("amount_paid", 0),
        "currency":          invoice.get("currency", "brl"),
        "status":            "paid",
        "paid_at":           paid_at,
        "hosted_invoice_url": invoice.get("hosted_invoice_url"),
        "invoice_pdf":       invoice.get("invoice_pdf"),
    })

    # Garante que status da clínica está ativo
    if clinic_id:
        db = get_db()
        clinic = db.table("clinics").select("subscription_status").eq("id", clinic_id).execute()
        if clinic.data and clinic.data[0].get("subscription_status") == "past_due":
            update_clinic(clinic_id, {"subscription_status": "active", "status": "active"})
            _invalidate_cache(clinic_id)

    return {"invoice_id": invoice["id"], "status": "paid"}


def _handle_invoice_payment_failed(invoice: dict) -> dict:
    """invoice.payment_failed → marca clínica como past_due."""
    clinic_id = _clinic_id_from_invoice(invoice)

    if clinic_id:
        update_clinic(clinic_id, {"subscription_status": "past_due"})
        _invalidate_cache(clinic_id)
        upsert_invoice({
            "clinic_id":         clinic_id,
            "stripe_invoice_id": invoice["id"],
            "amount_cents":      invoice.get("amount_due", 0),
            "currency":          invoice.get("currency", "brl"),
            "status":            "payment_failed",
            "hosted_invoice_url": invoice.get("hosted_invoice_url"),
        })

    return {"invoice_id": invoice["id"], "clinic_id": clinic_id, "status": "past_due"}


# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------

def _extract_clinic_id_from_event(event: dict) -> str | None:
    """Tenta extrair clinic_id do metadata do objeto principal do evento."""
    obj = event.get("data", {}).get("object", {})
    return (obj.get("metadata") or {}).get("clinic_id")


def _clinic_id_from_subscription(subscription: dict) -> str | None:
    """Obtém clinic_id de uma subscription (metadata ou banco)."""
    clinic_id = (subscription.get("metadata") or {}).get("clinic_id")
    if clinic_id:
        return clinic_id

    # Fallback: busca pelo stripe_subscription_id
    sub_id = subscription.get("id")
    if sub_id:
        db     = get_db()
        result = (
            db.table("clinics")
            .select("id")
            .eq("stripe_subscription_id", sub_id)
            .execute()
        )
        if result.data:
            return result.data[0]["id"]
    return None


def _clinic_id_from_invoice(invoice: dict) -> str | None:
    """Obtém clinic_id a partir de uma invoice (via customer ou subscription)."""
    # Tenta pelo metadata da subscription vinculada
    sub_id = invoice.get("subscription")
    if sub_id:
        db     = get_db()
        result = (
            db.table("clinics")
            .select("id")
            .eq("stripe_subscription_id", sub_id)
            .execute()
        )
        if result.data:
            return result.data[0]["id"]

    # Fallback: pelo stripe_customer_id
    customer_id = invoice.get("customer")
    if customer_id:
        db     = get_db()
        result = (
            db.table("clinics")
            .select("id")
            .eq("stripe_customer_id", customer_id)
            .execute()
        )
        if result.data:
            return result.data[0]["id"]

    return None


def _invalidate_cache(clinic_id: str) -> None:
    """Invalida cache do middleware para a clínica."""
    try:
        db     = get_db()
        result = (
            db.table("clinics")
            .select("subdomain")
            .eq("id", clinic_id)
            .execute()
        )
        if result.data:
            from middleware.tenant import invalidate_tenant_cache
            invalidate_tenant_cache(result.data[0]["subdomain"])
    except Exception as e:
        print(f"[WEBHOOK] Erro ao invalidar cache: {e}")

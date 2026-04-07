"""API FastAPI — Clinic Skin Analysis SaaS (multi-tenant).

Roteamento por subdomínio via TenantMiddleware.
Autenticação via Supabase JWT (magic link).
Billing via Stripe (Phase 5).
"""

import datetime
import os
import shutil
import traceback
import uuid
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Limpa whitespace das env vars críticas
for _key in ("FAL_KEY", "GOOGLE_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
    _val = os.environ.get(_key, "")
    if _val != _val.strip():
        os.environ[_key] = _val.strip()

from fastapi import Depends, FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from agent_api.agent import analyze_image
from auth.deps import get_current_user, require_clinic_admin, require_super_admin
from db.supabase_client import (
    create_clinic,
    delete_analysis,
    get_clinic_by_id,
    get_clinic_usage_stats,
    get_db,
    get_signed_url,
    get_super_admin_overview,
    get_user_clinic_ids,
    insert_payment_event,
    is_super_admin,
    list_analyses_for_clinic,
    list_clinics,
    list_invoices_for_clinic,
    log_usage_event,
    save_analysis,
    update_clinic,
    upload_analysis_image,
    upload_logo,
)
from middleware.tenant import TenantMiddleware, invalidate_tenant_cache
from tools.cost_tracker import CostAccumulator

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = Path("/tmp/clinic_uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Config padrão para novas clínicas (espelho do antigo storage/config.py)
# ---------------------------------------------------------------------------

DEFAULT_CONFIG = {
    "clinic_name": "Minha Clínica",
    "welcome_text": "Toda forma de beleza merece o melhor resultado.",
    "logo_url": "",
    "colors": {
        "primary":    "#D9BFB2",
        "secondary":  "#827870",
        "accent":     "#D99C94",
        "background": "#F0EBE3",
        "text":       "#3A3330",
    },
    "font": "Metropolis",
    "footer": {"phone": "", "instagram": "", "address": ""},
    "disclaimer": (
        "Este laudo é orientativo e não substitui consulta médica presencial. "
        "Diagnósticos definitivos, prescrições e procedimentos exigem avaliação "
        "clínica completa por profissional habilitado."
    ),
    "analyses_count": 0,
    "videos": [],
    "procedures_catalog": [],
}

FONT_OPTIONS = [
    "Metropolis", "Inter", "DM Sans", "Outfit", "Plus Jakarta Sans",
    "Nunito Sans", "Cormorant Garamond", "Playfair Display", "Lora",
    "Source Serif 4",
]

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Clinic Skin Analysis SaaS")

app.add_middleware(TenantMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _clinic_config(request: Request) -> dict:
    """Extrai config da clínica resolvida no middleware."""
    clinic = getattr(request.state, "clinic", None)
    if clinic:
        cfg = clinic.get("config") or {}
        # Garante que chaves padrão existam
        return {**DEFAULT_CONFIG, **cfg}
    return DEFAULT_CONFIG.copy()


# ═══════════════════════════════════════════════════════════════════════════
# ROTAS DO PACIENTE
# ═══════════════════════════════════════════════════════════════════════════


@app.post("/analyze")
async def analyze(request: Request, image: UploadFile = File(...)):
    """Upload foto → Gemini + Moondream3 → laudo JSON."""
    clinic = getattr(request.state, "clinic", None)

    # Verifica quota do plano (apenas se clínica identificada)
    if clinic:
        try:
            from billing.limits import check_quota
            allowed, reason, current, limit = check_quota(clinic)
            if not allowed:
                base_domain = os.environ.get("APP_BASE_DOMAIN", "cscrm.ai")
                subdomain   = clinic.get("subdomain", "")
                upgrade_url = f"https://{subdomain}.{base_domain}/admin#billing"
                return JSONResponse(
                    status_code=402,
                    content={
                        "error":       reason,
                        "current":     current,
                        "limit":       limit,
                        "upgrade_url": upgrade_url,
                    },
                )
        except ImportError:
            pass  # billing ainda não disponível (fases iniciais)

    try:
        ext         = Path(image.filename or "photo.jpg").suffix or ".jpg"
        unique_name = f"{uuid.uuid4().hex}{ext}"
        file_path   = UPLOAD_DIR / unique_name
        t_start     = datetime.datetime.now(datetime.timezone.utc)

        with open(file_path, "wb") as f:
            shutil.copyfileobj(image.file, f)

        # Catálogo de procedimentos da clínica
        config  = _clinic_config(request)
        catalog = config.get("procedures_catalog", [])

        # Chaves de API específicas da clínica (override das globais se configuradas)
        _overridden_keys: dict[str, str] = {}
        if clinic:
            api_keys = (clinic.get("config") or {}).get("api_keys", {})
            if api_keys.get("fal_key"):
                _overridden_keys["FAL_KEY"] = os.environ.get("FAL_KEY", "")
                os.environ["FAL_KEY"] = api_keys["fal_key"]
            if api_keys.get("google_api_key"):
                _overridden_keys["GOOGLE_API_KEY"] = os.environ.get("GOOGLE_API_KEY", "")
                os.environ["GOOGLE_API_KEY"] = api_keys["google_api_key"]

        # Roda análise com tracker de custo
        tracker = CostAccumulator(
            clinic_id=str(clinic["id"]) if clinic else "",
        )
        try:
            report = analyze_image(
                str(file_path.resolve()),
                procedures_catalog=catalog,
                cost_tracker=tracker,
            )
        finally:
            # Restaura chaves originais
            for _k, _v in _overridden_keys.items():
                if _v:
                    os.environ[_k] = _v
                else:
                    os.environ.pop(_k, None)
        result      = report.model_dump()
        duration_ms = int(
            (datetime.datetime.now(datetime.timezone.utc) - t_start).total_seconds() * 1000
        )

        # Persiste no Supabase se tiver clínica identificada
        if clinic:
            clinic_id = str(clinic["id"])
            try:
                # Upload da imagem original para o Supabase Storage
                img_bytes  = file_path.read_bytes()
                image_path = upload_analysis_image(
                    clinic_id, img_bytes, f"{uuid.uuid4().hex}.jpg"
                )
            except Exception as _up_exc:
                print(f"[STORAGE] Erro ao enviar imagem: {_up_exc}")
                image_path = ""

            # Salva análise no banco
            try:
                saved = save_analysis(
                    clinic_id=clinic_id,
                    report=result,
                    image_path=image_path,
                    duration_ms=duration_ms,
                    total_cost_cents=tracker.total_cents(),
                )
                # Atualiza analysis_id nos eventos de custo
                tracker.set_analysis_id(str(saved["id"]))
            except Exception as _save_exc:
                print(f"[DB] Erro ao salvar análise: {_save_exc}")

            # Grava eventos de custo
            for event in tracker.events():
                try:
                    log_usage_event(event)
                except Exception as _log_exc:
                    print(f"[DB] Erro ao gravar usage_event: {_log_exc}")

        file_path.unlink(missing_ok=True)
        return result

    except Exception as e:
        traceback.print_exc()
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "type": type(e).__name__},
        )


@app.get("/api/config")
async def get_config(request: Request):
    """Retorna config pública da clínica."""
    return _clinic_config(request)


# ═══════════════════════════════════════════════════════════════════════════
# ADMIN DA CLÍNICA
# ═══════════════════════════════════════════════════════════════════════════


@app.post("/api/auth/set-password")
async def auth_set_password(request: Request):
    """Define/altera senha usando token do link de recuperação."""
    body        = await request.json()
    token       = (body.get("token") or "").strip()
    new_password = (body.get("new_password") or "").strip()

    if not token or not new_password or len(new_password) < 8:
        return JSONResponse(status_code=400, content={"error": "Token e senha (mín. 8 chars) são obrigatórios."})

    db = get_db()
    try:
        # Verifica o token e obtém o usuário
        user_resp = db.auth.get_user(token)
        user_id   = str(user_resp.user.id)
    except Exception as e:
        return JSONResponse(status_code=401, content={"error": "Link expirado ou inválido. Solicite um novo acesso."})

    try:
        db.auth.admin.update_user_by_id(user_id, {"password": new_password})
        return {"ok": True}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Erro ao salvar senha: {e}"})


@app.get("/api/admin/config")
async def admin_get_config(
    request: Request,
    user_id: str = Depends(require_clinic_admin),
):
    """Retorna config completa da clínica (requer auth)."""
    config = _clinic_config(request)
    config["_font_options"] = FONT_OPTIONS
    return config


@app.put("/api/admin/config")
async def admin_save_config(
    request: Request,
    user_id: str = Depends(require_clinic_admin),
):
    """Salva config da clínica via merge no campo JSONB (requer auth)."""
    clinic = request.state.clinic
    data   = await request.json()
    data.pop("_font_options", None)

    # Merge: mantém chaves existentes e sobrescreve as enviadas
    current_config = clinic.get("config") or {}
    merged_config  = {**DEFAULT_CONFIG, **current_config, **data}

    update_clinic(str(clinic["id"]), {"config": merged_config})
    invalidate_tenant_cache(clinic["subdomain"])
    return {"ok": True}


@app.post("/api/admin/logo")
async def admin_upload_logo(
    request: Request,
    image: UploadFile = File(...),
    user_id: str = Depends(require_clinic_admin),
):
    """Upload de logo da clínica para o Supabase Storage."""
    clinic     = request.state.clinic
    clinic_id  = str(clinic["id"])
    file_bytes = await image.read()
    filename   = f"logo-{uuid.uuid4().hex[:8]}{Path(image.filename or 'logo.png').suffix}"

    logo_url = upload_logo(clinic_id, file_bytes, filename)

    if logo_url:
        current_config = clinic.get("config") or {}
        current_config["logo_url"] = logo_url
        update_clinic(clinic_id, {"config": current_config})
        invalidate_tenant_cache(clinic["subdomain"])
        return {"ok": True, "logo_url": logo_url}

    return JSONResponse(
        status_code=500,
        content={"error": "Falha ao fazer upload do logo."},
    )


@app.get("/api/admin/analyses")
async def admin_get_analyses(
    request: Request,
    user_id: str = Depends(require_clinic_admin),
):
    """Lista análises da clínica com signed URLs para as imagens."""
    clinic    = request.state.clinic
    analyses  = list_analyses_for_clinic(str(clinic["id"]))

    # Substitui image_path por signed URL temporária (1h)
    for record in analyses:
        path = record.get("image_path", "")
        if path:
            try:
                record["image_url"] = get_signed_url(path, expires_in=3600)
            except Exception:
                record["image_url"] = ""
        else:
            record["image_url"] = ""

    return analyses


@app.delete("/api/admin/analyses/{analysis_id}")
async def admin_delete_analysis(
    analysis_id: str,
    request: Request,
    user_id: str = Depends(require_clinic_admin),
):
    """Remove análise do histórico (requer auth)."""
    delete_analysis(analysis_id)
    return {"ok": True}


# ── Billing da clínica ───────────────────────────────────────────────────

@app.get("/api/admin/billing/status")
async def admin_billing_status(
    request: Request,
    user_id: str = Depends(require_clinic_admin),
):
    """Retorna plano atual, uso do mês e próxima cobrança."""
    clinic = request.state.clinic
    usage  = get_clinic_usage_stats(str(clinic["id"]), period="month")
    plan   = clinic.get("plans") or {}

    return {
        "plan_name":            plan.get("name", "Free"),
        "monthly_limit":        plan.get("monthly_analyses_limit"),
        "analyses_this_month":  usage["analyses_count"],
        "cost_this_month_cents": usage["total_cost_cents"],
        "subscription_status":  clinic.get("subscription_status", "trialing"),
        "current_period_end":   clinic.get("current_period_end"),
        "cancel_at_period_end": clinic.get("cancel_at_period_end", False),
        "trial_ends_at":        clinic.get("trial_ends_at"),
    }


@app.get("/api/admin/billing/invoices")
async def admin_billing_invoices(
    request: Request,
    user_id: str = Depends(require_clinic_admin),
):
    """Lista faturas da clínica."""
    clinic = request.state.clinic
    return list_invoices_for_clinic(str(clinic["id"]))


@app.post("/api/admin/billing/checkout")
async def admin_billing_checkout(
    request: Request,
    user_id: str = Depends(require_clinic_admin),
):
    """Gera URL de checkout Stripe para upgrade de plano."""
    from billing.stripe_client import create_checkout_session

    clinic  = request.state.clinic
    body    = await request.json()
    plan_id = body.get("plan_id")
    if not plan_id:
        return JSONResponse(status_code=400, content={"error": "plan_id obrigatório."})

    db      = get_db()
    plan    = db.table("plans").select("*").eq("id", plan_id).single().execute().data
    if not plan:
        return JSONResponse(status_code=404, content={"error": "Plano não encontrado."})

    base_domain = os.environ.get("APP_BASE_DOMAIN", "cscrm.ai")
    subdomain   = clinic["subdomain"]
    success_url = f"https://{subdomain}.{base_domain}/admin?checkout=success"
    cancel_url  = f"https://{subdomain}.{base_domain}/admin#billing"

    checkout_url = create_checkout_session(clinic, plan, success_url, cancel_url)
    return {"checkout_url": checkout_url}


@app.post("/api/admin/billing/portal")
async def admin_billing_portal(
    request: Request,
    user_id: str = Depends(require_clinic_admin),
):
    """Gera URL do portal de gerenciamento de assinatura Stripe."""
    from billing.stripe_client import create_portal_session

    clinic      = request.state.clinic
    base_domain = os.environ.get("APP_BASE_DOMAIN", "cscrm.ai")
    return_url  = f"https://{clinic['subdomain']}.{base_domain}/admin#billing"

    portal_url = create_portal_session(clinic, return_url)
    return {"portal_url": portal_url}


# ═══════════════════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/api/auth/login")
async def auth_login(request: Request):
    """Login com e-mail e senha via Supabase Auth."""
    body     = await request.json()
    email    = (body.get("email") or "").strip().lower()
    password = (body.get("password") or "").strip()

    if not email or not password:
        return JSONResponse(status_code=400, content={"error": "E-mail e senha obrigatórios."})

    db = get_db()
    try:
        session = db.auth.sign_in_with_password({"email": email, "password": password})
        token   = session.session.access_token
        return {"ok": True, "access_token": token}
    except Exception as _exc:
        err_msg = str(_exc)
        print(f"[AUTH] Erro no login de {email}: {err_msg}")
        return JSONResponse(status_code=401, content={"error": "E-mail ou senha incorretos."})


@app.post("/api/auth/magic-link")
async def auth_magic_link(request: Request):
    """Mantido para compatibilidade — redireciona para login com senha."""
    return JSONResponse(status_code=410, content={"error": "Magic link desativado. Use e-mail e senha."})


@app.post("/api/auth/logout")
async def auth_logout():
    """Logout — instrui o cliente a apagar o cookie."""
    response = JSONResponse(content={"ok": True})
    response.delete_cookie("sb-access-token")
    return response


# ═══════════════════════════════════════════════════════════════════════════
# SUPER ADMIN  (admin.cscrm.ai)
# ═══════════════════════════════════════════════════════════════════════════


@app.get("/api/super/overview")
async def super_overview(
    days: int = 30,
    user_id: str = Depends(require_super_admin),
    request: Request = None,
):
    """MRR, análises/período, custo/período, inadimplência."""
    from_date = request.query_params.get("from") if request else None
    to_date = request.query_params.get("to") if request else None
    return get_super_admin_overview(days=days, from_date=from_date, to_date=to_date)


@app.get("/api/super/model-costs")
async def super_get_model_costs(user_id: str = Depends(require_super_admin)):
    """Retorna configurações de custo dos modelos de IA."""
    from tools.cost_tracker import (
        GEMINI_INPUT_PRICE_PER_1M_USD,
        GEMINI_OUTPUT_PRICE_PER_1M_USD,
        MOONDREAM_INPUT_PRICE_PER_1M_USD,
        MOONDREAM_OUTPUT_PRICE_PER_1M_USD,
        MOONDREAM_PRICE_PER_CALL_USD,
        USD_TO_BRL,
    )
    return {
        "gemini_input_per_1m_usd": str(GEMINI_INPUT_PRICE_PER_1M_USD),
        "gemini_output_per_1m_usd": str(GEMINI_OUTPUT_PRICE_PER_1M_USD),
        "moondream_input_per_1m_usd": str(MOONDREAM_INPUT_PRICE_PER_1M_USD),
        "moondream_output_per_1m_usd": str(MOONDREAM_OUTPUT_PRICE_PER_1M_USD),
        "moondream_per_call_usd": str(MOONDREAM_PRICE_PER_CALL_USD),
        "usd_to_brl": str(USD_TO_BRL),
    }


@app.post("/api/super/model-costs")
async def super_update_model_costs(request: Request, user_id: str = Depends(require_super_admin)):
    """Atualiza configurações de custo dos modelos de IA."""
    import tools.cost_tracker as ct
    from decimal import Decimal

    body = await request.json()

    if "gemini_input_per_1m_usd" in body:
        ct.GEMINI_INPUT_PRICE_PER_1M_USD = Decimal(str(body["gemini_input_per_1m_usd"]))
    if "gemini_output_per_1m_usd" in body:
        ct.GEMINI_OUTPUT_PRICE_PER_1M_USD = Decimal(str(body["gemini_output_per_1m_usd"]))
    if "moondream_input_per_1m_usd" in body:
        ct.MOONDREAM_INPUT_PRICE_PER_1M_USD = Decimal(str(body["moondream_input_per_1m_usd"]))
    if "moondream_output_per_1m_usd" in body:
        ct.MOONDREAM_OUTPUT_PRICE_PER_1M_USD = Decimal(str(body["moondream_output_per_1m_usd"]))
    # Recalculate per-call price
    if "moondream_input_per_1m_usd" in body or "moondream_output_per_1m_usd" in body:
        ct.MOONDREAM_PRICE_PER_CALL_USD = (
            (Decimal(ct.MOONDREAM_AVG_TOKENS_IN_PER_CALL) / Decimal("1_000_000")) * ct.MOONDREAM_INPUT_PRICE_PER_1M_USD +
            (Decimal(ct.MOONDREAM_AVG_TOKENS_OUT_PER_CALL) / Decimal("1_000_000")) * ct.MOONDREAM_OUTPUT_PRICE_PER_1M_USD
        )
    if "usd_to_brl" in body:
        ct.USD_TO_BRL = Decimal(str(body["usd_to_brl"]))

    return {"ok": True}


@app.get("/api/super/plans")
async def super_list_plans(user_id: str = Depends(require_super_admin)):
    """Lista planos disponíveis."""
    db = get_db()
    result = db.table("plans").select("*").order("price_cents").execute()
    return result.data or []


@app.put("/api/super/plans/{plan_id}")
async def super_update_plan(
    plan_id: str,
    request: Request,
    user_id: str = Depends(require_super_admin),
):
    """Atualiza um plano existente."""
    db = get_db()
    body = await request.json()
    allowed = {"name", "price_cents", "monthly_analyses_limit", "features"}
    patch = {k: v for k, v in body.items() if k in allowed}
    if not patch:
        return JSONResponse(status_code=400, content={"error": "Nenhum campo válido."})
    result = db.table("plans").update(patch).eq("id", plan_id).execute()
    if not result.data:
        return JSONResponse(status_code=404, content={"error": "Plano não encontrado."})
    return result.data[0]


@app.post("/api/super/plans")
async def super_create_plan(
    request: Request,
    user_id: str = Depends(require_super_admin),
):
    """Cria um novo plano."""
    db = get_db()
    body = await request.json()
    record = {
        "name": body.get("name", "Novo Plano"),
        "price_cents": int(body.get("price_cents", 0)),
        "monthly_analyses_limit": body.get("monthly_analyses_limit"),
    }
    result = db.table("plans").insert(record).execute()
    return result.data[0]


@app.get("/api/super/clinics")
async def super_list_clinics(
    status: str | None = None,
    plan_id: str | None = None,
    user_id: str = Depends(require_super_admin),
):
    """Lista todas as clínicas com stats agregados."""
    filters = {}
    if status:
        filters["status"] = status
    if plan_id:
        filters["plan_id"] = plan_id

    clinics = list_clinics(filters or None)

    # Adiciona uso do mês corrente para cada clínica
    for clinic in clinics:
        try:
            usage = get_clinic_usage_stats(str(clinic["id"]), period="month")
            clinic["usage_this_month"] = usage
        except Exception:
            clinic["usage_this_month"] = {}

    return clinics


@app.post("/api/super/clinics")
async def super_create_clinic(
    request: Request,
    user_id: str = Depends(require_super_admin),
):
    """Cria nova clínica, usuário Supabase Auth, customer Stripe e magic link."""
    import re

    body        = await request.json()
    subdomain   = (body.get("subdomain") or "").strip().lower()
    name        = (body.get("name") or "").strip()
    owner_email = (body.get("owner_email") or "").strip().lower()
    plan_id     = body.get("plan_id")

    # Validações
    if not subdomain or not re.match(r"^[a-z0-9-]{3,30}$", subdomain):
        return JSONResponse(status_code=400, content={"error": "Subdomínio inválido (3-30 chars, a-z 0-9 -)."})

    reserved = {"admin", "www", "api", "app", "super", "billing", "health"}
    if subdomain in reserved:
        return JSONResponse(status_code=400, content={"error": f"Subdomínio '{subdomain}' é reservado."})

    if not name:
        return JSONResponse(status_code=400, content={"error": "Nome da clínica obrigatório."})

    if not owner_email:
        return JSONResponse(status_code=400, content={"error": "E-mail do responsável obrigatório."})

    db = get_db()

    # Busca plano (plan_id pode ser UUID ou None; se inválido usa Free)
    plan = None
    if plan_id:
        try:
            plan_result = db.table("plans").select("*").eq("id", plan_id).execute()
            plan = plan_result.data[0] if plan_result.data else None
        except Exception:
            plan = None

    if not plan:
        free_result = db.table("plans").select("*").eq("name", "Free").execute()
        plan    = free_result.data[0] if free_result.data else None
        plan_id = plan["id"] if plan else None

    # Cria clínica
    config  = {**DEFAULT_CONFIG, "clinic_name": name}
    setup_fee_cents = int(body.get("setup_fee_cents", 0))
    clinic_data = {
        "subdomain":   subdomain,
        "name":        name,
        "owner_email": owner_email,
        "plan_id":     plan_id,
        "config":      config,
        "status":      "trial",
        "setup_fee_cents": setup_fee_cents,
        "trial_ends_at": (
            datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(days=14)
        ).isoformat(),
    }
    clinic = create_clinic(clinic_data)
    clinic_id = str(clinic["id"])

    # Cria customer no Stripe (se billing disponível)
    checkout_url = None
    try:
        from billing.stripe_client import create_customer, create_checkout_session
        stripe_customer_id = create_customer(clinic_id, owner_email, name)
        update_clinic(clinic_id, {"stripe_customer_id": stripe_customer_id})
        clinic["stripe_customer_id"] = stripe_customer_id

        # Gera checkout se plano não for Free
        if plan and plan.get("price_cents", 0) > 0:
            base_domain = os.environ.get("APP_BASE_DOMAIN", "cscrm.ai")
            success_url = f"https://{subdomain}.{base_domain}/admin?checkout=success"
            cancel_url  = f"https://{subdomain}.{base_domain}/admin"
            checkout_url = create_checkout_session(clinic, plan, success_url, cancel_url)
    except ImportError:
        pass  # billing não disponível ainda
    except Exception as _stripe_exc:
        print(f"[STRIPE] Erro ao criar customer: {_stripe_exc}")

    # Cria usuário no Supabase Auth
    try:
        auth_user = db.auth.admin.create_user({
            "email":            owner_email,
            "email_confirm":    True,
        })
        auth_user_id = str(auth_user.user.id)

        # Vincula usuário à clínica
        db.table("clinic_members").insert({
            "clinic_id": clinic_id,
            "user_id":   auth_user_id,
            "role":      "clinic_admin",
        }).execute()
    except Exception as _auth_exc:
        # Usuário pode já existir — tenta vincular
        print(f"[AUTH] Aviso ao criar usuário: {_auth_exc}")
        try:
            existing = db.auth.admin.list_users()
            user_match = next(
                (u for u in existing if u.email == owner_email), None
            )
            if user_match:
                db.table("clinic_members").upsert({
                    "clinic_id": clinic_id,
                    "user_id":   str(user_match.id),
                    "role":      "clinic_admin",
                }, on_conflict="clinic_id,user_id").execute()
        except Exception:
            pass

    # Envia e-mail para o responsável definir a senha
    try:
        base_domain  = os.environ.get("APP_BASE_DOMAIN", "allbele.app")
        redirect_url = f"https://{base_domain}/set-password?clinic={subdomain}"
        db.auth.reset_password_for_email(owner_email, options={"redirect_to": redirect_url})
        print(f"[AUTH] E-mail de definição de senha enviado para {owner_email}")
    except Exception as _ml_exc:
        print(f"[AUTH] Erro ao enviar e-mail de senha: {_ml_exc}")

    # Cria registro DNS no Cloudflare automaticamente
    dns_result = {"skipped": True}
    try:
        from dns.cloudflare import create_clinic_dns
        dns_result = create_clinic_dns(subdomain)
    except Exception as _dns_exc:
        print(f"[DNS] Erro ao criar registro Cloudflare: {_dns_exc}")

    # Adiciona domínio no Vercel automaticamente
    vercel_result = {"skipped": True}
    try:
        from vercel.domains import add_clinic_domain
        vercel_result = add_clinic_domain(subdomain)
    except Exception as _vercel_exc:
        print(f"[VERCEL] Erro ao adicionar domínio: {_vercel_exc}")

    return {
        "ok":           True,
        "clinic":       clinic,
        "checkout_url": checkout_url,
        "dns":          dns_result,
        "vercel":       vercel_result,
    }


@app.patch("/api/super/clinics/{clinic_id}")
async def super_update_clinic(
    clinic_id: str,
    request: Request,
    user_id: str = Depends(require_super_admin),
):
    """Atualiza status, plano ou outros campos de uma clínica."""
    body    = await request.json()
    # Campos permitidos pelo super admin
    allowed = {"status", "plan_id", "subscription_status", "cancel_at_period_end", "name", "setup_fee_cents", "setup_fee_paid", "setup_fee_paid_at"}
    patch   = {k: v for k, v in body.items() if k in allowed}

    if not patch:
        return JSONResponse(status_code=400, content={"error": "Nenhum campo válido para atualizar."})

    clinic = get_clinic_by_id(clinic_id)
    if not clinic:
        return JSONResponse(status_code=404, content={"error": "Clínica não encontrada."})

    updated = update_clinic(clinic_id, patch)
    invalidate_tenant_cache(clinic["subdomain"])
    return updated


@app.post("/api/super/clinics/{clinic_id}/setup-fee-link")
async def super_setup_fee_link(
    clinic_id: str,
    user_id: str = Depends(require_super_admin),
):
    """Gera link de pagamento Stripe para taxa de implementação."""
    clinic = get_clinic_by_id(clinic_id)
    if not clinic:
        return JSONResponse(status_code=404, content={"error": "Clínica não encontrada."})

    fee = clinic.get("setup_fee_cents", 0)
    if not fee or fee <= 0:
        return JSONResponse(status_code=400, content={"error": "Clínica não tem taxa de implementação configurada."})

    try:
        from billing.stripe_client import create_setup_fee_payment_link
        url = create_setup_fee_payment_link(clinic, fee)
        return {"payment_url": url}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Erro ao gerar link: {e}"})


@app.post("/api/super/clinics/{clinic_id}/suspend")
async def super_suspend_clinic(
    clinic_id: str,
    user_id: str = Depends(require_super_admin),
):
    """Suspende uma clínica."""
    clinic = get_clinic_by_id(clinic_id)
    if not clinic:
        return JSONResponse(status_code=404, content={"error": "Clínica não encontrada."})
    update_clinic(clinic_id, {"status": "suspended"})
    invalidate_tenant_cache(clinic["subdomain"])
    return {"ok": True}


@app.post("/api/super/clinics/{clinic_id}/activate")
async def super_activate_clinic(
    clinic_id: str,
    user_id: str = Depends(require_super_admin),
):
    """Reativa uma clínica suspensa."""
    clinic = get_clinic_by_id(clinic_id)
    if not clinic:
        return JSONResponse(status_code=404, content={"error": "Clínica não encontrada."})
    update_clinic(clinic_id, {"status": "active"})
    invalidate_tenant_cache(clinic["subdomain"])
    return {"ok": True}


@app.delete("/api/super/clinics/{clinic_id}")
async def super_delete_clinic(
    clinic_id: str,
    user_id: str = Depends(require_super_admin),
):
    """Soft delete — marca clínica como cancelada e remove DNS."""
    clinic = get_clinic_by_id(clinic_id)
    if not clinic:
        return JSONResponse(status_code=404, content={"error": "Clínica não encontrada."})

    update_clinic(clinic_id, {"status": "canceled"})
    invalidate_tenant_cache(clinic["subdomain"])

    # Remove registro DNS do Cloudflare
    try:
        from dns.cloudflare import delete_clinic_dns
        delete_clinic_dns(clinic["subdomain"])
    except Exception as _dns_exc:
        print(f"[DNS] Erro ao remover registro Cloudflare: {_dns_exc}")

    # Remove domínio do Vercel
    try:
        from vercel.domains import remove_clinic_domain
        remove_clinic_domain(clinic["subdomain"])
    except Exception as _vercel_exc:
        print(f"[VERCEL] Erro ao remover domínio: {_vercel_exc}")

    return {"ok": True}


@app.put("/api/super/clinics/{clinic_id}/api-keys")
async def super_set_api_keys(
    clinic_id: str,
    request: Request,
    user_id: str = Depends(require_super_admin),
):
    """Salva chaves de API específicas de uma clínica no config JSONB."""
    clinic = get_clinic_by_id(clinic_id)
    if not clinic:
        return JSONResponse(status_code=404, content={"error": "Clínica não encontrada."})

    body        = await request.json()
    fal_key     = (body.get("fal_key") or "").strip()
    google_key  = (body.get("google_api_key") or "").strip()

    current_config = clinic.get("config") or {}
    current_config.setdefault("api_keys", {})
    # Salva apenas se não vazio; remove se vier vazio (volta para global)
    if fal_key:
        current_config["api_keys"]["fal_key"] = fal_key
    else:
        current_config["api_keys"].pop("fal_key", None)

    if google_key:
        current_config["api_keys"]["google_api_key"] = google_key
    else:
        current_config["api_keys"].pop("google_api_key", None)

    update_clinic(clinic_id, {"config": current_config})
    invalidate_tenant_cache(clinic["subdomain"])
    return {"ok": True, "api_keys": current_config["api_keys"]}


@app.post("/api/super/clinics/{clinic_id}/cancel")
async def super_cancel_subscription(
    clinic_id: str,
    user_id: str = Depends(require_super_admin),
):
    """Cancela assinatura Stripe ao fim do período."""
    from billing.stripe_client import cancel_subscription

    clinic = get_clinic_by_id(clinic_id)
    if not clinic:
        return JSONResponse(status_code=404, content={"error": "Clínica não encontrada."})

    sub_id = clinic.get("stripe_subscription_id")
    if not sub_id:
        return JSONResponse(status_code=400, content={"error": "Clínica sem assinatura Stripe."})

    cancel_subscription(sub_id, at_period_end=True)
    update_clinic(clinic_id, {"cancel_at_period_end": True})
    return {"ok": True}


@app.get("/api/super/billing/overview")
async def super_billing_overview(user_id: str = Depends(require_super_admin)):
    """Visão financeira geral (MRR, custo, margem)."""
    overview = get_super_admin_overview()

    mrr    = overview["mrr_cents"]
    cost   = overview["cost_this_month_cents"]
    margin = round(((mrr - cost) / mrr * 100), 1) if mrr > 0 else 0

    return {**overview, "gross_margin_pct": margin}


@app.get("/api/super/billing/invoices")
async def super_billing_invoices(user_id: str = Depends(require_super_admin)):
    """Lista todas as invoices de todas as clínicas."""
    db = get_db()
    result = (
        db.table("invoices")
        .select("*, clinics(name, subdomain)")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
    )
    return result.data or []


@app.post("/api/super/billing/sync-plans")
async def super_sync_plans(user_id: str = Depends(require_super_admin)):
    """Sincroniza planos com o Stripe (cria/atualiza produtos e preços)."""
    from billing.stripe_client import sync_plans_to_stripe
    result = sync_plans_to_stripe()
    return {"ok": True, "synced": result}


@app.get("/api/super/usage")
async def super_usage(
    clinic_id: str | None = None,
    provider:  str | None = None,
    user_id: str = Depends(require_super_admin),
):
    """Lista eventos de uso com filtros opcionais + dados da análise."""
    db    = get_db()
    query = db.table("usage_events").select(
        "*, clinics(name, subdomain), analyses(duration_ms, skin_type, fitzpatrick_type, created_at, total_cost_cents)"
    )

    if clinic_id:
        query = query.eq("clinic_id", clinic_id)
    if provider:
        query = query.eq("provider", provider)

    result = query.order("created_at", desc=True).limit(1000).execute()
    return result.data or []


@app.get("/api/super/usage/{analysis_id}")
async def super_usage_detail(
    analysis_id: str,
    user_id: str = Depends(require_super_admin),
):
    """Retorna dados completos de uma análise para o painel de uso."""
    db = get_db()
    result = db.table("analyses").select("*").eq("id", analysis_id).single().execute()
    if not result.data:
        return JSONResponse(status_code=404, content={"error": "Análise não encontrada."})
    record = result.data
    path = record.get("image_path", "")
    if path:
        try:
            record["image_url"] = get_signed_url(path, expires_in=3600)
        except Exception:
            record["image_url"] = ""
    else:
        record["image_url"] = ""
    return record


# ═══════════════════════════════════════════════════════════════════════════
# WEBHOOK STRIPE  (implementação completa na Fase 5)
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    """Recebe eventos Stripe. Lógica de processamento na Fase 5."""
    try:
        from billing.webhook import process_stripe_event
        raw_body  = await request.body()
        signature = request.headers.get("stripe-signature", "")
        result    = process_stripe_event(raw_body, signature)
        return {"received": True, **result}
    except ImportError:
        # billing.webhook ainda não disponível
        return {"received": True, "note": "webhook handler pending"}
    except ValueError as e:
        # Assinatura inválida
        return JSONResponse(status_code=400, content={"error": str(e)})
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


# ═══════════════════════════════════════════════════════════════════════════
# HEALTH CHECK
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    """Status do sistema com verificação de conexão Supabase."""
    supabase_ok = False
    try:
        db = get_db()
        db.table("plans").select("id").limit(1).execute()
        supabase_ok = True
    except Exception as _e:
        print(f"[HEALTH] Supabase indisponível: {_e}")

    return {
        "status":          "ok" if supabase_ok else "degraded",
        "supabase":        supabase_ok,
        "fal_key":         bool(os.environ.get("FAL_KEY")),
        "google_key":      bool(os.environ.get("GOOGLE_API_KEY")),
        "stripe_key":      bool(os.environ.get("STRIPE_SECRET_KEY")),
        "app_base_domain": os.environ.get("APP_BASE_DOMAIN", "não configurado"),
    }

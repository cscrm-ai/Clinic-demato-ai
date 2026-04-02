"""API FastAPI — All Belle Skin Analysis (White-label).

Serve frontend do paciente, painel admin e API de análise.
Cada deploy = uma clínica com branding próprio.
"""

import datetime
import json
import os
import shutil
import traceback
import uuid
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Limpa whitespace/newline das env vars críticas (evita "Illegal header value")
for _key in ("FAL_KEY", "GOOGLE_API_KEY", "BLOB_READ_WRITE_TOKEN", "ADMIN_PASSWORD"):
    _val = os.environ.get(_key, "")
    if _val != _val.strip():
        os.environ[_key] = _val.strip()

from fastapi import FastAPI, File, Header, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

from agent_api.agent import analyze_image
from storage.config import (
    DEFAULT_CONFIG,
    FONT_OPTIONS,
    delete_analysis,
    load_analyses,
    load_config,
    save_analysis,
    save_config,
    upload_logo,
)

import base64
import io

from PIL import Image as PilImage

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = Path("/tmp/clinic_uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


def _make_thumbnail_b64(file_path: str, max_width: int = 360) -> str:
    """Comprime imagem para thumbnail JPEG base64 (~30-60KB)."""
    try:
        with PilImage.open(file_path) as img:
            img = img.convert("RGB")
            w, h = img.size
            if w > max_width:
                ratio = max_width / w
                img = img.resize((max_width, int(h * ratio)), PilImage.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=68, optimize=True)
            return base64.b64encode(buf.getvalue()).decode()
    except Exception as e:
        print(f"[THUMBNAIL] Erro: {e}")
        return ""

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

app = FastAPI(title="Clinic Skin Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════

def _inject_config_into_html(html: str, config: dict) -> str:
    """Injeta CSS variables e config JSON no HTML."""
    colors = config.get("colors", DEFAULT_CONFIG["colors"])
    font = config.get("font", "Inter")

    css_vars = f"""<style>
:root {{
    --color-primary: {colors.get('primary', '#D99C94')};
    --color-secondary: {colors.get('secondary', '#827870')};
    --color-accent: {colors.get('accent', '#C4A265')};
    --color-background: {colors.get('background', '#FAF7F4')};
    --color-text: {colors.get('text', '#3A3330')};
    --font-main: '{font}', system-ui, sans-serif;
}}
</style>"""

    config_script = f"""<script>
window.__CLINIC_CONFIG__ = {json.dumps(config, ensure_ascii=False)};
</script>"""

    # Injeta antes do </head>
    html = html.replace("</head>", f"{css_vars}\n{config_script}\n</head>")
    return html


def _check_admin_auth(password: str | None) -> bool:
    """Verifica senha do admin."""
    return password == ADMIN_PASSWORD


# ═══════════════════════════════════════
# PATIENT-FACING ROUTES
# ═══════════════════════════════════════

@app.get("/")
async def index():
    """Tela do paciente — foto -> laudo."""
    config = load_config()
    html = (BASE_DIR / "templates" / "index.html").read_text()
    html = _inject_config_into_html(html, config)
    return HTMLResponse(
        content=html,
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@app.post("/analyze")
async def analyze(image: UploadFile = File(...)):
    """Upload foto -> Gemini + Moondream3 -> laudo JSON."""
    try:
        ext = Path(image.filename).suffix or ".jpg"
        unique_name = f"{uuid.uuid4().hex[:12]}{ext}"
        file_path = UPLOAD_DIR / unique_name

        with open(file_path, "wb") as f:
            shutil.copyfileobj(image.file, f)

        report = analyze_image(str(file_path.resolve()))
        result = report.model_dump()

        # Salva registro no histórico do admin
        try:
            thumb = _make_thumbnail_b64(str(file_path))
            record = {
                "id": unique_name[:16],
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "image_b64": thumb,
                "fitzpatrick_type": result.get("fitzpatrick_type", ""),
                "skin_type": result.get("skin_type", ""),
                "findings": [
                    {
                        "zone": f.get("zone", ""),
                        "description": f.get("description", ""),
                        "priority": f.get("priority", ""),
                        "x_point": f.get("x_point", 0),
                        "y_point": f.get("y_point", 0),
                        "procedimentos": [
                            p.get("nome", "") for p in f.get("procedimentos_indicados", [])
                        ],
                    }
                    for f in result.get("findings", [])
                ],
            }
            save_analysis(record)
        except Exception as e:
            print(f"[HISTORY] Erro ao salvar histórico: {e}")

        file_path.unlink(missing_ok=True)

        # Incrementa contador de analises
        try:
            config = load_config()
            config["analyses_count"] = config.get("analyses_count", 0) + 1
            save_config(config)
        except Exception:
            pass

        return result
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "type": type(e).__name__},
        )


# ═══════════════════════════════════════
# CONFIG API (public read, auth write)
# ═══════════════════════════════════════

@app.get("/api/config")
async def get_config():
    """Retorna config da clinica (publico)."""
    config = load_config()
    return config


# ═══════════════════════════════════════
# ADMIN ROUTES
# ═══════════════════════════════════════

@app.get("/admin")
async def admin_page():
    """Pagina do admin com login."""
    html = (BASE_DIR / "templates" / "admin.html").read_text()
    return HTMLResponse(
        content=html,
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@app.post("/api/admin/login")
async def admin_login(request: Request):
    """Verifica senha do admin."""
    body = await request.json()
    password = body.get("password", "")
    if _check_admin_auth(password):
        return {"ok": True}
    return JSONResponse(status_code=401, content={"error": "Senha incorreta"})


@app.get("/api/admin/config")
async def admin_get_config(x_admin_password: str | None = Header(None)):
    """Retorna config completa (requer auth)."""
    if not _check_admin_auth(x_admin_password):
        return JSONResponse(status_code=401, content={"error": "Nao autorizado"})
    config = load_config()
    config["_font_options"] = FONT_OPTIONS
    return config


@app.put("/api/admin/config")
async def admin_save_config(request: Request, x_admin_password: str | None = Header(None)):
    """Salva config atualizada (requer auth)."""
    if not _check_admin_auth(x_admin_password):
        return JSONResponse(status_code=401, content={"error": "Nao autorizado"})
    data = await request.json()
    # Remove campos internos
    data.pop("_font_options", None)
    save_config(data)
    return {"ok": True}


@app.post("/api/admin/logo")
async def admin_upload_logo(
    image: UploadFile = File(...),
    x_admin_password: str | None = Header(None),
):
    """Upload de logo da clinica."""
    if not _check_admin_auth(x_admin_password):
        return JSONResponse(status_code=401, content={"error": "Nao autorizado"})

    file_bytes = await image.read()
    filename = f"logo-{uuid.uuid4().hex[:8]}{Path(image.filename).suffix}"

    logo_url = upload_logo(file_bytes, filename)

    if logo_url:
        config = load_config()
        config["logo_url"] = logo_url
        save_config(config)
        return {"ok": True, "logo_url": logo_url}

    # Fallback: salva em /tmp e serve inline (sem Blob)
    logo_path = Path(f"/tmp/{filename}")
    logo_path.write_bytes(file_bytes)
    return {"ok": True, "logo_url": "", "note": "Blob nao configurado. Logo temporario."}


@app.get("/api/admin/analyses")
async def admin_get_analyses(x_admin_password: str | None = Header(None)):
    """Retorna histórico de análises (requer auth)."""
    if not _check_admin_auth(x_admin_password):
        return JSONResponse(status_code=401, content={"error": "Nao autorizado"})
    return load_analyses()


@app.delete("/api/admin/analyses/{analysis_id}")
async def admin_delete_analysis(
    analysis_id: str, x_admin_password: str | None = Header(None)
):
    """Remove análise do histórico (requer auth)."""
    if not _check_admin_auth(x_admin_password):
        return JSONResponse(status_code=401, content={"error": "Nao autorizado"})
    delete_analysis(analysis_id)
    return {"ok": True}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "fal_key": bool(os.environ.get("FAL_KEY")),
        "google_key": bool(os.environ.get("GOOGLE_API_KEY")),
        "blob_token": bool(os.environ.get("BLOB_READ_WRITE_TOKEN")),
        "admin_password_set": ADMIN_PASSWORD != "admin123",
    }

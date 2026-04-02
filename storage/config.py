"""Gerenciamento de configuração da clínica.

Usa /tmp como cache local e persiste no Vercel Blob quando disponível.
Fallback gracioso: se BLOB_READ_WRITE_TOKEN não estiver configurado,
funciona apenas com /tmp (como o app original).
"""

import json
import os
from pathlib import Path

import httpx

CONFIG_FILE = Path("/tmp/clinic_config.json")
ANALYSES_FILE = Path("/tmp/clinic_analyses.json")
BLOB_TOKEN = os.environ.get("BLOB_READ_WRITE_TOKEN", "")
BLOB_STORE_URL = "https://blob.vercel-storage.com"
CONFIG_BLOB_PATH = "clinic-config.json"
ANALYSES_BLOB_PATH = "clinic-analyses.json"
MAX_ANALYSES = 100

DEFAULT_CONFIG = {
    "clinic_name": "All Belle",
    "welcome_text": "Toda forma de beleza merece o melhor resultado.",
    "logo_url": "",
    "colors": {
        "primary": "#D9BFB2",
        "secondary": "#827870",
        "accent": "#D99C94",
        "background": "#F0EBE3",
        "text": "#3A3330",
    },
    "font": "Metropolis",
    "footer": {
        "phone": "",
        "instagram": "",
        "address": "",
    },
    "disclaimer": "Este laudo é orientativo e não substitui consulta médica presencial. Diagnósticos definitivos, prescrições e procedimentos exigem avaliação clínica completa por profissional habilitado.",
    "analyses_count": 0,
    "videos": [],  # lista de { "procedure": str, "url": str }
}

FONT_OPTIONS = [
    "Metropolis",
    "Inter",
    "DM Sans",
    "Outfit",
    "Plus Jakarta Sans",
    "Nunito Sans",
    "Cormorant Garamond",
    "Playfair Display",
    "Lora",
    "Source Serif 4",
]

# In-memory cache
_config_cache: dict | None = None


def _read_from_blob() -> dict | None:
    """Tenta ler config do Vercel Blob."""
    if not BLOB_TOKEN:
        return None
    try:
        resp = httpx.get(
            f"{BLOB_STORE_URL}/{CONFIG_BLOB_PATH}",
            headers={"Authorization": f"Bearer {BLOB_TOKEN}"},
            timeout=5,
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"[CONFIG] Erro ao ler Blob: {e}")
    return None


def _write_to_blob(data: dict) -> bool:
    """Tenta salvar config no Vercel Blob."""
    if not BLOB_TOKEN:
        return False
    try:
        resp = httpx.put(
            f"https://blob.vercel-storage.com/{CONFIG_BLOB_PATH}",
            headers={
                "Authorization": f"Bearer {BLOB_TOKEN}",
                "x-api-version": "7",
                "content-type": "application/json",
            },
            content=json.dumps(data, ensure_ascii=False),
            timeout=10,
        )
        return resp.status_code in (200, 201)
    except Exception as e:
        print(f"[CONFIG] Erro ao salvar Blob: {e}")
    return False


def load_config() -> dict:
    """Carrega config com fallback: cache -> /tmp -> Blob -> default."""
    global _config_cache

    if _config_cache is not None:
        return _config_cache

    # Tenta /tmp primeiro (rápido)
    if CONFIG_FILE.exists():
        try:
            _config_cache = json.loads(CONFIG_FILE.read_text())
            return _config_cache
        except (json.JSONDecodeError, ValueError):
            pass

    # Tenta Blob
    blob_data = _read_from_blob()
    if blob_data:
        _config_cache = blob_data
        # Salva em /tmp pra cache local
        CONFIG_FILE.write_text(json.dumps(blob_data, ensure_ascii=False, indent=2))
        return _config_cache

    # Default
    _config_cache = DEFAULT_CONFIG.copy()
    save_config(_config_cache)
    return _config_cache


def save_config(data: dict):
    """Salva config em /tmp + Blob (se disponível)."""
    global _config_cache
    _config_cache = data

    # Sempre salva em /tmp
    CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))

    # Tenta Blob
    _write_to_blob(data)


def _write_blob_bytes(path: str, data: bytes, content_type: str = "application/json") -> bool:
    """Escreve bytes diretamente no Blob."""
    if not BLOB_TOKEN:
        return False
    try:
        resp = httpx.put(
            f"https://blob.vercel-storage.com/{path}",
            headers={
                "Authorization": f"Bearer {BLOB_TOKEN}",
                "x-api-version": "7",
                "content-type": content_type,
            },
            content=data,
            timeout=10,
        )
        return resp.status_code in (200, 201)
    except Exception as e:
        print(f"[ANALYSES] Erro ao salvar Blob: {e}")
    return False


def load_analyses() -> list:
    """Carrega histórico de análises: /tmp → Blob → []."""
    if ANALYSES_FILE.exists():
        try:
            return json.loads(ANALYSES_FILE.read_text())
        except Exception:
            pass
    if BLOB_TOKEN:
        try:
            resp = httpx.get(
                f"{BLOB_STORE_URL}/{ANALYSES_BLOB_PATH}",
                headers={"Authorization": f"Bearer {BLOB_TOKEN}"},
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json()
                ANALYSES_FILE.write_text(json.dumps(data, ensure_ascii=False))
                return data
        except Exception as e:
            print(f"[ANALYSES] Erro ao ler Blob: {e}")
    return []


def save_analysis(record: dict):
    """Salva análise no histórico (max MAX_ANALYSES, mais recente primeiro)."""
    records = load_analyses()
    records.insert(0, record)
    records = records[:MAX_ANALYSES]
    encoded = json.dumps(records, ensure_ascii=False)
    ANALYSES_FILE.write_text(encoded)
    _write_blob_bytes(ANALYSES_BLOB_PATH, encoded.encode())


def delete_analysis(analysis_id: str):
    """Remove análise por ID."""
    records = load_analyses()
    records = [r for r in records if r.get("id") != analysis_id]
    encoded = json.dumps(records, ensure_ascii=False)
    ANALYSES_FILE.write_text(encoded)
    _write_blob_bytes(ANALYSES_BLOB_PATH, encoded.encode())


def upload_logo(file_bytes: bytes, filename: str) -> str:
    """Upload de logo para Vercel Blob. Retorna URL ou string vazia."""
    if not BLOB_TOKEN:
        return ""
    try:
        resp = httpx.put(
            f"https://blob.vercel-storage.com/logos/{filename}",
            headers={
                "Authorization": f"Bearer {BLOB_TOKEN}",
                "x-api-version": "7",
                "content-type": "application/octet-stream",
            },
            content=file_bytes,
            timeout=30,
        )
        if resp.status_code in (200, 201):
            result = resp.json()
            return result.get("url", "")
    except Exception as e:
        print(f"[LOGO] Erro ao upload: {e}")
    return ""

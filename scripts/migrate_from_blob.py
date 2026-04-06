"""Script de migração: sistema legado (Vercel Blob / /tmp) → Supabase.

Uso:
    python scripts/migrate_from_blob.py

O que faz:
  1. Lê BLOB_READ_WRITE_TOKEN e tenta baixar clinic-config.json e
     clinic-analyses.json do Vercel Blob
  2. Cria (ou reutiliza) uma clínica com subdomain 'legacy' no Supabase
  3. Copia o config inteiro para clinics.config JSONB
  4. Para cada análise antiga:
       - Decodifica image_b64 → bytes
       - Faz upload para Supabase Storage bucket 'analyses'
       - Insere registro na tabela analyses
  5. Imprime resumo

Pré-requisitos:
  - .env com SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BLOB_READ_WRITE_TOKEN
  - Migration 001_init.sql já aplicada no Supabase
"""

import base64
import json
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

import httpx

from db.supabase_client import (
    create_clinic,
    get_db,
    save_analysis,
    upload_analysis_image,
)

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

BLOB_TOKEN      = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
BLOB_STORE_URL  = "https://blob.vercel-storage.com"
LEGACY_SUBDOMAIN = "legacy"


# ---------------------------------------------------------------------------
# Helpers de leitura do Vercel Blob
# ---------------------------------------------------------------------------

def _read_blob_json(path: str) -> dict | list | None:
    """Tenta ler um arquivo JSON do Vercel Blob. Retorna None se falhar."""
    if not BLOB_TOKEN:
        return None
    try:
        resp = httpx.get(
            f"{BLOB_STORE_URL}/{path}",
            headers={"Authorization": f"Bearer {BLOB_TOKEN}"},
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json()
        print(f"  [BLOB] {path}: status {resp.status_code}")
    except Exception as e:
        print(f"  [BLOB] Erro ao ler {path}: {e}")
    return None


def _read_local_json(path: str) -> dict | list | None:
    """Tenta ler arquivo JSON local (/tmp). Retorna None se não existir."""
    p = Path(path)
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception as e:
            print(f"  [LOCAL] Erro ao ler {path}: {e}")
    return None


# ---------------------------------------------------------------------------
# Migração principal
# ---------------------------------------------------------------------------

def migrate() -> None:
    print("=" * 60)
    print("Migração: sistema legado → Supabase")
    print("=" * 60)

    db = get_db()

    # ── 1. Ler config legada ──────────────────────────────────────────────
    print("\n[1/4] Lendo config legada...")

    config = (
        _read_blob_json("clinic-config.json")
        or _read_local_json("/tmp/clinic_config.json")
    )

    if not config:
        print("  ⚠  Config não encontrada — usando config padrão vazia.")
        config = {}
    else:
        print(f"  ✅ Config lida: {config.get('clinic_name', '?')}")

    # ── 2. Criar ou reutilizar clínica 'legacy' ───────────────────────────
    print("\n[2/4] Criando clínica 'legacy' no Supabase...")

    existing = (
        db.table("clinics")
        .select("id, subdomain")
        .eq("subdomain", LEGACY_SUBDOMAIN)
        .execute()
    )

    if existing.data:
        clinic_id = existing.data[0]["id"]
        print(f"  ✅ Clínica 'legacy' já existe: {clinic_id}")
        # Atualiza config
        db.table("clinics").update({"config": config}).eq("id", clinic_id).execute()
        print("  ✅ Config atualizada.")
    else:
        # Busca plano Free
        free_plan = db.table("plans").select("id").eq("name", "Free").execute()
        plan_id   = free_plan.data[0]["id"] if free_plan.data else None

        clinic = create_clinic({
            "subdomain":   LEGACY_SUBDOMAIN,
            "name":        config.get("clinic_name", "Clínica Legada"),
            "owner_email": "",
            "plan_id":     plan_id,
            "config":      config,
            "status":      "active",
            "subscription_status": "active",
        })
        clinic_id = clinic["id"]
        print(f"  ✅ Clínica criada: {clinic_id}")

    # ── 3. Ler análises legadas ───────────────────────────────────────────
    print("\n[3/4] Lendo análises legadas...")

    analyses = (
        _read_blob_json("clinic-analyses.json")
        or _read_local_json("/tmp/clinic_analyses.json")
        or []
    )

    if not analyses:
        print("  ℹ  Nenhuma análise encontrada.")
    else:
        print(f"  ✅ {len(analyses)} análise(s) encontrada(s).")

    # ── 4. Migrar cada análise ────────────────────────────────────────────
    print("\n[4/4] Migrando análises...")

    ok_count   = 0
    fail_count = 0

    for idx, record in enumerate(analyses):
        old_id = record.get("id", f"legacy-{idx}")
        print(f"  [{idx+1}/{len(analyses)}] Migrando análise {old_id}...")

        # Upload da imagem se tiver base64
        image_path = ""
        image_b64  = record.get("image_b64", "")
        if image_b64:
            try:
                img_bytes  = base64.b64decode(image_b64)
                filename   = f"{uuid.uuid4().hex}.jpg"
                image_path = upload_analysis_image(clinic_id, img_bytes, filename)
                print(f"    ✅ Imagem enviada: {image_path}")
            except Exception as e:
                print(f"    ⚠  Erro ao enviar imagem: {e}")

        # Monta report no formato esperado por save_analysis
        report = {
            "fitzpatrick_type":    record.get("fitzpatrick_type", ""),
            "skin_type":           record.get("skin_type", ""),
            "findings":            record.get("findings", []),
            "plano_terapeutico":   None,
            "am_routine":          "",
            "pm_routine":          "",
            "general_observations": "",
        }

        try:
            saved = save_analysis(
                clinic_id=clinic_id,
                report=report,
                image_path=image_path,
                duration_ms=0,
                total_cost_cents=0.0,
            )
            print(f"    ✅ Análise salva: {saved['id']}")
            ok_count += 1
        except Exception as e:
            print(f"    ❌ Erro ao salvar análise: {e}")
            fail_count += 1

    # ── Resumo ────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("Migração concluída!")
    print(f"  Clínica:  legacy ({clinic_id})")
    print(f"  Análises: {ok_count} migradas, {fail_count} com erro")
    print()
    print("Próximos passos:")
    print("  1. Acesse o Supabase e verifique a clínica 'legacy'")
    print("  2. Atualize o subdomain para o subdomínio real da clínica")
    print("  3. Vincule um usuário admin via SQL:")
    print("     INSERT INTO clinic_members (clinic_id, user_id, role)")
    print(f"     VALUES ('{clinic_id}', '<user_uuid>', 'clinic_admin');")
    print("=" * 60)


if __name__ == "__main__":
    migrate()

"""Script standalone para sincronizar planos do Supabase com o Stripe.

Uso:
    python scripts/sync_stripe_plans.py

Pré-requisitos:
  - .env com SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e STRIPE_SECRET_KEY
  - Planos já inseridos na tabela public.plans (via migration 001_init.sql)

O script é idempotente: pode ser rodado múltiplas vezes sem duplicar
produtos ou preços no Stripe. Planos com price_cents = 0 (Free) são
ignorados (não criados no Stripe).
"""

import sys
from pathlib import Path

# Garante que o root do projeto está no path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

from billing.stripe_client import sync_plans_to_stripe


def main() -> None:
    print("=" * 60)
    print("Sincronizando planos Supabase → Stripe")
    print("=" * 60)

    results = sync_plans_to_stripe()

    print("\nResultado:")
    for r in results:
        plan = r.get("plan", "?")
        if r.get("skipped"):
            print(f"  ⏭  {plan} — ignorado ({r.get('reason')})")
        elif r.get("ok"):
            print(f"  ✅ {plan}")
            print(f"     product → {r['stripe_product_id']}")
            print(f"     price   → {r['stripe_price_id']}")
        else:
            print(f"  ❌ {plan} — ERRO: {r.get('error')}")

    errors = [r for r in results if not r.get("ok") and not r.get("skipped")]
    if errors:
        print(f"\n{len(errors)} erro(s) encontrado(s). Verifique as mensagens acima.")
        sys.exit(1)
    else:
        print("\nSincronização concluída com sucesso.")


if __name__ == "__main__":
    main()

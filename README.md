# Clinic Skin Analysis — SaaS Multi-Tenant

Plataforma SaaS de análise dermatológica com IA para clínicas estéticas.
Cada clínica acessa o sistema pelo próprio subdomínio: `{clinica}.cscrm.ai`

**Stack:** FastAPI · Gemini 2.0 Flash Lite · Moondream3 (FAL AI) · Supabase · Stripe · Vercel

---

## Arquitetura

```
{clinica}.cscrm.ai          → TenantMiddleware resolve clínica pelo subdomain
admin.cscrm.ai/super        → Painel super admin
POST /analyze               → Gemini + Moondream3 → laudo + custo gravado
POST /webhooks/stripe       → Eventos de billing (idempotente)
```

---

## 1. Setup Supabase

### 1.1 Criar projeto
- Acesse [app.supabase.com](https://app.supabase.com) e crie um projeto
- Região recomendada: `sa-east-1` (São Paulo)

### 1.2 Rodar a migration
No **SQL Editor** do Supabase, cole e execute o conteúdo de:
```
supabase/migrations/001_init.sql
```
Isso cria: 8 tabelas, índices, funções RLS, buckets de storage e 4 planos seed.

### 1.3 Inserir o primeiro super admin
Após criar sua conta no Supabase Auth (via magic link em `admin.cscrm.ai/super`),
execute no SQL Editor:

```sql
INSERT INTO public.super_admins (user_id)
VALUES (
    (SELECT id FROM auth.users WHERE email = 'seu@email.com')
);
```

### 1.4 Variáveis de ambiente
Copie as chaves em **Settings → API**:
```
SUPABASE_URL=https://SEU_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=eyJ...          # anon / public
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # service_role (NUNCA expor no frontend)
```

---

## 2. Setup Stripe

### 2.1 Criar conta e chaves
- Acesse [dashboard.stripe.com](https://dashboard.stripe.com)
- **Desenvolvedores → Chaves de API** — copie a Secret key e a Publishable key
- Use modo **Test** para desenvolvimento

### 2.2 Sincronizar planos
Com as variáveis configuradas no `.env`, rode:
```bash
python scripts/sync_stripe_plans.py
```
Isso cria Products e Prices no Stripe para os planos Starter, Pro e Enterprise,
e grava os IDs de volta na tabela `plans` do Supabase.

### 2.3 Criar endpoint de webhook
- No Stripe: **Desenvolvedores → Webhooks → Adicionar endpoint**
- URL: `https://SEU_DOMINIO/webhooks/stripe`
- Eventos a escutar:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.finalized`
  - `invoice.paid`
  - `invoice.payment_failed`
- Copie o **Webhook signing secret** → `STRIPE_WEBHOOK_SECRET`

### 2.4 Variáveis de ambiente
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PORTAL_RETURN_URL=https://admin.cscrm.ai/super
```

---

## 3. Setup DNS e Vercel

### 3.1 Wildcard DNS
No seu provedor DNS (ex: Cloudflare), adicione:
```
*.cscrm.ai     CNAME    cname.vercel-dns.com
admin.cscrm.ai CNAME    cname.vercel-dns.com
```

### 3.2 Domínios no Vercel
No painel do projeto Vercel (**Settings → Domains**), adicione:
```
*.cscrm.ai
admin.cscrm.ai
cscrm.ai
```

### 3.3 Variáveis de ambiente no Vercel
Em **Settings → Environment Variables**, adicione todas as variáveis do `.env.example`.

---

## 4. Variáveis de ambiente completas

Copie `.env.example` para `.env` e preencha:

```env
# Supabase
SUPABASE_URL=https://SEU_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI
FAL_KEY=
GOOGLE_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PORTAL_RETURN_URL=https://admin.cscrm.ai/super

# App
APP_BASE_DOMAIN=cscrm.ai
```

---

## 5. Desenvolvimento local

O middleware de tenant usa subdomínio real em produção.
Em desenvolvimento local, use o query param `?tenant=`:

```bash
# Instalar dependências
pip install -e .

# Rodar servidor
uvicorn api:app --reload --port 8000

# Acessar como clínica "demo"
http://localhost:8000/?tenant=demo

# Acessar admin da clínica "demo"
http://localhost:8000/admin?tenant=demo

# Super admin (lê como super portal)
http://localhost:8000/super?tenant=admin
```

Para criar uma clínica de teste, acesse o super admin e use o modal **Nova Clínica**.

---

## 6. Migração do sistema antigo (Vercel Blob)

Se você tinha dados no sistema single-tenant anterior (config + análises no Vercel Blob):

```bash
# Configure BLOB_READ_WRITE_TOKEN no .env
python scripts/migrate_from_blob.py
```

O script cria uma clínica com subdomain `legacy`, copia a config e migra
todas as análises (imagens base64 → Supabase Storage).

Após migrar, atualize o subdomain no Supabase Table Editor conforme necessário.

---

## 7. Estrutura do projeto

```
api.py                      # FastAPI app principal (28 rotas)
agent_api/agent.py          # Pipeline Gemini + Moondream3
tools/
  models.py                 # Pydantic schemas do laudo
  fal_points.py             # Integração Moondream3 via FAL
  cost_tracker.py           # Acumulador de custo por análise
db/
  supabase_client.py        # Camada de acesso Supabase (service_role)
middleware/
  tenant.py                 # Resolução de tenant por subdomínio (cache 60s)
auth/
  deps.py                   # Dependencies FastAPI (JWT, clinic_admin, super_admin)
billing/
  stripe_client.py          # Checkout, portal, cancel, sync planos
  limits.py                 # Verificação de quota por plano
  webhook.py                # Handler idempotente de eventos Stripe
scripts/
  sync_stripe_plans.py      # Sync planos Supabase → Stripe
  migrate_from_blob.py      # Migração do sistema legado
supabase/
  migrations/001_init.sql   # Schema completo + RLS + seed
templates/
  index.html                # Frontend do paciente
  admin.html                # Painel admin da clínica (magic link auth)
  super_admin.html          # Painel super admin (5 abas)
```

---

## 8. Próximos passos manuais

Após o deploy inicial, execute na ordem:

| # | Ação | Onde |
|---|---|---|
| 1 | Rodar `001_init.sql` | Supabase SQL Editor |
| 2 | Inserir primeiro super admin | Supabase SQL Editor |
| 3 | Configurar variáveis de ambiente | Vercel → Settings → Env Vars |
| 4 | Adicionar domínios `*.cscrm.ai` | Vercel → Settings → Domains |
| 5 | Configurar DNS wildcard | Cloudflare / provedor DNS |
| 6 | Rodar `sync_stripe_plans.py` | Terminal local com .env |
| 7 | Criar webhook no Stripe | Stripe Dashboard |
| 8 | Criar primeira clínica | admin.cscrm.ai/super |
| 9 | (Opcional) Migrar dados legados | `python scripts/migrate_from_blob.py` |

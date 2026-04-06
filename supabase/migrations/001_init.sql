-- =============================================================================
-- MIGRAÇÃO 001 — Schema inicial SaaS multi-tenant
-- Projeto: Clinic Skin Analysis
-- Executar no SQL Editor do Supabase (uma vez, em ordem)
-- =============================================================================


-- =============================================================================
-- EXTENSÕES
-- =============================================================================

create extension if not exists "uuid-ossp";


-- =============================================================================
-- TABELAS
-- =============================================================================

-- ----------------------------------------------------------------------------
-- plans — planos de assinatura disponíveis na plataforma
-- ----------------------------------------------------------------------------
create table if not exists public.plans (
    id                      uuid primary key default uuid_generate_v4(),
    name                    text not null,
    monthly_analyses_limit  int,                         -- null = ilimitado
    price_cents             int  not null default 0,
    currency                text not null default 'brl',
    interval                text not null default 'month'
                                check (interval in ('month', 'year')),
    stripe_product_id       text,
    stripe_price_id         text,
    features                jsonb not null default '{}',
    created_at              timestamptz not null default now()
);

comment on table  public.plans                         is 'Planos de assinatura do SaaS.';
comment on column public.plans.monthly_analyses_limit  is 'Limite de análises/mês. NULL = ilimitado (Enterprise).';
comment on column public.plans.price_cents             is 'Preço em centavos da moeda definida em currency.';
comment on column public.plans.stripe_product_id       is 'Preenchido pelo script sync_stripe_plans.py após criar no Stripe.';
comment on column public.plans.stripe_price_id         is 'Preenchido pelo script sync_stripe_plans.py após criar no Stripe.';


-- ----------------------------------------------------------------------------
-- clinics — cada clínica é um tenant independente
-- ----------------------------------------------------------------------------
create table if not exists public.clinics (
    id                      uuid primary key default uuid_generate_v4(),
    subdomain               text not null unique
                                check (subdomain ~ '^[a-z0-9-]{3,30}$'),
    name                    text not null,
    plan_id                 uuid references public.plans(id) on delete set null,
    status                  text not null default 'trial'
                                check (status in ('trial', 'active', 'suspended', 'canceled')),
    config                  jsonb not null default '{}',
    owner_email             text,
    stripe_customer_id      text unique,
    stripe_subscription_id  text unique,
    subscription_status     text not null default 'trialing'
                                check (subscription_status in (
                                    'trialing', 'active', 'past_due',
                                    'canceled', 'unpaid', 'incomplete'
                                )),
    current_period_end      timestamptz,
    cancel_at_period_end    boolean not null default false,
    trial_ends_at           timestamptz,
    created_at              timestamptz not null default now()
);

comment on table  public.clinics                       is 'Cada linha representa um tenant (clínica) com seu próprio subdomínio.';
comment on column public.clinics.subdomain             is 'Usado para roteamento: {subdomain}.cscrm.ai';
comment on column public.clinics.config                is 'JSON de branding/configuração (clinic_name, colors, font, videos, etc.).';
comment on column public.clinics.status                is 'trial | active | suspended | canceled — controlado pelo super admin e pelo webhook Stripe.';
comment on column public.clinics.subscription_status   is 'Espelho do status da subscription no Stripe. Atualizado pelo webhook.';


-- ----------------------------------------------------------------------------
-- super_admins — usuários com acesso total à plataforma (admin.cscrm.ai)
-- ----------------------------------------------------------------------------
create table if not exists public.super_admins (
    user_id     uuid primary key references auth.users(id) on delete cascade,
    created_at  timestamptz not null default now()
);

comment on table public.super_admins is 'Usuários que têm acesso ao painel super admin.';


-- ----------------------------------------------------------------------------
-- clinic_members — membros de cada clínica (admins, viewers)
-- ----------------------------------------------------------------------------
create table if not exists public.clinic_members (
    id          uuid primary key default uuid_generate_v4(),
    clinic_id   uuid not null references public.clinics(id) on delete cascade,
    user_id     uuid references auth.users(id) on delete cascade,
    role        text not null default 'clinic_admin'
                    check (role in ('clinic_admin', 'viewer')),
    created_at  timestamptz not null default now(),
    unique (clinic_id, user_id)
);

comment on table  public.clinic_members          is 'Vínculo entre usuários Supabase Auth e clínicas.';
comment on column public.clinic_members.role     is 'clinic_admin: pode editar config e ver análises. viewer: somente leitura.';


-- ----------------------------------------------------------------------------
-- analyses — cada análise dermatológica realizada por uma clínica
-- ----------------------------------------------------------------------------
create table if not exists public.analyses (
    id                  uuid primary key default uuid_generate_v4(),
    clinic_id           uuid not null references public.clinics(id) on delete cascade,
    created_at          timestamptz not null default now(),
    fitzpatrick_type    text,
    skin_type           text,
    findings            jsonb,
    plano_terapeutico   jsonb,
    am_routine          text,
    pm_routine          text,
    general_observations text,
    image_path          text,      -- path no bucket "analyses" do Supabase Storage
    duration_ms         int,
    total_cost_cents    numeric(10, 4) not null default 0
);

comment on table  public.analyses               is 'Laudos gerados pelo pipeline Gemini + Moondream3.';
comment on column public.analyses.image_path    is 'Caminho relativo no bucket analyses: {clinic_id}/{uuid}.jpg';
comment on column public.analyses.total_cost_cents is 'Custo total em centavos de BRL (Gemini + Moondream acumulado pelo CostAccumulator).';


-- ----------------------------------------------------------------------------
-- usage_events — rastreamento granular de custo por chamada de AI
-- ----------------------------------------------------------------------------
create table if not exists public.usage_events (
    id          uuid primary key default uuid_generate_v4(),
    clinic_id   uuid not null references public.clinics(id) on delete cascade,
    analysis_id uuid references public.analyses(id) on delete set null,
    provider    text not null
                    check (provider in ('gemini', 'moondream_fal')),
    operation   text not null,    -- ex: 'generate_report', 'locate_finding'
    tokens_in   int  not null default 0,
    tokens_out  int  not null default 0,
    calls       int  not null default 1,
    cost_cents  numeric(10, 6) not null default 0,
    latency_ms  int,
    created_at  timestamptz not null default now()
);

comment on table  public.usage_events          is 'Evento de uso de AI por análise (Gemini tokens + Moondream calls).';
comment on column public.usage_events.cost_cents is 'Custo individual em centavos de BRL com 6 casas decimais para acumulação precisa.';


-- ----------------------------------------------------------------------------
-- invoices — faturas Stripe espelhadas localmente
-- ----------------------------------------------------------------------------
create table if not exists public.invoices (
    id                  uuid primary key default uuid_generate_v4(),
    clinic_id           uuid not null references public.clinics(id) on delete cascade,
    stripe_invoice_id   text not null unique,
    amount_cents        int  not null,
    currency            text not null default 'brl',
    status              text,
    hosted_invoice_url  text,
    invoice_pdf         text,
    period_start        timestamptz,
    period_end          timestamptz,
    paid_at             timestamptz,
    created_at          timestamptz not null default now()
);

comment on table public.invoices is 'Espelho local das invoices do Stripe. Populado pelo webhook invoice.finalized / invoice.paid.';


-- ----------------------------------------------------------------------------
-- payment_events — log de todos os webhooks Stripe recebidos
-- ----------------------------------------------------------------------------
create table if not exists public.payment_events (
    id               uuid primary key default uuid_generate_v4(),
    stripe_event_id  text not null unique,  -- idempotência: checar antes de processar
    type             text not null,
    clinic_id        uuid references public.clinics(id) on delete set null,
    payload          jsonb,
    processed        boolean not null default false,
    error            text,
    created_at       timestamptz not null default now()
);

comment on table  public.payment_events                is 'Log de todos os eventos de webhook Stripe. stripe_event_id é a chave de idempotência.';
comment on column public.payment_events.stripe_event_id is 'ID do evento no Stripe (evt_...). Checar processed=true antes de re-processar.';


-- =============================================================================
-- ÍNDICES
-- =============================================================================

create index if not exists idx_analyses_clinic_created
    on public.analyses (clinic_id, created_at desc);

create index if not exists idx_usage_events_clinic_created
    on public.usage_events (clinic_id, created_at desc);

create index if not exists idx_usage_events_provider_created
    on public.usage_events (provider, created_at);

create index if not exists idx_invoices_clinic_created
    on public.invoices (clinic_id, created_at desc);

create index if not exists idx_clinics_subdomain
    on public.clinics (subdomain);


-- =============================================================================
-- FUNÇÕES HELPER (usadas nas policies de RLS)
-- =============================================================================

-- Verifica se o usuário autenticado é super admin
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
as $$
    select exists (
        select 1
        from public.super_admins
        where user_id = auth.uid()
    );
$$;

comment on function public.is_super_admin is 'Retorna true se auth.uid() está na tabela super_admins.';


-- Retorna os IDs de clínicas às quais o usuário autenticado pertence
create or replace function public.user_clinic_ids()
returns uuid[]
language sql
stable
security definer
as $$
    select coalesce(array_agg(clinic_id), '{}')
    from public.clinic_members
    where user_id = auth.uid();
$$;

comment on function public.user_clinic_ids is 'Retorna array de clinic_id do usuário autenticado em clinic_members.';


-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

-- Habilitar RLS em todas as tabelas
alter table public.plans            enable row level security;
alter table public.clinics          enable row level security;
alter table public.super_admins     enable row level security;
alter table public.clinic_members   enable row level security;
alter table public.analyses         enable row level security;
alter table public.usage_events     enable row level security;
alter table public.invoices         enable row level security;
alter table public.payment_events   enable row level security;


-- ----------------------------------------------------------------------------
-- plans — leitura pública (necessário para mostrar pricing page)
-- ----------------------------------------------------------------------------
create policy "plans_select_public"
    on public.plans for select
    using (true);

create policy "plans_all_super_admin"
    on public.plans for all
    using (public.is_super_admin())
    with check (public.is_super_admin());


-- ----------------------------------------------------------------------------
-- clinics
-- ----------------------------------------------------------------------------
create policy "clinics_all_super_admin"
    on public.clinics for all
    using (public.is_super_admin())
    with check (public.is_super_admin());

create policy "clinics_select_clinic_admin"
    on public.clinics for select
    using (id = any(public.user_clinic_ids()));

create policy "clinics_update_clinic_admin"
    on public.clinics for update
    using (id = any(public.user_clinic_ids()))
    with check (id = any(public.user_clinic_ids()));


-- ----------------------------------------------------------------------------
-- super_admins — só super admin pode ver/editar (bootstrap: inserir via SQL)
-- ----------------------------------------------------------------------------
create policy "super_admins_all_super_admin"
    on public.super_admins for all
    using (public.is_super_admin())
    with check (public.is_super_admin());


-- ----------------------------------------------------------------------------
-- clinic_members
-- ----------------------------------------------------------------------------
create policy "clinic_members_all_super_admin"
    on public.clinic_members for all
    using (public.is_super_admin())
    with check (public.is_super_admin());

-- Cada usuário enxerga apenas seus próprios vínculos
create policy "clinic_members_select_own"
    on public.clinic_members for select
    using (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- analyses
-- ----------------------------------------------------------------------------
create policy "analyses_all_super_admin"
    on public.analyses for all
    using (public.is_super_admin())
    with check (public.is_super_admin());

create policy "analyses_select_clinic_admin"
    on public.analyses for select
    using (clinic_id = any(public.user_clinic_ids()));

create policy "analyses_delete_clinic_admin"
    on public.analyses for delete
    using (clinic_id = any(public.user_clinic_ids()));


-- ----------------------------------------------------------------------------
-- usage_events
-- ----------------------------------------------------------------------------
create policy "usage_events_all_super_admin"
    on public.usage_events for all
    using (public.is_super_admin())
    with check (public.is_super_admin());

create policy "usage_events_select_clinic_admin"
    on public.usage_events for select
    using (clinic_id = any(public.user_clinic_ids()));


-- ----------------------------------------------------------------------------
-- invoices
-- ----------------------------------------------------------------------------
create policy "invoices_all_super_admin"
    on public.invoices for all
    using (public.is_super_admin())
    with check (public.is_super_admin());

create policy "invoices_select_clinic_admin"
    on public.invoices for select
    using (clinic_id = any(public.user_clinic_ids()));


-- ----------------------------------------------------------------------------
-- payment_events — exclusivo para super admin (dados sensíveis do Stripe)
-- ----------------------------------------------------------------------------
create policy "payment_events_all_super_admin"
    on public.payment_events for all
    using (public.is_super_admin())
    with check (public.is_super_admin());


-- =============================================================================
-- STORAGE — buckets e políticas
-- =============================================================================

-- Bucket privado para imagens de análises
insert into storage.buckets (id, name, public)
values ('analyses', 'analyses', false)
on conflict (id) do nothing;

-- Bucket público para logos das clínicas
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;


-- Políticas do bucket "analyses" (privado)
create policy "analyses_bucket_super_admin_all"
    on storage.objects for all
    using (
        bucket_id = 'analyses'
        and public.is_super_admin()
    )
    with check (
        bucket_id = 'analyses'
        and public.is_super_admin()
    );

-- clinic_admin pode acessar apenas arquivos dentro do seu {clinic_id}/
create policy "analyses_bucket_clinic_admin_select"
    on storage.objects for select
    using (
        bucket_id = 'analyses'
        and (storage.foldername(name))[1]::uuid = any(public.user_clinic_ids())
    );

create policy "analyses_bucket_clinic_admin_insert"
    on storage.objects for insert
    with check (
        bucket_id = 'analyses'
        and (storage.foldername(name))[1]::uuid = any(public.user_clinic_ids())
    );

create policy "analyses_bucket_clinic_admin_delete"
    on storage.objects for delete
    using (
        bucket_id = 'analyses'
        and (storage.foldername(name))[1]::uuid = any(public.user_clinic_ids())
    );


-- Políticas do bucket "logos" (público para leitura, restrito para escrita)
create policy "logos_bucket_public_select"
    on storage.objects for select
    using (bucket_id = 'logos');

create policy "logos_bucket_super_admin_all"
    on storage.objects for all
    using (
        bucket_id = 'logos'
        and public.is_super_admin()
    )
    with check (
        bucket_id = 'logos'
        and public.is_super_admin()
    );

create policy "logos_bucket_clinic_admin_insert"
    on storage.objects for insert
    with check (
        bucket_id = 'logos'
        and (storage.foldername(name))[1]::uuid = any(public.user_clinic_ids())
    );

create policy "logos_bucket_clinic_admin_delete"
    on storage.objects for delete
    using (
        bucket_id = 'logos'
        and (storage.foldername(name))[1]::uuid = any(public.user_clinic_ids())
    );


-- =============================================================================
-- SEED — planos iniciais
-- =============================================================================

insert into public.plans
    (name, monthly_analyses_limit, price_cents, currency, interval, features)
values
    (
        'Free',
        50,
        0,
        'brl',
        'month',
        '{"badge": "Grátis", "highlight": false, "description": "Ideal para testar a plataforma"}'
    ),
    (
        'Starter',
        300,
        29700,
        'brl',
        'month',
        '{"badge": "Starter", "highlight": false, "description": "Para clínicas em crescimento"}'
    ),
    (
        'Pro',
        1500,
        69700,
        'brl',
        'month',
        '{"badge": "Pro", "highlight": true, "description": "Para clínicas com alto volume"}'
    ),
    (
        'Enterprise',
        null,
        199700,
        'brl',
        'month',
        '{"badge": "Enterprise", "highlight": false, "description": "Análises ilimitadas e suporte prioritário"}'
    )
on conflict do nothing;

-- stripe_product_id e stripe_price_id ficam null aqui.
-- Preencher rodando: python scripts/sync_stripe_plans.py


-- =============================================================================
-- COMO INSERIR O PRIMEIRO SUPER ADMIN
-- =============================================================================
--
-- 1. Faça login na sua conta Supabase (via magic link ou social)
-- 2. No SQL Editor do Supabase, rode:
--
--    insert into public.super_admins (user_id)
--    values (
--        (select id from auth.users where email = 'seu@email.com')
--    );
--
-- 3. A partir daí, o usuário tem acesso total a admin.cscrm.ai/super
--    e às policies que dependem de is_super_admin().
--
-- ATENÇÃO: Nunca exponha a service_role key no frontend.
-- O backend Python usa service_role e já bypassa RLS de propósito.
-- As policies existem para proteger acessos diretos via client anon key.
-- =============================================================================

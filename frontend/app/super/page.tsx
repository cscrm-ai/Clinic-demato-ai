"use client";

import { useEffect, useState } from "react";
import { getCookie, setCookie, deleteCookie, apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Clinic = {
  id: string;
  subdomain: string;
  name: string;
  status: string;
  subscription_status: string;
  owner_email: string;
  plan_name: string;
  usage_this_month: number | { analyses_count?: number; total_cost_cents?: number; period?: string };
  setup_fee_cents: number;
  setup_fee_paid: boolean;
  setup_fee_paid_at?: string;
  created_at: string;
};

type Plan = { id: string; name: string; price_cents: number; monthly_analyses_limit?: number | null };
type Usage = {
  id?: string;
  created_at: string;
  clinic_id?: string;
  analysis_id?: string;
  provider?: string;
  operation?: string;
  cost_cents?: number;
  latency_ms?: number;
  clinics?: { name?: string; subdomain?: string };
  analyses?: { duration_ms?: number; skin_type?: string; fitzpatrick_type?: string; created_at?: string; total_cost_cents?: number };
};

type Invoice = {
  clinic_name?: string;
  date?: number;
  amount_paid?: number;
  status?: string;
  invoice_pdf?: string;
  hosted_invoice_url?: string;
};
type Overview = Record<string, unknown>;

function statusBadge(s: string) {
  const map: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
    active: "default",
    trialing: "secondary",
    past_due: "destructive",
    suspended: "destructive",
    canceled: "outline",
  };
  return <Badge variant={map[s] || "outline"}>{s}</Badge>;
}

export default function SuperAdminPage() {
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  // New clinic modal
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ subdomain: "", name: "", owner_email: "", plan_id: "", setup_fee: "" });
  const [newLoading, setNewLoading] = useState(false);
  const [newMsg, setNewMsg] = useState({ text: "", ok: false });

  // Active tab
  const [activeTab, setActiveTab] = useState("dashboard");

  // Dashboard period filter
  const [dashPeriod, setDashPeriod] = useState("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Expanded analysis in usage tab
  const [expandedAnalysis, setExpandedAnalysis] = useState<string | null>(null);
  const [analysisDetail, setAnalysisDetail] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function loadAnalysisDetail(analysisId: string) {
    setDetailLoading(true);
    setAnalysisDetail(null);
    const r = await apiFetch(`/api/super/usage/${analysisId}`);
    if (r.ok) setAnalysisDetail(await r.json());
    setDetailLoading(false);
  }

  // Model costs
  const [modelCosts, setModelCosts] = useState<Record<string, string>>({});
  const [costsSaving, setCostsSaving] = useState(false);
  const [costsMsg, setCostsMsg] = useState("");

  // Filters
  const [clinicFilter, setClinicFilter] = useState("all");
  const [clinicSearch, setClinicSearch] = useState("");

  useEffect(() => {
    if (getCookie("sb-access-token")) setAuthed(true);
  }, []);

  useEffect(() => {
    if (!authed) return;
    loadOverview();
    loadClinics();
    loadPlans();
  }, [authed]);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await resp.json();
      if (resp.ok && (data.access_token || data.token)) {
        setCookie("sb-access-token", data.access_token || data.token, 7);
        setAuthed(true);
      } else {
        setLoginError(data.error || "Credenciais inválidas.");
      }
    } catch {
      setLoginError("Erro de conexão.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function doLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    deleteCookie("sb-access-token");
    setAuthed(false);
  }

  async function loadOverview(period?: string) {
    const p = period || dashPeriod;
    let url: string;
    if (p.startsWith("custom&")) {
      url = `/api/super/overview?${p}`;
    } else {
      url = `/api/super/overview?days=${p}`;
    }
    const r = await apiFetch(url);
    if (!r.ok) return;
    const data = await r.json();
    setOverview(data);
  }

  async function loadClinics() {
    const r = await apiFetch("/api/super/clinics");
    if (r.ok) setClinics(await r.json());
  }

  async function loadPlans() {
    const r = await apiFetch("/api/super/plans");
    if (r.ok) setPlans(await r.json());
  }

  async function loadUsage() {
    const r = await apiFetch("/api/super/usage");
    if (r.ok) setUsage(await r.json());
  }

  async function loadModelCosts() {
    const r = await apiFetch("/api/super/model-costs");
    if (r.ok) setModelCosts(await r.json());
  }

  async function saveModelCosts() {
    setCostsSaving(true);
    setCostsMsg("");
    const r = await apiFetch("/api/super/model-costs", {
      method: "POST",
      body: JSON.stringify(modelCosts),
    });
    setCostsSaving(false);
    setCostsMsg(r.ok ? "Salvo!" : "Erro ao salvar.");
    setTimeout(() => setCostsMsg(""), 3000);
  }

  async function loadInvoices() {
    const r = await apiFetch("/api/super/billing/invoices");
    if (r.ok) setInvoices(await r.json());
  }

  async function toggleClinic(id: string, action: "activate" | "suspend") {
    if (!confirm(`${action === "activate" ? "Ativar" : "Suspender"} esta clínica?`)) return;
    await apiFetch(`/api/super/clinics/${id}/${action}`, { method: "POST" });
    loadClinics();
  }

  async function deleteClinic(id: string, name: string) {
    if (!confirm(`Excluir "${name}" permanentemente?`)) return;
    await apiFetch(`/api/super/clinics/${id}`, { method: "DELETE" });
    loadClinics();
  }

  async function createClinic() {
    if (!newForm.subdomain || !newForm.name || !newForm.owner_email || !newForm.plan_id) {
      setNewMsg({ text: "Preencha todos os campos.", ok: false });
      return;
    }
    setNewLoading(true);
    setNewMsg({ text: "", ok: false });
    const r = await apiFetch("/api/super/clinics", {
      method: "POST",
      body: JSON.stringify({
        ...newForm,
        setup_fee_cents: newForm.setup_fee ? Math.round(Number(newForm.setup_fee) * 100) : 0,
      }),
    });
    const data = await r.json();
    if (r.ok && data.id) {
      setNewMsg({ text: "Clínica criada! E-mail de acesso enviado.", ok: true });
      loadClinics();
      setNewForm({ subdomain: "", name: "", owner_email: "", plan_id: "", setup_fee: "" });
    } else {
      setNewMsg({ text: data.detail || data.error || "Erro ao criar.", ok: false });
    }
    setNewLoading(false);
  }

  // Chart data: last 30 days
  const chartData = (() => {
    const raw = Array.isArray(overview?.chart_data) ? (overview.chart_data as { date: string; count: number }[]) : [];
    if (raw.length) return raw.map((d) => ({ date: String(d.date || "").slice(5), val: Number(d.count) || 0 }));
    // Generate empty 30-day array
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      return { date: `${d.getDate()}/${d.getMonth() + 1}`, val: 0 };
    });
  })();

  const filteredClinics = clinics.filter((c) => {
    if (clinicFilter !== "all" && c.status !== clinicFilter) return false;
    if (clinicSearch && !c.name.toLowerCase().includes(clinicSearch.toLowerCase()) &&
      !c.subdomain.toLowerCase().includes(clinicSearch.toLowerCase())) return false;
    return true;
  });

  // ─── Login ─────────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <main className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-6">
        <Card className="w-full max-w-sm shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="text-3xl mb-1">🛡️</div>
            <CardTitle>Super Admin</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Acesso restrito à equipe interna.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={doLogin} className="space-y-4">
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Senha</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {loginError && <p className="text-sm text-destructive">{loginError}</p>}
              <Button type="submit" className="w-full" disabled={loginLoading}>
                {loginLoading ? "Entrando…" : "Entrar"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-100 fixed top-0 left-0 h-full flex flex-col z-20">
        <div className="p-5 border-b border-gray-100">
          <span className="font-bold text-[#3A3330]">allbele.app</span>
          <p className="text-xs text-muted-foreground">Super Admin</p>
        </div>
        <nav className="flex-1 py-2">
          {([
            ["dashboard", "📊 Dashboard"],
            ["clinicas", "🏥 Clínicas"],
            ["uso", "📈 Uso & Custos"],
            ["financeiro", "💳 Financeiro"],
            ["planos", "📦 Planos"],
            ["config", "⚙️ Configurações"],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (tab === "uso") loadUsage();
                if (tab === "financeiro") loadInvoices();
                if (tab === "planos") loadPlans();
                if (tab === "config") loadModelCosts();
              }}
              className={`w-full text-left px-5 py-2.5 text-sm transition-colors ${
                activeTab === tab
                  ? "bg-[#F5F0EB] font-semibold text-[#3A3330]"
                  : "text-[#3A3330] hover:bg-[#F5F0EB]"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-100">
          <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={doLogout}>
            Sair
          </Button>
        </div>
      </aside>

      {/* Main */}
      <main className="ml-56 flex-1 p-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="hidden">
            {["dashboard", "clinicas", "uso", "financeiro", "planos", "config"].map((t) => (
              <TabsTrigger key={t} value={t} />
            ))}
          </TabsList>

          {/* ── Dashboard ── */}
          <TabsContent value="dashboard">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-bold text-[#3A3330]">Dashboard</h1>
              <div className="flex items-center gap-2">
                <Select value={dashPeriod} onValueChange={(v) => {
                  const val = v ?? "30";
                  setDashPeriod(val);
                  if (val !== "custom") loadOverview(val);
                }}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Hoje</SelectItem>
                    <SelectItem value="2">Ontem + Hoje</SelectItem>
                    <SelectItem value="7">Últimos 7 dias</SelectItem>
                    <SelectItem value="15">Últimos 15 dias</SelectItem>
                    <SelectItem value="30">Últimos 30 dias</SelectItem>
                    <SelectItem value="60">Últimos 60 dias</SelectItem>
                    <SelectItem value="90">Últimos 90 dias</SelectItem>
                    <SelectItem value="365">Último ano</SelectItem>
                    <SelectItem value="custom">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
                {dashPeriod === "custom" && (
                  <>
                    <Input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="w-36 h-9 text-xs"
                    />
                    <span className="text-xs text-muted-foreground">até</span>
                    <Input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="w-36 h-9 text-xs"
                    />
                    <Button size="sm" className="h-9" onClick={() => {
                      if (customFrom && customTo) {
                        loadOverview(`custom&from=${customFrom}&to=${customTo}`);
                      }
                    }}>Aplicar</Button>
                  </>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
              {[
                { label: dashPeriod === "custom" ? `Análises (${customFrom} a ${customTo})` : dashPeriod === "1" ? "Análises (hoje)" : `Análises (${dashPeriod}d)`, value: overview?.analyses_period, color: "#D99C94" },
                { label: "Clínicas ativas", value: overview?.active_clinics, color: "#22c55e" },
                { label: "Total clínicas", value: overview?.total_clinics, color: "#3b82f6" },
                { label: "MRR", value: overview?.mrr_cents ? `R$ ${(Number(overview.mrr_cents) / 100).toFixed(0)}` : null, color: "#8b5cf6" },
                { label: dashPeriod === "custom" ? "Custo (período)" : dashPeriod === "1" ? "Custo (hoje)" : `Custo (${dashPeriod}d)`, value: overview?.cost_period_cents ? `R$ ${(Number(overview.cost_period_cents) / 100).toFixed(2)}` : null, color: "#f97316" },
                { label: "Inadimplentes", value: overview?.past_due_clinics, color: "#ef4444" },
              ].map((m) => (
                <Card key={m.label}>
                  <CardContent className="pt-5 pb-4">
                    <p className="text-2xl font-bold" style={{ color: m.color }}>{m.value != null ? String(m.value) : "—"}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{m.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Análises — últimos {dashPeriod} dias</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData}>
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="val" fill="#D99C94" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Chart: analyses + cost per clinic — from overview (period-filtered) */}
            {Array.isArray(overview?.clinic_chart) && (overview.clinic_chart as { name: string; analyses: number; cost: number }[]).length > 0 && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="text-base">
                    Análises e custo por clínica {dashPeriod === "custom" ? `(${customFrom} a ${customTo})` : dashPeriod === "1" ? "(hoje)" : `(${dashPeriod}d)`}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={Math.max(200, (overview.clinic_chart as unknown[]).length * 50)}>
                    <BarChart
                      data={overview.clinic_chart as { name: string; analyses: number; cost: number }[]}
                      layout="vertical"
                      margin={{ left: 80 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={75} />
                      <Tooltip formatter={(v, name) => [name === "Custo (R$)" ? `R$ ${Number(v).toFixed(2)}` : v, name === "Custo (R$)" ? "Custo" : "Análises"]} />
                      <Bar dataKey="analyses" fill="#D99C94" radius={[0, 4, 4, 0]} name="Análises" />
                      <Bar dataKey="cost" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Custo (R$)" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Clínicas ── */}
          <TabsContent value="clinicas">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-[#3A3330]">Clínicas</h1>
                <Button onClick={() => setNewOpen(true)}>+ Nova clínica</Button>
              </div>

              <div className="flex gap-3">
                <Select value={clinicFilter} onValueChange={(v) => setClinicFilter(v ?? "all")}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os status</SelectItem>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="suspended">Suspenso</SelectItem>
                    <SelectItem value="canceled">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Buscar…"
                  value={clinicSearch}
                  onChange={(e) => setClinicSearch(e.target.value)}
                  className="max-w-xs"
                />
              </div>

              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subdomínio</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Plano</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Assinatura</TableHead>
                        <TableHead>Uso/mês</TableHead>
                        <TableHead>Implementação</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredClinics.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-sm font-mono">{c.subdomain}</TableCell>
                          <TableCell className="text-sm">{c.name}</TableCell>
                          <TableCell className="text-sm">{c.plan_name || "—"}</TableCell>
                          <TableCell>{statusBadge(c.status)}</TableCell>
                          <TableCell>{statusBadge(c.subscription_status || "—")}</TableCell>
                          <TableCell className="text-sm">
                            {typeof c.usage_this_month === "object"
                              ? (c.usage_this_month?.analyses_count ?? 0)
                              : (c.usage_this_month ?? 0)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono">
                                R$ {((c.setup_fee_cents || 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 0 })}
                              </span>
                              {c.setup_fee_cents > 0 && (
                                <Badge
                                  variant={c.setup_fee_paid ? "default" : "destructive"}
                                  className="text-[10px] cursor-pointer"
                                  onClick={async () => {
                                    const newPaid = !c.setup_fee_paid;
                                    await apiFetch(`/api/super/clinics/${c.id}`, {
                                      method: "PATCH",
                                      body: JSON.stringify({
                                        setup_fee_paid: newPaid,
                                        setup_fee_paid_at: newPaid ? new Date().toISOString() : null,
                                      }),
                                    });
                                    loadClinics();
                                  }}
                                >
                                  {c.setup_fee_paid ? "✓ Pago" : "Pendente"}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs"
                                onClick={() => {
                                  const url = `https://${c.subdomain}.allbele.app`;
                                  navigator.clipboard.writeText(url);
                                  alert(`Link copiado: ${url}`);
                                }}
                              >
                                📋 Paciente
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs"
                                onClick={() => {
                                  const url = `https://${c.subdomain}.allbele.app/admin`;
                                  navigator.clipboard.writeText(url);
                                  alert(`Link copiado: ${url}`);
                                }}
                              >
                                📋 Admin
                              </Button>
                              {c.status === "active" ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs"
                                  onClick={() => toggleClinic(c.id, "suspend")}
                                >
                                  Suspender
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs"
                                  onClick={() => toggleClinic(c.id, "activate")}
                                >
                                  Ativar
                                </Button>
                              )}
                              <Button
                                variant="destructive"
                                size="sm"
                                className="text-xs"
                                onClick={() => deleteClinic(c.id, c.name)}
                              >
                                Excluir
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            {/* New Clinic Modal */}
            <Dialog open={newOpen} onOpenChange={setNewOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nova clínica</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  <div className="space-y-2">
                    <Label>Subdomínio</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        placeholder="minhaclinica"
                        value={newForm.subdomain}
                        onChange={(e) => setNewForm({ ...newForm, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                      />
                      <span className="text-sm text-muted-foreground whitespace-nowrap">.allbele.app</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Nome</Label>
                    <Input
                      placeholder="Nome da clínica"
                      value={newForm.name}
                      onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail do responsável</Label>
                    <Input
                      type="email"
                      placeholder="responsavel@clinica.com"
                      value={newForm.owner_email}
                      onChange={(e) => setNewForm({ ...newForm, owner_email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Plano</Label>
                    <Select value={newForm.plan_id} onValueChange={(v) => setNewForm({ ...newForm, plan_id: v ?? "" })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecionar plano…" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} — R$ {(p.price_cents / 100).toFixed(0)}/mês
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Taxa de implementação (R$)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00 (sem taxa)"
                      value={newForm.setup_fee}
                      onChange={(e) => setNewForm({ ...newForm, setup_fee: e.target.value })}
                    />
                  </div>
                  {newMsg.text && (
                    <p className={`text-sm ${newMsg.ok ? "text-green-600" : "text-destructive"}`}>
                      {newMsg.text}
                    </p>
                  )}
                  <Button className="w-full" onClick={createClinic} disabled={newLoading}>
                    {newLoading ? "Criando…" : "Criar clínica"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* ── Uso & Custos ── */}
          <TabsContent value="uso">
            <h1 className="text-2xl font-bold text-[#3A3330] mb-4">Uso & Custos</h1>
            {(() => {
              // Group usage events by analysis_id
              const grouped: Record<string, Usage[]> = {};
              for (const u of usage) {
                const key = u.analysis_id || u.id || `orphan-${u.created_at}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(u);
              }
              const analyses = Object.entries(grouped).sort((a, b) => {
                const da = a[1][0]?.created_at || "";
                const db_ = b[1][0]?.created_at || "";
                return db_.localeCompare(da);
              });
              const totalAll = usage.reduce((s, u) => s + Number(u.cost_cents || 0), 0);

              return (
                <div className="space-y-2">
                  {/* Summary */}
                  <div className="flex gap-4 mb-4 text-sm">
                    <Badge variant="outline">{analyses.length} análises</Badge>
                    <Badge variant="outline">{usage.length} eventos</Badge>
                    <Badge variant="outline">Total: R$ {(totalAll / 100).toFixed(4)}</Badge>
                  </div>

                  {analyses.length === 0 && (
                    <p className="text-sm text-muted-foreground py-8 text-center">Nenhum registro.</p>
                  )}

                  {analyses.map(([analysisId, events]) => {
                    const totalCents = events.reduce((s, e) => s + Number(e.cost_cents || 0), 0);
                    const totalLatency = events.reduce((s, e) => s + Number(e.latency_ms || 0), 0);
                    const first = events[0];
                    const clinic = first?.clinics;
                    const analysis = first?.analyses;
                    const clinicName = clinic?.name || clinic?.subdomain || "—";
                    const clinicSub = clinic?.subdomain || "";
                    const date = first?.created_at ? new Date(first.created_at).toLocaleString("pt-BR") : "—";
                    const durationSec = analysis?.duration_ms ? Math.round(analysis.duration_ms / 1000) : null;
                    const skinType = analysis?.skin_type || "";
                    const fitz = analysis?.fitzpatrick_type || "";
                    const isOpen = expandedAnalysis === analysisId;

                    return (
                      <Card key={analysisId} className="overflow-hidden">
                        <button
                          className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                          onClick={() => {
                            if (isOpen) {
                              setExpandedAnalysis(null);
                              setAnalysisDetail(null);
                            } else {
                              setExpandedAnalysis(analysisId);
                              if (analysisId && !analysisId.startsWith("orphan-")) loadAnalysisDetail(analysisId);
                            }
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs shrink-0" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold">{clinicName}</span>
                                {clinicSub && <Badge variant="outline" className="text-[10px]">{clinicSub}</Badge>}
                                {durationSec != null && (
                                  <Badge variant="secondary" className="text-[10px]">⏱ {durationSec}s</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                <span>{date}</span>
                                {skinType && <span>· {skinType}</span>}
                                {fitz && <span>· Fototipo {fitz}</span>}
                                <span>· {events.length} calls</span>
                                {totalLatency > 0 && <span>· API: {(totalLatency / 1000).toFixed(1)}s</span>}
                              </div>
                            </div>
                            <span className="text-sm font-mono font-bold shrink-0" style={{ color: "#D99C94" }}>
                              R$ {(totalCents / 100).toFixed(4)}
                            </span>
                          </div>
                        </button>

                        {isOpen && (
                          <div className="border-t bg-muted/30">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">Hora</TableHead>
                                  <TableHead className="text-xs">Provider</TableHead>
                                  <TableHead className="text-xs">Operação</TableHead>
                                  <TableHead className="text-xs">Latência</TableHead>
                                  <TableHead className="text-xs text-right">Custo</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {events.map((e, i) => (
                                  <TableRow key={i} className="text-xs">
                                    <TableCell>
                                      {e.created_at ? new Date(e.created_at).toLocaleTimeString("pt-BR") : "—"}
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant={e.provider === "gemini" ? "default" : "secondary"} className="text-[10px]">
                                        {String(e.provider || "—")}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="font-mono text-[11px]">{String(e.operation || "—")}</TableCell>
                                    <TableCell>{e.latency_ms ? `${(e.latency_ms / 1000).toFixed(1)}s` : "—"}</TableCell>
                                    <TableCell className="text-right font-mono">
                                      R$ {(Number(e.cost_cents || 0) / 100).toFixed(4)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                                {/* Total row */}
                                <TableRow className="font-semibold bg-muted/50">
                                  <TableCell className="text-xs">TOTAL</TableCell>
                                  <TableCell />
                                  <TableCell />
                                  <TableCell className="text-xs">{(totalLatency / 1000).toFixed(1)}s</TableCell>
                                  <TableCell className="text-right font-mono text-xs">
                                    R$ {(totalCents / 100).toFixed(4)}
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>

                            {/* Patient report preview — loaded on demand */}
                            <div className="p-4 border-t">
                              {detailLoading && <p className="text-xs text-muted-foreground">Carregando resultado…</p>}
                              {analysisDetail && expandedAnalysis === analysisId && ((): React.ReactNode => {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                const d = analysisDetail as any;
                                const findings = Array.isArray(d.findings) ? d.findings as { description: string; zone?: string; priority?: string; conduta?: string; x_point?: number; y_point?: number; procedimentos_indicados?: { nome: string; sessoes_estimadas?: string }[] }[] : [];
                                const plan = d.plano_terapeutico as { curto_prazo?: string; medio_prazo?: string; longo_prazo?: string } | null;
                                return (
                                  <div className="space-y-3">
                                    <h4 className="text-sm font-bold">Resultado da Análise</h4>
                                    {/* Face map */}
                                    {d.image_url && findings.length > 0 && (
                                      <div className="relative max-w-[300px] rounded-xl overflow-hidden">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={String(d.image_url)} alt="Foto" className="w-full block" />
                                        {findings.map((f, fi) => {
                                          const x = (f.x_point ?? 0) * 100;
                                          const y = (f.y_point ?? 0) * 100;
                                          if (x === 0 && y === 0) return null;
                                          return (
                                            <div key={fi} className="absolute flex items-center justify-center rounded-full border-2 border-white text-white text-[0.55rem] font-bold shadow-md"
                                              style={{ width: 20, height: 20, left: `${x}%`, top: `${y}%`, transform: "translate(-50%,-50%)", background: f.priority === "PRIORITARIO" ? "#E74C3C" : f.priority === "OPCIONAL" ? "#827870" : "#D99C94" }}
                                            >{fi + 1}</div>
                                          );
                                        })}
                                      </div>
                                    )}
                                    {/* Badges */}
                                    <div className="flex gap-2 flex-wrap">
                                      {d.fitzpatrick_type && <Badge style={{ background: "#D99C94", color: "#fff" }} className="text-[10px]">FOTOTIPO {String(d.fitzpatrick_type)}</Badge>}
                                      {typeof d.skin_score === "number" && <Badge style={{ background: Number(d.skin_score) >= 80 ? "#22c55e" : Number(d.skin_score) >= 60 ? "#eab308" : "#ef4444", color: "#fff" }} className="text-[10px]">SCORE {String(d.skin_score)}/100</Badge>}
                                    </div>
                                    {d.skin_type && <p className="text-xs opacity-80">{String(d.skin_type)}</p>}
                                    {/* Findings */}
                                    {findings.map((f, fi) => (
                                      <div key={fi} className="text-xs border-l-2 pl-2 space-y-0.5" style={{ borderColor: f.priority === "PRIORITARIO" ? "#E74C3C" : f.priority === "OPCIONAL" ? "#827870" : "#D99C94" }}>
                                        <div className="flex items-center gap-2">
                                          <span className="font-bold">{fi + 1}. {f.zone || ""}</span>
                                          {f.priority && <Badge variant="outline" className="text-[9px] py-0">{f.priority}</Badge>}
                                        </div>
                                        <p className="font-medium">{f.description}</p>
                                        {f.conduta && <p className="opacity-60">Conduta: {f.conduta}</p>}
                                        {f.procedimentos_indicados?.map((p, pi) => (
                                          <p key={pi} className="opacity-50">• {p.nome}{p.sessoes_estimadas ? ` · ${p.sessoes_estimadas}` : ""}</p>
                                        ))}
                                      </div>
                                    ))}
                                    {/* Plan + Routines */}
                                    {plan && (
                                      <div className="text-xs space-y-1">
                                        <p className="font-bold">Plano Terapêutico</p>
                                        {plan.curto_prazo && <p><span className="font-semibold text-red-500">Curto:</span> {plan.curto_prazo}</p>}
                                        {plan.medio_prazo && <p><span className="font-semibold" style={{color:"#D99C94"}}>Médio:</span> {plan.medio_prazo}</p>}
                                        {plan.longo_prazo && <p><span className="font-semibold text-gray-500">Longo:</span> {plan.longo_prazo}</p>}
                                      </div>
                                    )}
                                    {(d.am_routine || d.pm_routine) && (
                                      <div className="text-xs space-y-1">
                                        <p className="font-bold">Rotina</p>
                                        {d.am_routine && <p><span className="font-semibold" style={{color:"#D99C94"}}>Manhã:</span> {String(d.am_routine)}</p>}
                                        {d.pm_routine && <p><span className="font-semibold" style={{color:"#D99C94"}}>Noite:</span> {String(d.pm_routine)}</p>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              );
            })()}
          </TabsContent>

          {/* ── Financeiro ── */}
          <TabsContent value="financeiro">
            <h1 className="text-2xl font-bold text-[#3A3330] mb-4">Financeiro</h1>

            {/* Setup fee summary */}
            {clinics.length > 0 && (() => {
              const totalSetup = clinics.reduce((s, c) => s + (c.setup_fee_cents || 0), 0);
              const paidSetup = clinics.filter(c => c.setup_fee_paid && c.setup_fee_cents > 0).reduce((s, c) => s + c.setup_fee_cents, 0);
              const pendingSetup = totalSetup - paidSetup;
              const pendingCount = clinics.filter(c => !c.setup_fee_paid && c.setup_fee_cents > 0).length;
              return totalSetup > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <Card>
                    <CardContent className="pt-5 pb-4">
                      <p className="text-2xl font-bold text-[#3b82f6]">R$ {(totalSetup / 100).toLocaleString("pt-BR")}</p>
                      <p className="text-[11px] text-muted-foreground">Total implementações</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-5 pb-4">
                      <p className="text-2xl font-bold text-[#22c55e]">R$ {(paidSetup / 100).toLocaleString("pt-BR")}</p>
                      <p className="text-[11px] text-muted-foreground">Recebido</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-5 pb-4">
                      <p className="text-2xl font-bold text-[#ef4444]">R$ {(pendingSetup / 100).toLocaleString("pt-BR")}</p>
                      <p className="text-[11px] text-muted-foreground">Pendente ({pendingCount} clínica{pendingCount !== 1 ? "s" : ""})</p>
                    </CardContent>
                  </Card>
                </div>
              ) : null;
            })()}

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Clínica</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-8">
                          Nenhuma fatura.
                        </TableCell>
                      </TableRow>
                    )}
                    {invoices.map((inv, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{String(inv.clinic_name || "—")}</TableCell>
                        <TableCell className="text-sm">
                          {inv.date
                            ? new Date(Number(inv.date) * 1000).toLocaleDateString("pt-BR")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          R$ {(Number(inv.amount_paid || 0) / 100).toFixed(2)}
                        </TableCell>
                        <TableCell>{statusBadge(String(inv.status || "—"))}</TableCell>
                        <TableCell>
                          {inv.invoice_pdf && (
                            <a href={String(inv.invoice_pdf)} target="_blank" className="text-xs text-blue-500 hover:underline">
                              PDF
                            </a>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Planos ── */}
          <TabsContent value="planos">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-2xl font-bold text-[#3A3330]">Planos</h1>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    await apiFetch("/api/super/plans", {
                      method: "POST",
                      body: JSON.stringify({ name: "Novo Plano", price_cents: 0, monthly_analyses_limit: 10 }),
                    });
                    loadPlans();
                  }}
                >
                  + Novo plano
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await apiFetch("/api/super/billing/sync-plans", { method: "POST" });
                    alert("Planos sincronizados com o Stripe!");
                  }}
                >
                  Sincronizar Stripe
                </Button>
              </div>
            </div>
            <div className="space-y-4">
              {plans.map((p, idx) => (
                <Card key={p.id}>
                  <CardContent className="pt-5 pb-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Nome</Label>
                        <Input
                          value={p.name}
                          className="h-9"
                          onChange={(e) => {
                            const updated = [...plans];
                            updated[idx] = { ...p, name: e.target.value };
                            setPlans(updated);
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Preço/mês (R$)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={(p.price_cents / 100).toFixed(2)}
                          className="h-9"
                          onChange={(e) => {
                            const updated = [...plans];
                            updated[idx] = { ...p, price_cents: Math.round(Number(e.target.value) * 100) };
                            setPlans(updated);
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Limite mensal de análises</Label>
                        <Input
                          type="number"
                          placeholder="Vazio = ilimitado"
                          value={p.monthly_analyses_limit ?? ""}
                          className="h-9"
                          onChange={(e) => {
                            const updated = [...plans];
                            updated[idx] = {
                              ...p,
                              monthly_analyses_limit: e.target.value === "" ? null : Number(e.target.value),
                            };
                            setPlans(updated);
                          }}
                        />
                      </div>
                      <Button
                        size="sm"
                        className="h-9"
                        onClick={async () => {
                          await apiFetch(`/api/super/plans/${p.id}`, {
                            method: "PUT",
                            body: JSON.stringify({
                              name: p.name,
                              price_cents: p.price_cents,
                              monthly_analyses_limit: p.monthly_analyses_limit,
                            }),
                          });
                          alert(`Plano "${p.name}" salvo!`);
                        }}
                      >
                        Salvar
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {p.monthly_analyses_limit
                        ? `Máximo ${p.monthly_analyses_limit} análises/mês. Ao atingir, a clínica recebe erro 402.`
                        : "Análises ilimitadas (sem bloqueio de quota)."}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ── Configurações ── */}
          <TabsContent value="config">
            <div className="max-w-2xl space-y-6">
              <h1 className="text-2xl font-bold text-[#3A3330]">Configurações de Custos</h1>
              <p className="text-sm text-muted-foreground">
                Configure os preços dos modelos de IA usados nas análises. Os valores são usados para calcular o custo de cada análise.
              </p>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Gemini 2.5 Flash-Lite</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Preço input / 1M tokens (USD)</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={modelCosts.gemini_input_per_1m_usd || ""}
                        onChange={(e) => setModelCosts({ ...modelCosts, gemini_input_per_1m_usd: e.target.value })}
                        placeholder="0.10"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Preço output / 1M tokens (USD)</Label>
                      <Input
                        type="number"
                        step="0.001"
                        value={modelCosts.gemini_output_per_1m_usd || ""}
                        onChange={(e) => setModelCosts({ ...modelCosts, gemini_output_per_1m_usd: e.target.value })}
                        placeholder="0.40"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Moondream3 (FAL AI)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Preço input / 1M tokens (USD)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={modelCosts.moondream_input_per_1m_usd || ""}
                        onChange={(e) => setModelCosts({ ...modelCosts, moondream_input_per_1m_usd: e.target.value })}
                        placeholder="0.40"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Preço output / 1M tokens (USD)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={modelCosts.moondream_output_per_1m_usd || ""}
                        onChange={(e) => setModelCosts({ ...modelCosts, moondream_output_per_1m_usd: e.target.value })}
                        placeholder="3.50"
                      />
                    </div>
                  </div>
                  {modelCosts.moondream_per_call_usd && (
                    <p className="text-xs text-muted-foreground">
                      Custo estimado por call: US$ {Number(modelCosts.moondream_per_call_usd).toFixed(6)} (~500 tokens in, ~50 tokens out)
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Câmbio USD → BRL</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 max-w-xs">
                    <Label className="text-xs">Taxa de conversão (1 USD = X BRL)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={modelCosts.usd_to_brl || ""}
                      onChange={(e) => setModelCosts({ ...modelCosts, usd_to_brl: e.target.value })}
                      placeholder="5.10"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Cost simulation */}
              {modelCosts.gemini_input_per_1m_usd && (
                <Card className="bg-[#F5F0EB]">
                  <CardHeader>
                    <CardTitle className="text-base">Simulação de custo por análise</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    {(() => {
                      const gin = Number(modelCosts.gemini_input_per_1m_usd || 0);
                      const gout = Number(modelCosts.gemini_output_per_1m_usd || 0);
                      const min = Number(modelCosts.moondream_input_per_1m_usd || 0);
                      const mout = Number(modelCosts.moondream_output_per_1m_usd || 0);
                      const fx = Number(modelCosts.usd_to_brl || 5.1);
                      // Gemini: ~3000 tokens in, ~2000 tokens out
                      const geminiUsd = (3000 / 1_000_000) * gin + (2000 / 1_000_000) * gout;
                      // Moondream: 7 calls × (~500 tokens in + ~50 tokens out cada)
                      const moonCallUsd = (500 / 1_000_000) * min + (50 / 1_000_000) * mout;
                      const moonUsd = 7 * moonCallUsd;
                      const totalBrl = (geminiUsd + moonUsd) * fx;
                      return (
                        <>
                          <p>Gemini (3k in / 2k out): <strong>US$ {geminiUsd.toFixed(6)}</strong></p>
                          <p>Moondream (7 calls × 500+50 tokens): <strong>US$ {moonUsd.toFixed(6)}</strong></p>
                          <p>Total USD: <strong>US$ {(geminiUsd + moonUsd).toFixed(5)}</strong></p>
                          <p>Total BRL: <strong>R$ {totalBrl.toFixed(4)}</strong></p>
                          <p className="text-lg font-bold mt-2" style={{ color: "#D99C94" }}>
                            ≈ R$ {totalBrl.toFixed(4)} por análise
                          </p>
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}

              <div className="flex items-center gap-3">
                <Button onClick={saveModelCosts} disabled={costsSaving}>
                  {costsSaving ? "Salvando…" : "Salvar configurações"}
                </Button>
                {costsMsg && (
                  <span className={`text-sm ${costsMsg === "Salvo!" ? "text-green-600" : "text-red-600"}`}>
                    {costsMsg}
                  </span>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

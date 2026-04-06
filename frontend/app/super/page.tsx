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
  usage_this_month: number;
  created_at: string;
};

type Plan = { id: string; name: string; price_cents: number; monthly_analyses_limit?: number | null };
type Usage = {
  created_at: string;
  clinic_name?: string;
  clinic_id?: string;
  provider?: string;
  cost_cents?: number;
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
  const [newForm, setNewForm] = useState({ subdomain: "", name: "", owner_email: "", plan_id: "" });
  const [newLoading, setNewLoading] = useState(false);
  const [newMsg, setNewMsg] = useState({ text: "", ok: false });

  // Active tab
  const [activeTab, setActiveTab] = useState("dashboard");

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

  async function loadOverview() {
    const r = await apiFetch("/api/super/overview");
    if (r.ok) setOverview(await r.json());
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
      body: JSON.stringify(newForm),
    });
    const data = await r.json();
    if (r.ok && data.id) {
      setNewMsg({ text: "Clínica criada! E-mail de acesso enviado.", ok: true });
      loadClinics();
      setNewForm({ subdomain: "", name: "", owner_email: "", plan_id: "" });
    } else {
      setNewMsg({ text: data.detail || data.error || "Erro ao criar.", ok: false });
    }
    setNewLoading(false);
  }

  // Chart data: last 30 days
  const chartData = (() => {
    const raw = (overview?.chart_data as { date: string; count: number }[]) || [];
    if (raw.length) return raw.map((d) => ({ date: d.date.slice(5), val: d.count }));
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
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (tab === "uso") loadUsage();
                if (tab === "financeiro") loadInvoices();
                if (tab === "planos") loadPlans();
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
            {["dashboard", "clinicas", "uso", "financeiro", "planos"].map((t) => (
              <TabsTrigger key={t} value={t} />
            ))}
          </TabsList>

          {/* ── Dashboard ── */}
          <TabsContent value="dashboard">
            <h1 className="text-2xl font-bold text-[#3A3330] mb-6">Dashboard</h1>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Análises (30d)", value: overview?.analyses_this_month ?? "—" },
                { label: "Clínicas ativas", value: overview?.active_clinics ?? "—" },
                {
                  label: "MRR",
                  value: overview?.mrr_cents
                    ? `R$ ${(Number(overview.mrr_cents) / 100).toFixed(0)}`
                    : "—",
                },
                { label: "Inadimplentes", value: overview?.past_due_clinics ?? "—" },
              ].map((m) => (
                <Card key={m.label}>
                  <CardContent className="pt-6">
                    <p className="text-3xl font-bold text-[#3A3330]">{String(m.value)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{m.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Análises — últimos 30 dias</CardTitle>
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
                          <TableCell className="text-sm">{c.usage_this_month ?? 0}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
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
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Clínica</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Custo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usage.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-8">
                          Nenhum registro.
                        </TableCell>
                      </TableRow>
                    )}
                    {usage.map((u, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">
                          {new Date(String(u.created_at)).toLocaleString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-sm">{String(u.clinic_name || u.clinic_id || "—")}</TableCell>
                        <TableCell className="text-sm">{String(u.provider || "—")}</TableCell>
                        <TableCell className="text-sm">
                          R$ {(Number(u.cost_cents || 0) / 100).toFixed(4)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Financeiro ── */}
          <TabsContent value="financeiro">
            <h1 className="text-2xl font-bold text-[#3A3330] mb-4">Financeiro</h1>
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
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await apiFetch("/api/super/billing/sync-plans", { method: "POST" });
                  loadPlans();
                }}
              >
                Sincronizar Stripe
              </Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Preço/mês</TableHead>
                      <TableHead>Limite mensal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm font-medium">{p.name}</TableCell>
                        <TableCell className="text-sm">
                          R$ {(p.price_cents / 100).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.monthly_analyses_limit ?? "∞"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

// ─── Billing types ───────────────────────────────────────────────────────────
interface Invoice {
  id: string;
  date: string;
  amount: number;
  status: string;
  pdf_url?: string;
  hosted_url?: string;
}

interface BillingStatus {
  subscription_status: string;
  plan_name: string;
  analyses_this_month: number;
  monthly_limit: number | null;
  current_period_end?: string;
  trial_end?: string;
  invoices: Invoice[];
  extra_analysis_price_cents?: number;
  extra_analyses_purchased?: number;
  extra_analyses_used?: number;
  extra_analyses_remaining?: number;
}

// ─── Analysis record ─────────────────────────────────────────────────────────
interface AnalysisFinding {
  description: string;
  zone?: string;
  priority?: string;
  conduta?: string;
  clinical_note?: string;
  x_point?: number;
  y_point?: number;
  procedimentos_indicados?: { nome: string; descricao_breve?: string; sessoes_estimadas?: string; horizonte?: string }[];
}

interface AnalysisReport {
  skin_type?: string;
  skin_score?: number;
  fitzpatrick_type?: string;
  findings?: AnalysisFinding[];
  plano_terapeutico?: { curto_prazo?: string; medio_prazo?: string; longo_prazo?: string };
  am_routine?: string;
  pm_routine?: string;
  general_observations?: string;
}

interface Analysis {
  id: string;
  created_at: string;
  skin_type?: string;
  fitzpatrick_type?: string;
  skin_score?: number;
  duration_ms?: number;
  image_url?: string;
  findings?: AnalysisFinding[];
  plano_terapeutico?: { curto_prazo?: string; medio_prazo?: string; longo_prazo?: string };
  am_routine?: string;
  pm_routine?: string;
  general_observations?: string;
}
import {
  getCookie,
  setCookie,
  deleteCookie,
  apiFetch,
  applyBranding,
  type ClinicConfig,
  type Procedure,
} from "@/lib/api";
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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

// ─── Default procedures ──────────────────────────────────────────────────────
const DEFAULT_PROCEDURES: Procedure[] = [
  { nome: "Toxina Botulínica", tipo: "INJETAVEL", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Preenchedor de Ácido Hialurônico", tipo: "INJETAVEL", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Bioestimulador de Colágeno", tipo: "INJETAVEL", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Fios de PDO", tipo: "INJETAVEL", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Laser Fracionado", tipo: "LASER", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Laser CO2", tipo: "LASER", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Luz Pulsada (IPL)", tipo: "LASER", marca: "", video: "", ativo: true, padrao: true },
  { nome: "HIFU", tipo: "TECNOLOGIA", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Radiofrequência", tipo: "TECNOLOGIA", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Ultrassom Microfocado", tipo: "TECNOLOGIA", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Microagulhamento", tipo: "TECNOLOGIA", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Dermapen", tipo: "TECNOLOGIA", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Criolipólise", tipo: "TECNOLOGIA", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Peeling de TCA", tipo: "PEELING", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Peeling de Retinol", tipo: "PEELING", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Peeling Mandélico", tipo: "PEELING", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Peeling de Glicólico", tipo: "PEELING", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Skincare Cosmecêutico", tipo: "TOPICO", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Despigmentante Tópico", tipo: "TOPICO", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Filtro Solar Personalizado", tipo: "TOPICO", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Mesoterapia", tipo: "INJETAVEL", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Bioremodelador", tipo: "INJETAVEL", marca: "", video: "", ativo: true, padrao: true },
  { nome: "Plasma Rico em Plaquetas (PRP)", tipo: "INJETAVEL", marca: "", video: "", ativo: true, padrao: true },
];

const TIPOS = ["INJETAVEL", "LASER", "TECNOLOGIA", "PEELING", "TOPICO", "OUTROS"];

// ─── Merge saved catalog with defaults ──────────────────────────────────────
function mergeCatalog(saved: Procedure[]): Procedure[] {
  const savedNames = new Set(saved.map((p) => p.nome));
  const defaults = DEFAULT_PROCEDURES.filter((p) => !savedNames.has(p.nome));
  return [...saved, ...defaults];
}

// ─── Admin Page ──────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [procs, setProcs] = useState<Procedure[]>([]);
  const [fontOptions, setFontOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Billing state
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  // Analyses state
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [analysesLoading, setAnalysesLoading] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<Analysis | null>(null);
  const [activeTab, setActiveTab] = useState("inicio");
  // Upgrade modal
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Check auth on mount
  useEffect(() => {
    if (getCookie("sb-access-token")) {
      setAuthed(true);
    }
  }, []);

  // Load config + dashboard data when authed
  useEffect(() => {
    if (!authed) return;
    loadConfig();
    loadBilling();
    loadAnalyses();
  }, [authed]);

  // Auto-load data when tab changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!authed) return;
    if (activeTab === "historico" && analyses.length === 0 && !analysesLoading) loadAnalyses();
    if (activeTab === "financeiro" && !billing) loadBilling();
  }, [activeTab, authed]);

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
        setLoginError(data.error || "E-mail ou senha inválidos.");
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

  async function loadConfig() {
    const resp = await apiFetch("/api/admin/config");
    if (resp.status === 401 || resp.status === 403) {
      deleteCookie("sb-access-token");
      setAuthed(false);
      return;
    }
    const data = await resp.json();
    setConfig(data);
    applyBranding(data);
    const saved: Procedure[] = data.procedures_catalog || [];
    setProcs(mergeCatalog(saved));
    setFontOptions(data._font_options || []);
  }

  async function saveConfig() {
    if (!config) return;
    setSaving(true);
    setSaveMsg("");
    const payload = {
      ...config,
      procedures_catalog: procs.map((p) => ({
        nome: p.nome,
        tipo: p.tipo,
        marca: p.marca || "",
        video: p.video || "",
        ativo: p.ativo,
        padrao: p.padrao,
      })),
    };
    const resp = await apiFetch("/api/admin/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      setSaveMsg("Salvo com sucesso!");
      applyBranding(config);
    } else {
      setSaveMsg("Erro ao salvar.");
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
  }

  async function loadBilling() {
    const resp = await apiFetch("/api/admin/billing/status");
    if (resp.ok) setBilling(await resp.json());
  }

  async function loadAnalyses() {
    setAnalysesLoading(true);
    try {
      const resp = await apiFetch("/api/admin/analyses");
      if (resp.ok) setAnalyses(await resp.json());
    } finally {
      setAnalysesLoading(false);
    }
  }

  async function deleteAnalysis(id: string) {
    if (!confirm("Remover esta análise?")) return;
    await apiFetch(`/api/admin/analyses/${id}`, { method: "DELETE" });
    setAnalyses((prev) => prev.filter((a) => a.id !== id));
  }

  async function uploadLogo(file: File) {
    const form = new FormData();
    form.append("file", file);
    const token = getCookie("sb-access-token");
    const resp = await fetch("/api/admin/logo", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await resp.json();
    if (data.logo_url && config) {
      setConfig({ ...config, logo_url: data.logo_url });
    }
  }

  // ─── Login Screen ──────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <main className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-6">
        <Card className="w-full max-w-sm shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="text-3xl mb-1">✨</div>
            <CardTitle>Painel da Clínica</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Entre com seu e-mail e senha para continuar.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={doLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {loginError && (
                <p className="text-sm text-destructive">{loginError}</p>
              )}
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
          {config?.logo_url ? (
            <img src={config.logo_url} alt="logo" className="h-8 object-contain" />
          ) : (
            <span className="font-bold text-[#3A3330]">
              {config?.clinic_name || "Clínica"}
            </span>
          )}
        </div>
        <nav className="flex-1 py-2">
          {(["inicio", "aparencia", "procedimentos", "historico", "financeiro", "config"] as const).map(
            (tab) => {
              const labels: Record<string, string> = {
                inicio: "🏠 Início",
                aparencia: "🎨 Aparência",
                procedimentos: "💉 Procedimentos",
                historico: "📋 Histórico",
                financeiro: "💳 Financeiro",
                config: "⚙️ Configurações",
              };
              return (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    if (tab === "historico") loadAnalyses();
                    if (tab === "financeiro") loadBilling();
                  }}
                  className={`w-full text-left px-5 py-2.5 text-sm transition-colors ${
                    activeTab === tab
                      ? "bg-[#F5F0EB] font-semibold text-[#3A3330]"
                      : "text-[#3A3330] hover:bg-[#F5F0EB]"
                  }`}
                >
                  {labels[tab]}
                </button>
              );
            }
          )}
        </nav>
        <div className="p-4 border-t border-gray-100 space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => window.open("/", "_blank")}
          >
            Ver prévia
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={doLogout}
          >
            Sair
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-56 flex-1 p-4 md:p-8 overflow-x-hidden">
        {!config ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="hidden">
              {["inicio", "aparencia", "procedimentos", "historico", "financeiro", "config"].map((t) => (
                <TabsTrigger key={t} value={t} />
              ))}
            </TabsList>

            {/* ── Início ── */}
            <TabsContent value="inicio">
              <h1 className="text-2xl font-bold text-[#3A3330] mb-6">Início</h1>

              {/* ── Métricas ── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <p className="text-2xl font-bold" style={{ color: "#D99C94" }}>
                      {billing ? `${billing.analyses_this_month ?? 0}${billing.monthly_limit ? ` / ${billing.monthly_limit}` : ""}` : "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">Análises este mês</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <p className="text-2xl font-bold" style={{ color: "#8b5cf6" }}>
                      {billing?.plan_name || "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Plano {billing?.subscription_status ? <Badge variant={billing.subscription_status === "active" ? "default" : billing.subscription_status === "trialing" ? "secondary" : "destructive"} className="text-[9px] ml-1">{billing.subscription_status}</Badge> : null}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <p className="text-2xl font-bold" style={{ color: "#22c55e" }}>
                      {billing?.monthly_limit
                        ? Math.max(0, (billing.monthly_limit ?? 0) - (billing.analyses_this_month ?? 0))
                        : "∞"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">Análises restantes</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <p className="text-2xl font-bold" style={{ color: "#3b82f6" }}>
                      {procs.filter((p) => p.ativo).length} / {procs.length}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">Procedimentos ativos</p>
                  </CardContent>
                </Card>
              </div>

              {/* ── Gráfico: análises por dia (30d) ── */}
              {analyses.length > 0 && (() => {
                const dayCounts: Record<string, number> = {};
                for (const a of analyses) {
                  const day = (a.created_at || "").slice(0, 10);
                  if (day) dayCounts[day] = (dayCounts[day] || 0) + 1;
                }
                const now = new Date();
                const chart = Array.from({ length: 30 }, (_, i) => {
                  const d = new Date(now);
                  d.setDate(d.getDate() - (29 - i));
                  const ds = d.toISOString().slice(0, 10);
                  return { date: ds.slice(5), count: dayCounts[ds] || 0 };
                });
                return (
                  <Card className="mb-8">
                    <CardHeader><CardTitle className="text-base">Análises — últimos 30 dias</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={chart}>
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Bar dataKey="count" fill="#D99C94" radius={[4, 4, 0, 0]} name="Análises" />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* ── Insights: top achados + distribuição de prioridade ── */}
              {analyses.length > 0 && (() => {
                const descCount: Record<string, number> = {};
                let prio = 0, recom = 0, opc = 0;
                for (const a of analyses) {
                  for (const f of a.findings || []) {
                    const desc = f.description || "";
                    if (desc) descCount[desc] = (descCount[desc] || 0) + 1;
                    if (f.priority === "PRIORITARIO") prio++;
                    else if (f.priority === "RECOMENDADO") recom++;
                    else if (f.priority === "OPCIONAL") opc++;
                  }
                }
                const top5 = Object.entries(descCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
                const totalFindings = prio + recom + opc;
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                    <Card>
                      <CardHeader><CardTitle className="text-base">Top 5 achados</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        {top5.map(([desc, count], i) => (
                          <div key={i} className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate">{desc}</span>
                            <Badge variant="outline" className="shrink-0">{count}x</Badge>
                          </div>
                        ))}
                        {top5.length === 0 && <p className="text-xs text-muted-foreground">Sem dados.</p>}
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle className="text-base">Distribuição de prioridade</CardTitle></CardHeader>
                      <CardContent className="space-y-3">
                        {totalFindings > 0 ? [
                          { label: "Prioritário", count: prio, color: "#E74C3C" },
                          { label: "Recomendado", count: recom, color: "#D99C94" },
                          { label: "Opcional", count: opc, color: "#827870" },
                        ].map(({ label, count, color }) => (
                          <div key={label}>
                            <div className="flex justify-between text-xs mb-1">
                              <span>{label}</span>
                              <span>{count} ({totalFindings > 0 ? Math.round(count / totalFindings * 100) : 0}%)</span>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${totalFindings > 0 ? (count / totalFindings * 100) : 0}%`, background: color }} />
                            </div>
                          </div>
                        )) : <p className="text-xs text-muted-foreground">Sem dados.</p>}
                      </CardContent>
                    </Card>
                  </div>
                );
              })()}

              {/* ── Últimas 5 análises ── */}
              <Card className="mb-8">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Últimas análises</CardTitle>
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setActiveTab("historico"); loadAnalyses(); }}>
                      Ver histórico completo →
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {analysesLoading ? (
                    <p className="text-xs text-muted-foreground">Carregando…</p>
                  ) : analyses.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhuma análise ainda.</p>
                  ) : (
                    analyses.slice(0, 5).map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-3 py-2 cursor-pointer hover:bg-muted/50 rounded-lg px-2 transition-colors"
                        onClick={() => setSelectedAnalysis(a)}
                      >
                        {a.image_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.image_url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 border" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{a.skin_type || "—"}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(a.created_at).toLocaleString("pt-BR")}
                            {a.duration_ms ? ` · ${Math.round(a.duration_ms / 1000)}s` : ""}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">{a.findings?.length ?? 0} achados</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* ── Status do plano ── */}
              {billing && (
                <Card>
                  <CardContent className="pt-5 pb-4">
                    {billing.monthly_limit ? (
                      <>
                        <div className="flex justify-between text-sm mb-2">
                          <span>Uso do plano</span>
                          <span className="font-semibold">{billing.analyses_this_month ?? 0} / {billing.monthly_limit}</span>
                        </div>
                        <div className="h-3 rounded-full bg-muted overflow-hidden mb-2">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, ((billing.analyses_this_month ?? 0) / billing.monthly_limit) * 100)}%`,
                              background: ((billing.analyses_this_month ?? 0) / billing.monthly_limit) > 0.8 ? "#ef4444" : "#D99C94",
                            }}
                          />
                        </div>
                        {((billing.analyses_this_month ?? 0) / billing.monthly_limit) > 0.8 && (
                          <div className="space-y-2">
                            <p className="text-xs text-red-500">⚠️ Você está perto do limite.</p>
                            {billing.extra_analyses_remaining && billing.extra_analyses_remaining > 0 ? (
                              <p className="text-xs text-green-600">✓ Você tem {billing.extra_analyses_remaining} análise{billing.extra_analyses_remaining > 1 ? "s" : ""} avulsa{billing.extra_analyses_remaining > 1 ? "s" : ""} disponível{billing.extra_analyses_remaining > 1 ? "is" : ""}.</p>
                            ) : (
                              <Button
                                size="sm"
                                className="text-xs"
                                onClick={async () => {
                                  const qty = prompt("Quantas análises avulsas deseja comprar?", "10");
                                  if (!qty) return;
                                  const r = await apiFetch("/api/admin/billing/buy-analyses", {
                                    method: "POST",
                                    body: JSON.stringify({ quantity: Number(qty) }),
                                  });
                                  const data = await r.json();
                                  if (data.checkout_url) window.location.href = data.checkout_url;
                                  else alert(data.error || "Erro ao gerar checkout.");
                                }}
                              >
                                Comprar análises avulsas (R$ {((billing.extra_analysis_price_cents || 990) / 100).toFixed(2)}/cada)
                              </Button>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm">Plano ilimitado — sem limite de análises.</p>
                    )}
                    {billing.subscription_status === "trialing" && billing.trial_end && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Período de teste termina em {new Date(String(billing.trial_end)).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ── Aparência ── */}
            <TabsContent value="aparencia">
              <div className="max-w-xl space-y-6">
                <div className="flex items-center justify-between">
                  <h1 className="text-2xl font-bold text-[#3A3330]">Aparência</h1>
                  <Button onClick={saveConfig} disabled={saving}>
                    {saving ? "Salvando…" : "Salvar"}
                  </Button>
                </div>
                {saveMsg && (
                  <p className={`text-sm ${saveMsg.includes("sucesso") ? "text-green-600" : "text-destructive"}`}>
                    {saveMsg}
                  </p>
                )}

                <Card>
                  <CardContent className="pt-6 space-y-4">
                    {/* Logo */}
                    <div className="space-y-2">
                      <Label>Logo da clínica</Label>
                      <div className="flex items-center gap-4">
                        {config.logo_url && (
                          <img
                            src={config.logo_url}
                            alt="logo"
                            className="h-16 w-16 object-contain rounded border"
                          />
                        )}
                        <Input
                          type="file"
                          accept="image/*"
                          className="max-w-xs"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadLogo(f);
                          }}
                        />
                      </div>
                    </div>

                    <Separator />

                    {/* Clinic name */}
                    <div className="space-y-2">
                      <Label>Nome da clínica</Label>
                      <Input
                        value={config.clinic_name}
                        onChange={(e) =>
                          setConfig({ ...config, clinic_name: e.target.value })
                        }
                      />
                    </div>

                    {/* Welcome text */}
                    <div className="space-y-2">
                      <Label>Texto de boas-vindas</Label>
                      <Textarea
                        value={config.welcome_text}
                        rows={2}
                        onChange={(e) =>
                          setConfig({ ...config, welcome_text: e.target.value })
                        }
                      />
                    </div>

                    <Separator />

                    {/* Font */}
                    <div className="space-y-2">
                      <Label>Fonte</Label>
                      <Select
                        value={config.font}
                        onValueChange={(v) => setConfig({ ...config, font: v ?? config.font })}
                      >
                        <SelectTrigger className="w-64">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(fontOptions.length ? fontOptions : ["Inter"]).map((f) => (
                            <SelectItem key={f} value={f}>
                              {f}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Separator />

                    {/* Colors */}
                    <div className="space-y-3">
                      <Label>Cores</Label>
                      <div className="grid grid-cols-2 gap-3">
                        {(
                          [
                            ["primary", "Primária"],
                            ["secondary", "Secundária"],
                            ["accent", "Destaque"],
                            ["background", "Fundo"],
                            ["text", "Texto"],
                          ] as const
                        ).map(([key, label]) => (
                          <div key={key} className="flex items-center gap-2">
                            <input
                              type="color"
                              value={config.colors[key]}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  colors: { ...config.colors, [key]: e.target.value },
                                })
                              }
                              className="w-8 h-8 rounded cursor-pointer border"
                            />
                            <span className="text-sm">{label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── Procedimentos ── */}
            <TabsContent value="procedimentos">
              <div className="w-full space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold text-[#3A3330]">Procedimentos</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                      A IA recomendará apenas procedimentos ativos desta lista.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setProcs([
                          ...procs,
                          {
                            nome: "",
                            tipo: "INJETAVEL",
                            marca: "",
                            video: "",
                            ativo: true,
                            padrao: false,
                          },
                        ])
                      }
                    >
                      + Adicionar
                    </Button>
                    <Button onClick={saveConfig} disabled={saving}>
                      {saving ? "Salvando…" : "Salvar"}
                    </Button>
                  </div>
                </div>
                {saveMsg && (
                  <p className={`text-sm ${saveMsg.includes("sucesso") ? "text-green-600" : "text-destructive"}`}>
                    {saveMsg}
                  </p>
                )}

                <Card>
                  <CardContent className="p-0 overflow-x-auto">
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[180px]">Nome</TableHead>
                          <TableHead className="min-w-[100px]">Marca</TableHead>
                          <TableHead className="min-w-[160px]">Vídeo (YouTube)</TableHead>
                          <TableHead className="min-w-[130px]">Tipo</TableHead>
                          <TableHead className="w-16 text-center">Ativo</TableHead>
                          {procs.some((p) => !p.padrao) && (
                            <TableHead className="w-12" />
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {procs.map((p, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <Input
                                value={p.nome}
                                placeholder="Nome do procedimento"
                                className="h-8 text-sm border-0 focus-visible:ring-1"
                                readOnly={p.padrao}
                                onChange={(e) => {
                                  const updated = [...procs];
                                  updated[i] = { ...p, nome: e.target.value };
                                  setProcs(updated);
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={p.marca}
                                placeholder="Ex: Fotona"
                                className="h-8 text-sm border-0 focus-visible:ring-1"
                                onChange={(e) => {
                                  const updated = [...procs];
                                  updated[i] = { ...p, marca: e.target.value };
                                  setProcs(updated);
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={p.video || ""}
                                placeholder="https://youtu.be/..."
                                className="h-8 text-xs border-0 focus-visible:ring-1"
                                onChange={(e) => {
                                  const updated = [...procs];
                                  updated[i] = { ...p, video: e.target.value };
                                  setProcs(updated);
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={p.tipo}
                                onValueChange={(v) => {
                                  const updated = [...procs];
                                  updated[i] = { ...p, tipo: v ?? p.tipo };
                                  setProcs(updated);
                                }}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TIPOS.map((t) => (
                                    <SelectItem key={t} value={t}>
                                      {t}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-center">
                              <Switch
                                checked={p.ativo}
                                onCheckedChange={(v) => {
                                  const updated = [...procs];
                                  updated[i] = { ...p, ativo: v };
                                  setProcs(updated);
                                }}
                              />
                            </TableCell>
                            {!p.padrao && (
                              <TableCell>
                                <button
                                  onClick={() =>
                                    setProcs(procs.filter((_, idx) => idx !== i))
                                  }
                                  className="text-muted-foreground hover:text-destructive text-xs"
                                >
                                  ✕
                                </button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── Histórico ── */}
            <TabsContent value="historico">
              <div className="max-w-4xl space-y-4">
                <h1 className="text-2xl font-bold text-[#3A3330]">Histórico</h1>
                {analysesLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando análises…</p>
                ) : analyses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma análise encontrada.</p>
                ) : (
                  <div className="space-y-2">
                    {analyses.map((a) => {
                      const score = a.skin_score;
                      return (
                        <Card
                          key={a.id}
                          className="cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => setSelectedAnalysis(a)}
                        >
                          <CardContent className="flex items-center gap-4 py-3">
                            {a.image_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={a.image_url} alt="" className="w-12 h-12 rounded-full object-cover shrink-0 border" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate">{a.skin_type || "—"}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(a.created_at).toLocaleString("pt-BR")} · Fototipo {a.fitzpatrick_type || "—"}
                                {typeof score === "number" && ` · Score ${score}/100`}
                                {a.duration_ms ? ` · ${Math.round(a.duration_ms / 1000)}s` : ""}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0">
                              {a.findings?.length ?? 0} achados
                            </Badge>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteAnalysis(a.id); }}
                              className="text-xs text-muted-foreground hover:text-destructive shrink-0 ml-2"
                            >
                              ✕
                            </button>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Analysis Detail Modal ── */}
              <Dialog open={!!selectedAnalysis} onOpenChange={(open) => { if (!open) setSelectedAnalysis(null); }}>
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>
                      Análise de {new Date(selectedAnalysis?.created_at || "").toLocaleString("pt-BR")}
                    </DialogTitle>
                  </DialogHeader>
                  {selectedAnalysis && (() => {
                    const a = selectedAnalysis;
                    const HORIZON: Record<string, string> = { CURTO_PRAZO: "Curto prazo", MEDIO_PRAZO: "Médio prazo", LONGO_PRAZO: "Longo prazo" };
                    const PCOLOR: Record<string, string> = { PRIORITARIO: "bg-red-100 text-red-800", RECOMENDADO: "bg-yellow-100 text-yellow-800", OPCIONAL: "bg-green-100 text-green-800" };
                    return (
                      <div className="space-y-4">
                        {/* Face map */}
                        {a.image_url && a.findings?.length ? (
                          <div className="relative w-full rounded-xl overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={a.image_url} alt="Foto" className="w-full block" />
                            {a.findings.map((f, i) => {
                              const x = (f.x_point ?? 0) * 100;
                              const y = (f.y_point ?? 0) * 100;
                              if (x === 0 && y === 0) return null;
                              return (
                                <div key={i} className="absolute flex items-center justify-center rounded-full border-2 border-white text-white text-[0.6rem] font-bold shadow-md"
                                  style={{
                                    width: 22, height: 22, left: `${x}%`, top: `${y}%`,
                                    transform: "translate(-50%,-50%)",
                                    background: f.priority === "PRIORITARIO" ? "#E74C3C" : f.priority === "OPCIONAL" ? "#827870" : "#D99C94",
                                  }}
                                >{i + 1}</div>
                              );
                            })}
                          </div>
                        ) : null}

                        {/* Badges */}
                        <div className="flex gap-2 flex-wrap">
                          <Badge style={{ background: "#D99C94", color: "#fff" }}>FOTOTIPO {a.fitzpatrick_type}</Badge>
                          {typeof a.skin_score === "number" && (
                            <Badge style={{ background: a.skin_score >= 80 ? "#22c55e" : a.skin_score >= 60 ? "#eab308" : a.skin_score >= 40 ? "#f97316" : "#ef4444", color: "#fff" }}>
                              SCORE {a.skin_score}/100
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm">{a.skin_type}</p>

                        {/* Findings */}
                        {a.findings?.map((f, i) => (
                          <Card key={i} className="border-0 shadow-sm" style={{ borderLeft: `3px solid ${f.priority === "PRIORITARIO" ? "#E74C3C" : f.priority === "OPCIONAL" ? "#827870" : "#D99C94"}` }}>
                            <CardContent className="pt-3 pb-2 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-mono font-bold" style={{ color: "#D99C94" }}>{i + 1}. {f.zone}</span>
                                {f.priority && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${PCOLOR[f.priority] || ""}`}>{f.priority}</span>}
                              </div>
                              <p className="text-sm font-semibold">{f.description}</p>
                              {f.conduta && <p className="text-xs opacity-70"><strong>Conduta:</strong> {f.conduta}</p>}
                              {f.procedimentos_indicados?.map((p, j) => (
                                <div key={j} className="flex gap-2 items-start text-xs">
                                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: "#D99C94" }} />
                                  <span><strong>{p.nome}</strong>{p.sessoes_estimadas ? ` · ${p.sessoes_estimadas}` : ""}{p.horizonte ? ` · ${HORIZON[p.horizonte] || p.horizonte}` : ""}</span>
                                </div>
                              ))}
                              {f.clinical_note && <p className="text-[11px] italic opacity-50">{f.clinical_note}</p>}
                            </CardContent>
                          </Card>
                        ))}

                        {/* Plan */}
                        {a.plano_terapeutico && (
                          <div className="space-y-2">
                            <h3 className="text-sm font-bold">Plano Terapêutico</h3>
                            {[
                              { l: "Curto prazo", t: a.plano_terapeutico.curto_prazo, c: "#E74C3C" },
                              { l: "Médio prazo", t: a.plano_terapeutico.medio_prazo, c: "#D99C94" },
                              { l: "Longo prazo", t: a.plano_terapeutico.longo_prazo, c: "#827870" },
                            ].map(({ l, t, c }) => t ? <div key={l}><p className="text-xs font-bold" style={{ color: c }}>{l}</p><p className="text-xs opacity-80">{t}</p></div> : null)}
                          </div>
                        )}

                        {/* Routines */}
                        {(a.am_routine || a.pm_routine) && (
                          <div className="space-y-2">
                            <h3 className="text-sm font-bold">Rotina</h3>
                            {a.am_routine && <div><p className="text-xs font-bold" style={{ color: "#D99C94" }}>Manhã</p><p className="text-xs opacity-75 whitespace-pre-line">{a.am_routine}</p></div>}
                            {a.pm_routine && <div><p className="text-xs font-bold" style={{ color: "#D99C94" }}>Noite</p><p className="text-xs opacity-75 whitespace-pre-line">{a.pm_routine}</p></div>}
                          </div>
                        )}

                        {/* Observations */}
                        {a.general_observations && (
                          <div>
                            <h3 className="text-sm font-bold">Observações</h3>
                            <p className="text-xs opacity-70 whitespace-pre-line">{a.general_observations}</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </DialogContent>
              </Dialog>
            </TabsContent>

            {/* ── Financeiro ── */}
            <TabsContent value="financeiro">
              <div className="max-w-2xl space-y-4">
                <h1 className="text-2xl font-bold text-[#3A3330]">Financeiro</h1>
                {!billing ? (
                  <p className="text-sm text-muted-foreground">Carregando…</p>
                ) : (
                  <>
                    <Card>
                      <CardContent className="pt-6 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Plano</span>
                          <Badge variant="outline">{billing.plan_name || "—"}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Status</span>
                          <Badge variant={billing.subscription_status === "active" ? "default" : "destructive"}>
                            {billing.subscription_status || "—"}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Análises este mês</span>
                          <span className="text-sm">
                            {billing.analyses_this_month ?? 0} / {billing.monthly_limit ?? "∞"}
                          </span>
                        </div>
                        {billing.monthly_limit && (
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div
                              className="bg-[#D99C94] h-2 rounded-full"
                              style={{
                                width: `${Math.min(100, (billing.analyses_this_month / billing.monthly_limit) * 100)}%`,
                              }}
                            />
                          </div>
                        )}
                        <div className="flex gap-2 flex-wrap">
                          <Button variant="outline" size="sm" onClick={() => setUpgradeOpen(true)}>
                            Fazer upgrade
                          </Button>
                          <Button
                            size="sm"
                            onClick={async () => {
                              const qty = prompt("Quantas análises avulsas?", "10");
                              if (!qty) return;
                              const r = await apiFetch("/api/admin/billing/buy-analyses", {
                                method: "POST",
                                body: JSON.stringify({ quantity: Number(qty) }),
                              });
                              const data = await r.json();
                              if (data.checkout_url) window.location.href = data.checkout_url;
                              else alert(data.error || "Erro.");
                            }}
                          >
                            Comprar análises avulsas
                          </Button>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Análises avulsas */}
                    {(billing.extra_analyses_purchased ?? 0) > 0 && (
                      <Card>
                        <CardContent className="pt-6 space-y-2">
                          <h3 className="text-sm font-semibold">Análises avulsas</h3>
                          <div className="flex items-center justify-between text-sm">
                            <span>Compradas</span>
                            <span className="font-mono">{billing.extra_analyses_purchased}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span>Usadas</span>
                            <span className="font-mono">{billing.extra_analyses_used ?? 0}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm font-semibold">
                            <span>Restantes</span>
                            <span className="font-mono text-green-600">{billing.extra_analyses_remaining ?? 0}</span>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {billing.invoices?.length > 0 && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">Faturas</CardTitle>
                          </CardHeader>
                          <CardContent className="p-0">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Data</TableHead>
                                  <TableHead>Valor</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead />
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {billing.invoices.map((inv) => (
                                  <TableRow key={inv.id}>
                                    <TableCell className="text-sm">
                                      {new Date(inv.date).toLocaleDateString("pt-BR")}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                      R$ {(inv.amount / 100).toFixed(2)}
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant={inv.status === "paid" ? "default" : "destructive"}>
                                        {inv.status}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>
                                      {inv.pdf_url && (
                                        <a href={inv.pdf_url} target="_blank" className="text-xs text-blue-500 hover:underline">
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
                      )}
                  </>
                )}
              </div>

              {/* Upgrade Modal */}
              <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Upgrade de plano</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    Entre em contato com o administrador para fazer upgrade do seu plano.
                  </p>
                </DialogContent>
              </Dialog>
            </TabsContent>

            {/* ── Config ── */}
            <TabsContent value="config">
              <div className="max-w-xl space-y-6">
                <div className="flex items-center justify-between">
                  <h1 className="text-2xl font-bold text-[#3A3330]">Configurações</h1>
                  <Button onClick={saveConfig} disabled={saving}>
                    {saving ? "Salvando…" : "Salvar"}
                  </Button>
                </div>
                {saveMsg && (
                  <p className={`text-sm ${saveMsg.includes("sucesso") ? "text-green-600" : "text-destructive"}`}>
                    {saveMsg}
                  </p>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Rodapé</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Telefone / WhatsApp</Label>
                      <Input
                        value={config.footer.phone}
                        placeholder="(11) 99999-9999"
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            footer: { ...config.footer, phone: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Instagram</Label>
                      <Input
                        value={config.footer.instagram}
                        placeholder="@clinica"
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            footer: { ...config.footer, instagram: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Endereço</Label>
                      <Input
                        value={config.footer.address}
                        placeholder="Rua, número — Cidade/UF"
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            footer: { ...config.footer, address: e.target.value },
                          })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Aviso legal</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={config.disclaimer}
                      rows={4}
                      onChange={(e) =>
                        setConfig({ ...config, disclaimer: e.target.value })
                      }
                    />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}

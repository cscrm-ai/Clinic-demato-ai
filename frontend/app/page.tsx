"use client";

import { useEffect, useRef, useState } from "react";
import { applyBranding, type ClinicConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type ProcedimentoIndicado = {
  nome: string;
  tipo?: string;
  descricao_breve?: string;
  sessoes_estimadas?: string;
  horizonte?: string;
};

type Finding = {
  description: string;
  zone?: string;
  priority?: string;
  conduta?: string;
  procedimentos_indicados?: ProcedimentoIndicado[];
  clinical_note?: string;
  x_point?: number;
  y_point?: number;
};

type Report = {
  skin_type: string;
  fitzpatrick_type: string;
  findings: Finding[];
  plano_terapeutico?: {
    curto_prazo?: string;
    medio_prazo?: string;
    longo_prazo?: string;
  };
  am_routine?: string;
  pm_routine?: string;
  general_observations?: string;
};

const PRIORITY_COLOR: Record<string, string> = {
  PRIORITARIO: "bg-red-100 text-red-800",
  RECOMENDADO: "bg-yellow-100 text-yellow-800",
  OPCIONAL: "bg-green-100 text-green-800",
};

const ANALYSIS_STEPS = [
  { at: 0,  title: "Analisando sua pele…",        detail: "ENVIANDO IMAGEM" },
  { at: 4,  title: "IA dermatológica avaliando…", detail: "RECONHECENDO TIPO DE PELE" },
  { at: 12, title: "Identificando achados…",       detail: "DETECTANDO ÁREAS DE ATENÇÃO" },
  { at: 22, title: "Mapeando pontos…",             detail: "LOCALIZANDO ACHADOS NA FOTO" },
  { at: 40, title: "Quase pronto…",                detail: "FINALIZANDO COORDENADAS" },
  { at: 65, title: "Gerando relatório…",           detail: "PREPARANDO RECOMENDAÇÕES" },
  { at: 90, title: "Análise detalhada…",           detail: "PROCESSAMENTO EM ANDAMENTO" },
];

export default function PatientPage() {
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [screen, setScreen] = useState<"upload" | "analyzing" | "report">("upload");
  const [preview, setPreview] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [stepTitle, setStepTitle] = useState(ANALYSIS_STEPS[0].title);
  const [stepDetail, setStepDetail] = useState(ANALYSIS_STEPS[0].detail);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: ClinicConfig) => {
        setConfig(cfg);
        applyBranding(cfg);
        document.documentElement.style.setProperty(
          "--font-main",
          `'${cfg.font}', system-ui, sans-serif`
        );
        // Only show popup after branding + clinic name are ready
        setShowPopup(true);
      })
      .catch(() => {
        // Show popup even if config fails (fallback styles)
        setShowPopup(true);
      });
  }, []);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Envie uma imagem (JPG, PNG, HEIC…)");
      return;
    }
    setError("");
    const url = URL.createObjectURL(file);
    setPreview(url);
    analyzeImage(file);
  }

  function startStepTimer() {
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const secs = Math.floor((Date.now() - start) / 1000);
      setElapsed(secs);
      let cur = ANALYSIS_STEPS[0];
      for (const s of ANALYSIS_STEPS) { if (secs >= s.at) cur = s; }
      setStepTitle(cur.title);
      setStepDetail(cur.detail);
    }, 1000);
  }

  function stopStepTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function analyzeImage(file: File) {
    setScreen("analyzing");
    setStepTitle(ANALYSIS_STEPS[0].title);
    setStepDetail(ANALYSIS_STEPS[0].detail);
    setElapsed(0);
    startStepTimer();

    const form = new FormData();
    form.append("image", file);
    try {
      const resp = await fetch("/analyze", { method: "POST", body: form });
      stopStepTimer();
      if (resp.status === 402) {
        setError("Limite de análises do plano atingido. Fale com a clínica.");
        setScreen("upload");
        return;
      }
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError(
          (data as { detail?: string; error?: string }).detail ||
          (data as { detail?: string; error?: string }).error ||
          "Erro ao analisar. Tente novamente."
        );
        setScreen("upload");
        return;
      }
      const data = await resp.json();
      setReport(data);
      setScreen("report");
    } catch {
      stopStepTimer();
      setError("Erro de conexão. Verifique sua internet e tente novamente.");
      setScreen("upload");
    }
  }

  function reset() {
    setScreen("upload");
    setPreview(null);
    setReport(null);
    setError("");
  }

  const clinicName = config?.clinic_name || "Análise de Pele";
  const welcomeText = config?.welcome_text || "Toda forma de beleza merece o melhor resultado.";
  const logoUrl = config?.logo_url || "";

  // ─── Upload ────────────────────────────────────────────────────────────────
  if (screen === "upload") {
    return (
      <main
        className="min-h-dvh flex flex-col"
        style={{ background: "var(--color-background,#F0EBE3)", color: "var(--color-text,#3A3330)" }}
      >
        {/* ── First-access popup ── */}
        {showPopup && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: "rgba(58,51,48,0.45)", backdropFilter: "blur(6px)" }}
          >
            <div
              className="bg-white rounded-[2rem] p-10 max-w-sm w-full text-center shadow-2xl"
              style={{ animation: "popupIn .4s cubic-bezier(.34,1.56,.64,1)" }}
            >
              <div
                className="flex items-center justify-center mx-auto mb-6"
                style={{
                  width: 72, height: 72, borderRadius: "50%",
                  background: "linear-gradient(135deg, var(--color-primary,#D9BFB2), var(--color-accent,#D99C94))",
                  boxShadow: "0 8px 24px rgba(217,156,148,.35)",
                }}
              >
                <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="white" strokeWidth="1.8">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </div>
              <h2 className="text-2xl font-bold mb-2 tracking-tight" style={{ color: "var(--color-text,#3A3330)" }}>
                Bem-vinda à {clinicName}!
              </h2>
              <p className="text-sm leading-relaxed mb-8" style={{ color: "var(--color-secondary,#827870)" }}>
                Tire uma selfie e receba sua{" "}
                <strong style={{ color: "var(--color-accent,#D99C94)" }}>
                  análise de pele com inteligência artificial
                </strong>{" "}
                — descubra os melhores procedimentos para você.
              </p>
              <button
                onClick={() => { setShowPopup(false); fileRef.current?.click(); }}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-full text-white font-semibold text-base transition-all hover:brightness-110"
                style={{ background: "var(--color-secondary,#827870)" }}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="white" strokeWidth="2">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                Tirar foto e analisar
              </button>
            </div>
          </div>
        )}
        <style>{`@keyframes popupIn { from{opacity:0;transform:scale(.85) translateY(20px)} to{opacity:1;transform:scale(1) translateY(0)} }`}</style>
        <div className="max-w-[480px] mx-auto w-full px-5 py-6 flex flex-col flex-1">
          <header className="text-center py-6 pb-4">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={clinicName} className="h-14 object-contain mx-auto mb-3" />
            ) : (
              <div className="text-2xl font-semibold mb-3">{clinicName}</div>
            )}
            <p className="text-sm opacity-70">{welcomeText}</p>
          </header>

          <Separator className="mb-6 opacity-30" />

          <div
            className={`flex-1 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors cursor-pointer p-8 text-center min-h-[240px] ${
              dragOver
                ? "border-[var(--color-accent,#D99C94)] bg-[var(--color-accent,#D99C94)]/10"
                : "border-[var(--color-primary,#D9BFB2)] bg-white/60"
            }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            <div className="text-5xl mb-4">📸</div>
            <p className="font-semibold text-base mb-1">Envie uma selfie do rosto</p>
            <p className="text-sm opacity-60 mb-5">Arraste aqui ou toque para selecionar</p>
            <Button
              style={{ background: "var(--color-primary,#D9BFB2)", color: "var(--color-text,#3A3330)" }}
              className="rounded-xl px-6 font-semibold"
            >
              Escolher foto
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>

          {error && <p className="text-sm text-red-600 text-center mt-4">{error}</p>}

          {(config?.footer?.phone || config?.footer?.instagram || config?.footer?.address) && (
            <footer className="text-center text-xs opacity-50 mt-6 space-y-0.5">
              {config.footer.phone && <p>📞 {config.footer.phone}</p>}
              {config.footer.instagram && <p>📷 {config.footer.instagram}</p>}
              {config.footer.address && <p>📍 {config.footer.address}</p>}
            </footer>
          )}
        </div>
      </main>
    );
  }

  // ─── Analyzing ─────────────────────────────────────────────────────────────
  if (screen === "analyzing") {
    return (
      <main
        className="min-h-dvh flex flex-col items-center justify-center text-center px-6"
        style={{ background: "var(--color-background,#F0EBE3)", color: "var(--color-text,#3A3330)" }}
      >
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes fadeStep { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
          .step-fade { animation: fadeStep .4s ease; }
        `}</style>

        {/* Photo preview */}
        {preview && (
          <div className="relative mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="preview"
              className="w-28 h-28 rounded-full object-cover border-4 shadow-lg"
              style={{ borderColor: "var(--color-primary,#D9BFB2)" }}
            />
            {/* Spinning ring */}
            <div
              className="absolute inset-0 rounded-full border-4 border-transparent"
              style={{
                borderTopColor: "var(--color-accent,#D99C94)",
                animation: "spin 1.2s linear infinite",
              }}
            />
          </div>
        )}

        {/* Main title */}
        <p key={stepTitle} className="step-fade text-xl font-bold mb-2 tracking-tight">
          {stepTitle}
        </p>

        {/* Detail tag */}
        <p
          key={stepDetail}
          className="step-fade text-xs font-mono tracking-widest mb-6"
          style={{ color: "var(--color-accent,#D99C94)" }}
        >
          {stepDetail}
        </p>

        {/* Progress dots */}
        <div className="flex gap-2 mb-4">
          {ANALYSIS_STEPS.map((s, i) => {
            const active = elapsed >= s.at && (i === ANALYSIS_STEPS.length - 1 || elapsed < ANALYSIS_STEPS[i + 1].at);
            const done   = i < ANALYSIS_STEPS.length - 1 && elapsed >= ANALYSIS_STEPS[i + 1].at;
            return (
              <div
                key={i}
                className="rounded-full transition-all duration-500"
                style={{
                  width:  active ? 20 : 8,
                  height: 8,
                  background: done
                    ? "var(--color-accent,#D99C94)"
                    : active
                    ? "var(--color-primary,#D9BFB2)"
                    : "rgba(58,51,48,0.15)",
                }}
              />
            );
          })}
        </div>

        {/* Elapsed time */}
        <p className="text-xs opacity-40">{elapsed}s</p>
      </main>
    );
  }

  // ─── Report ────────────────────────────────────────────────────────────────
  if (!report) return null;

  return (
    <main
      className="min-h-dvh"
      style={{ background: "var(--color-background,#F0EBE3)", color: "var(--color-text,#3A3330)" }}
    >
      <div className="max-w-[480px] mx-auto px-5 py-6 space-y-5">
        <div className="flex items-center justify-between">
          {logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={logoUrl} alt={clinicName} className="h-8 object-contain" />
            : <span className="font-bold">{clinicName}</span>}
          <button onClick={reset} className="text-xs opacity-60 hover:opacity-100 underline">
            Nova análise
          </button>
        </div>

        {/* Face map with markers */}
        {preview && report.findings?.length > 0 && (
          <div className="relative w-full max-w-[400px] mx-auto rounded-2xl overflow-hidden shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Foto analisada" className="w-full block" />
            {report.findings.map((f, i) => {
              const x = (f.x_point ?? 0) * 100;
              const y = (f.y_point ?? 0) * 100;
              if (x === 0 && y === 0) return null;
              const bg = f.priority === "PRIORITARIO"
                ? "#E74C3C"
                : f.priority === "OPCIONAL"
                ? "var(--color-secondary,#827870)"
                : "var(--color-accent,#D99C94)";
              return (
                <div
                  key={i}
                  className="absolute flex items-center justify-center rounded-full border-2 border-white text-white text-[0.65rem] font-bold shadow-md cursor-pointer transition-transform hover:scale-125"
                  style={{
                    width: 24, height: 24,
                    left: `${x}%`, top: `${y}%`,
                    transform: "translate(-50%, -50%)",
                    background: bg,
                    zIndex: 2,
                  }}
                  data-marker={i}
                  title={f.description}
                  onClick={() => {
                    document.getElementById(`finding-${i}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  {i + 1}
                </div>
              );
            })}
          </div>
        )}

        {/* Badges */}
        <div className="flex gap-2 justify-center flex-wrap">
          <Badge variant="secondary" className="text-xs" style={{ background: "rgba(217,156,148,0.12)", color: "var(--color-primary,#D9BFB2)" }}>
            Fototipo {report.fitzpatrick_type}
          </Badge>
          <Badge variant="secondary" className="text-xs" style={{ background: "rgba(217,156,148,0.12)", color: "var(--color-primary,#D9BFB2)" }}>
            {report.skin_type}
          </Badge>
        </div>

        {/* ── Findings ── */}
        {report.findings?.length > 0 && (
          <section>
            <h2 className="font-semibold text-sm uppercase tracking-wide opacity-60 mb-3">Achados</h2>
            <div className="space-y-3">
              {report.findings.map((f, i) => {
                const HORIZON: Record<string, string> = { CURTO_PRAZO: "Curto prazo", MEDIO_PRAZO: "Médio prazo", LONGO_PRAZO: "Longo prazo" };
                return (
                  <Card
                    key={i}
                    id={`finding-${i}`}
                    className="border-0 shadow-sm bg-white/70 cursor-pointer transition-shadow hover:shadow-md"
                    style={{ borderLeft: `4px solid ${f.priority === "PRIORITARIO" ? "#E74C3C" : f.priority === "OPCIONAL" ? "var(--color-secondary,#827870)" : "var(--color-accent,#D99C94)"}` }}
                    onClick={() => {
                      const marker = document.querySelector(`[data-marker="${i}"]`);
                      marker?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                  >
                    <CardContent className="pt-4 pb-3 space-y-2">
                      {/* Header: number + zone + priority */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono font-bold" style={{ color: "var(--color-accent,#D99C94)" }}>
                          {i + 1}. {f.zone || ""}
                        </span>
                        {f.priority && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${PRIORITY_COLOR[f.priority] || "bg-gray-100 text-gray-700"}`}>
                            {f.priority}
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      <p className="font-semibold text-sm leading-snug">{f.description}</p>

                      {/* Conduta */}
                      {f.conduta && (
                        <div className="text-xs opacity-75 leading-relaxed">
                          <span className="font-semibold">Conduta: </span>{f.conduta}
                        </div>
                      )}

                      {/* Procedimentos indicados */}
                      {f.procedimentos_indicados?.length ? (
                        <div className="space-y-2 mt-1">
                          {f.procedimentos_indicados.map((p, j) => (
                            <div key={j} className="flex gap-2 items-start">
                              <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: "var(--color-accent,#D99C94)" }} />
                              <div className="text-xs">
                                <p className="font-semibold">{p.nome}</p>
                                {p.descricao_breve && <p className="opacity-70">{p.descricao_breve}</p>}
                                {p.sessoes_estimadas && <p className="opacity-60">{p.sessoes_estimadas}</p>}
                                {p.horizonte && <p className="opacity-50 text-[10px]">{HORIZON[p.horizonte] || p.horizonte}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {/* Clinical note */}
                      {f.clinical_note && (
                        <p className="text-[11px] italic opacity-50 leading-relaxed">{f.clinical_note}</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Plano Terapêutico ── */}
        {report.plano_terapeutico && (
          <section>
            <h2 className="font-semibold text-sm uppercase tracking-wide opacity-60 mb-3">Plano Terapêutico</h2>
            <Card className="border-0 shadow-sm bg-white/70">
              <CardContent className="pt-4 pb-3 space-y-4 text-sm">
                {[
                  { label: "Curto prazo (0–30 dias)", text: report.plano_terapeutico.curto_prazo, color: "#E74C3C" },
                  { label: "Médio prazo (1–3 meses)", text: report.plano_terapeutico.medio_prazo, color: "var(--color-accent,#D99C94)" },
                  { label: "Longo prazo (3–12 meses)", text: report.plano_terapeutico.longo_prazo, color: "var(--color-secondary,#827870)" },
                ].map(({ label, text, color }) => text ? (
                  <div key={label}>
                    <p className="font-bold text-xs uppercase mb-1" style={{ color }}>{label}</p>
                    <p className="text-xs opacity-80 leading-relaxed">{text}</p>
                  </div>
                ) : null)}
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Rotina de Skin Care ── */}
        {(report.am_routine || report.pm_routine) ? (
          <section>
            <h2 className="font-semibold text-sm uppercase tracking-wide opacity-60 mb-3">Rotina de Skin Care</h2>
            {[{ label: "Rotina Manhã", text: report.am_routine }, { label: "Rotina Noite", text: report.pm_routine }].map(({ label, text }) =>
              text ? (
                <Card key={label} className="border-0 shadow-sm bg-white/70 mb-3">
                  <CardContent className="pt-4 pb-3">
                    <p className="font-bold text-xs uppercase mb-2" style={{ color: "var(--color-accent,#D99C94)" }}>{label}</p>
                    <p className="text-xs opacity-75 leading-relaxed whitespace-pre-line">{text}</p>
                  </CardContent>
                </Card>
              ) : null
            )}
          </section>
        ) : null}

        {/* ── Observações ── */}
        {(report.general_observations || config?.disclaimer) && (
          <section>
            <h2 className="font-semibold text-sm uppercase tracking-wide opacity-60 mb-3">Observações</h2>
            <Card className="border-0 shadow-sm bg-white/70">
              <CardContent className="pt-4 pb-3">
                <p className="text-xs opacity-70 leading-relaxed whitespace-pre-line">
                  {report.general_observations}
                </p>
                {config?.disclaimer && (
                  <p className="text-[10px] opacity-40 mt-3 leading-relaxed">{config.disclaimer}</p>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        <div className="pb-6 text-center">
          <Button
            onClick={reset}
            style={{ background: "var(--color-primary,#D9BFB2)", color: "var(--color-text,#3A3330)" }}
            className="rounded-xl px-8 font-semibold"
          >
            Nova análise
          </Button>
        </div>
      </div>
    </main>
  );
}

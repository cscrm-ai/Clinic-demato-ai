"use client";

import { useEffect, useRef, useState } from "react";
import { applyBranding, type ClinicConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type Finding = {
  finding_name: string;
  severity: string;
  description: string;
  procedimentos_indicados?: { nome: string; sessoes_estimadas?: number }[];
};

type Routine = { step: number; product_type: string; how_to_apply?: string };

type Report = {
  skin_type: string;
  fitzpatrick_type: string;
  findings: Finding[];
  plano_terapeutico?: {
    curto_prazo?: string;
    medio_prazo?: string;
    longo_prazo?: string;
  };
  am_routine?: Routine[];
  pm_routine?: Routine[];
  general_observations?: string;
};

const SEVERITY_COLOR: Record<string, string> = {
  leve: "bg-green-100 text-green-800",
  moderada: "bg-yellow-100 text-yellow-800",
  acentuada: "bg-orange-100 text-orange-800",
  intensa: "bg-red-100 text-red-800",
};

export default function PatientPage() {
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [screen, setScreen] = useState<"upload" | "analyzing" | "report">("upload");
  const [preview, setPreview] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showPopup, setShowPopup] = useState(true);

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
      })
      .catch(() => {});
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

  async function analyzeImage(file: File) {
    setScreen("analyzing");
    const form = new FormData();
    form.append("image", file);
    try {
      const resp = await fetch("/analyze", { method: "POST", body: form });
      if (resp.status === 402) {
        setError("Limite de análises do plano atingido. Fale com a clínica.");
        setScreen("upload");
        return;
      }
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError((data as Record<string, string>).detail || "Erro ao analisar. Tente novamente.");
        setScreen("upload");
        return;
      }
      const data = await resp.json();
      setReport(data);
      setScreen("report");
    } catch {
      setError("Erro de conexão. Tente novamente.");
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
        <div className="text-5xl mb-6 animate-pulse">🔬</div>
        <p className="text-xl font-semibold mb-2">Analisando sua pele…</p>
        <p className="text-sm opacity-60">Isso leva alguns segundos.</p>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="preview"
            className="mt-6 w-24 h-24 rounded-full object-cover border-4"
            style={{ borderColor: "var(--color-primary,#D9BFB2)" }}
          />
        )}
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

        <Card className="border-0 shadow-sm bg-white/70">
          <CardContent className="pt-5 pb-4 space-y-2">
            <div className="flex items-center gap-3">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="foto" className="w-14 h-14 rounded-full object-cover border-2"
                  style={{ borderColor: "var(--color-primary,#D9BFB2)" }} />
              )}
              <div>
                <p className="font-semibold text-base">{report.skin_type}</p>
                <p className="text-xs opacity-60">Fitzpatrick {report.fitzpatrick_type}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {report.findings?.length > 0 && (
          <section>
            <h2 className="font-semibold text-sm uppercase tracking-wide opacity-60 mb-3">Achados</h2>
            <div className="space-y-3">
              {report.findings.map((f, i) => (
                <Card key={i} className="border-0 shadow-sm bg-white/70">
                  <CardContent className="pt-4 pb-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm">{f.finding_name}</span>
                      {f.severity && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_COLOR[f.severity.toLowerCase()] || "bg-gray-100 text-gray-700"}`}>
                          {f.severity}
                        </span>
                      )}
                    </div>
                    {f.description && <p className="text-xs opacity-70">{f.description}</p>}
                    {f.procedimentos_indicados?.length ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {f.procedimentos_indicados.map((p, j) => (
                          <Badge key={j} variant="outline" className="text-xs">
                            {p.nome}{p.sessoes_estimadas ? ` · ${p.sessoes_estimadas}x` : ""}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {report.plano_terapeutico && (
          <section>
            <h2 className="font-semibold text-sm uppercase tracking-wide opacity-60 mb-3">Plano terapêutico</h2>
            <Card className="border-0 shadow-sm bg-white/70">
              <CardContent className="pt-4 pb-3 space-y-3 text-sm">
                {report.plano_terapeutico.curto_prazo && (
                  <div>
                    <p className="font-semibold text-xs opacity-50 uppercase mb-0.5">Curto prazo</p>
                    <p className="opacity-80">{report.plano_terapeutico.curto_prazo}</p>
                  </div>
                )}
                {report.plano_terapeutico.medio_prazo && (
                  <div>
                    <p className="font-semibold text-xs opacity-50 uppercase mb-0.5">Médio prazo</p>
                    <p className="opacity-80">{report.plano_terapeutico.medio_prazo}</p>
                  </div>
                )}
                {report.plano_terapeutico.longo_prazo && (
                  <div>
                    <p className="font-semibold text-xs opacity-50 uppercase mb-0.5">Longo prazo</p>
                    <p className="opacity-80">{report.plano_terapeutico.longo_prazo}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {(report.am_routine?.length || report.pm_routine?.length) ? (
          <section>
            <h2 className="font-semibold text-sm uppercase tracking-wide opacity-60 mb-3">Rotina de skincare</h2>
            <div className="grid grid-cols-2 gap-3">
              {[{ label: "🌅 Manhã", items: report.am_routine }, { label: "🌙 Noite", items: report.pm_routine }].map(({ label, items }) =>
                items?.length ? (
                  <Card key={label} className="border-0 shadow-sm bg-white/70">
                    <CardContent className="pt-4 pb-3">
                      <p className="font-semibold text-xs mb-2">{label}</p>
                      <ol className="space-y-1">
                        {items.map((r, i) => (
                          <li key={i} className="text-xs opacity-75">{r.step}. {r.product_type}</li>
                        ))}
                      </ol>
                    </CardContent>
                  </Card>
                ) : null
              )}
            </div>
          </section>
        ) : null}

        {report.general_observations && (
          <Card className="border-0 shadow-sm bg-white/70">
            <CardContent className="pt-4 pb-3">
              <p className="text-xs opacity-70">{report.general_observations}</p>
            </CardContent>
          </Card>
        )}

        {config?.disclaimer && (
          <p className="text-[10px] opacity-40 text-center leading-relaxed">{config.disclaimer}</p>
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

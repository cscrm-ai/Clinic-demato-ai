"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SetPasswordPage() {
  const [token, setToken] = useState("");
  const [clinic, setClinic] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    // Extract token from URL hash: #access_token=...&type=recovery
    const hash = new URLSearchParams(
      window.location.hash.replace(/^#/, "")
    );
    const t = hash.get("access_token") || "";
    const params = new URLSearchParams(window.location.search);
    const c = params.get("clinic") || "";

    if (!t) {
      setInvalid(true);
    } else {
      setToken(t);
      setClinic(c);
    }

    // Clear token from URL for security
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search
    );
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (pw1.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (pw1 !== pw2) {
      setError("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: pw1 }),
      });
      const data = await resp.json();

      if (resp.ok && data.ok) {
        setSuccess(true);
        setTimeout(() => {
          const base = "allbele.app";
          if (clinic) {
            window.location.href = `https://${clinic}.${base}/admin`;
          } else {
            window.location.href = "/admin";
          }
        }, 1500);
      } else {
        setError(data.error || "Erro ao salvar senha. Tente novamente.");
      }
    } catch {
      setError("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="text-4xl mb-2">🔐</div>
          <CardTitle className="text-xl">Defina sua senha</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Configure a senha de acesso ao painel da sua clínica.
          </p>
        </CardHeader>

        <CardContent>
          {invalid ? (
            <p className="text-sm text-destructive text-center">
              Link expirado ou inválido.
              <br />
              Solicite um novo acesso ao administrador.
            </p>
          ) : success ? (
            <p className="text-sm text-green-600 text-center">
              ✓ Senha definida com sucesso! Redirecionando…
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Mínimo 8 caracteres.
              </p>
              <div className="space-y-2">
                <Label htmlFor="pw1">Nova senha</Label>
                <Input
                  id="pw1"
                  type="password"
                  placeholder="Nova senha"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">Confirmar senha</Label>
                <Input
                  id="pw2"
                  type="password"
                  placeholder="Confirmar senha"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmit(e as unknown as React.FormEvent);
                  }}
                />
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Salvando…" : "Salvar senha"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

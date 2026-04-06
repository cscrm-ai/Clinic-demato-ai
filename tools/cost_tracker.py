"""Rastreamento de custo das chamadas de AI por análise.

Converte tokens Gemini e calls Moondream em centavos de BRL.
Os valores são estimativas — ajuste as constantes conforme necessário.

Uso:
    tracker = CostAccumulator(clinic_id="...", analysis_id="...")
    tracker.add_gemini(tokens_in=1200, tokens_out=800, latency_ms=3100)
    tracker.add_moondream(calls=21, latency_ms=9800)
    print(tracker.total_cents())   # ex: 0.0412
    records = tracker.events()     # lista pronta para log_usage_event()
"""

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

# ---------------------------------------------------------------------------
# Constantes de preço — edite aqui quando os valores mudarem
# ---------------------------------------------------------------------------

# Gemini 2.0 Flash Lite — preço por 1 milhão de tokens (USD)
GEMINI_INPUT_PRICE_PER_1M_USD  = Decimal("0.075")
GEMINI_OUTPUT_PRICE_PER_1M_USD = Decimal("0.300")

# Moondream3 via FAL AI — preço por call (USD)
# TODO: confirmar valor real na dashboard do FAL
MOONDREAM_PRICE_PER_CALL_USD = Decimal("0.003")

# Taxa de conversão USD → BRL (centavos)
# 1 USD = USD_TO_BRL reais = USD_TO_BRL * 100 centavos
# TODO: substituir por cotação dinâmica quando necessário
USD_TO_BRL = Decimal("5.10")


# ---------------------------------------------------------------------------
# Funções utilitárias de custo
# ---------------------------------------------------------------------------

def gemini_cost_cents(tokens_in: int, tokens_out: int) -> Decimal:
    """Calcula custo de uma chamada Gemini em centavos de BRL."""
    input_usd  = (Decimal(tokens_in)  / Decimal("1_000_000")) * GEMINI_INPUT_PRICE_PER_1M_USD
    output_usd = (Decimal(tokens_out) / Decimal("1_000_000")) * GEMINI_OUTPUT_PRICE_PER_1M_USD
    total_usd  = input_usd + output_usd
    return (total_usd * USD_TO_BRL * 100).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def moondream_cost_cents(calls: int) -> Decimal:
    """Calcula custo de N calls Moondream em centavos de BRL."""
    total_usd = Decimal(calls) * MOONDREAM_PRICE_PER_CALL_USD
    return (total_usd * USD_TO_BRL * 100).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Acumulador de custo por análise
# ---------------------------------------------------------------------------

@dataclass
class CostAccumulator:
    """Acumula eventos de custo durante o pipeline de uma análise.

    Parâmetros opcionais clinic_id e analysis_id são usados para
    popular os campos ao gerar a lista de eventos para o banco.
    analysis_id pode ser preenchido depois (após salvar a análise).
    """

    clinic_id:   str = ""
    analysis_id: str = ""

    # Acumuladores internos (não passar no construtor)
    _events: list[dict] = field(default_factory=list, init=False, repr=False)

    def add_gemini(
        self,
        tokens_in:  int,
        tokens_out: int,
        operation:  str = "generate_report",
        latency_ms: int | None = None,
    ) -> None:
        """Registra uma chamada ao Gemini com contagem de tokens."""
        cost = gemini_cost_cents(tokens_in, tokens_out)
        self._events.append({
            "clinic_id":   self.clinic_id,
            "analysis_id": self.analysis_id or None,
            "provider":    "gemini",
            "operation":   operation,
            "tokens_in":   tokens_in,
            "tokens_out":  tokens_out,
            "calls":       1,
            "cost_cents":  float(cost),
            "latency_ms":  latency_ms,
        })

    def add_moondream(
        self,
        calls:      int = 1,
        operation:  str = "locate_finding",
        latency_ms: int | None = None,
    ) -> None:
        """Registra N calls ao Moondream3 via FAL."""
        cost = moondream_cost_cents(calls)
        self._events.append({
            "clinic_id":   self.clinic_id,
            "analysis_id": self.analysis_id or None,
            "provider":    "moondream_fal",
            "operation":   operation,
            "tokens_in":   0,
            "tokens_out":  0,
            "calls":       calls,
            "cost_cents":  float(cost),
            "latency_ms":  latency_ms,
        })

    def total_cents(self) -> float:
        """Retorna o custo total acumulado em centavos de BRL."""
        return round(sum(e["cost_cents"] for e in self._events), 6)

    def events(self) -> list[dict]:
        """Retorna cópia da lista de eventos pronta para log_usage_event()."""
        return list(self._events)

    def set_analysis_id(self, analysis_id: str) -> None:
        """Atualiza analysis_id em todos os eventos já registrados.

        Chamar após salvar a análise no banco e obter o ID gerado.
        """
        self.analysis_id = analysis_id
        for event in self._events:
            event["analysis_id"] = analysis_id

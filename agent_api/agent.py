"""Agente de analise dermatologica para clinicas esteticas.

Analisa fotografias de pele e gera laudos com foco em procedimentos
esteticos usando Gemini (analise visual) + Moondream3 via FAL AI (coordenadas).
"""

import sys
import time as _time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from agno.agent import Agent
from agno.media import Image
from agno.models.google import Gemini

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.cost_tracker import CostAccumulator
from tools.fal_points import get_moondream_points
from tools.models import SkinAnalysisReport

SYSTEM_PROMPT = """# Dra. Sync — Dermatologista Especialista em Medicina Estetica Facial

Voce e a Dra. Sync — dermatologista com mais de 15 anos de experiencia
clinica e estetica, formacao em dermatologia pela USP, especializacao em
cosmiatria avancada, medicina estetica facial e tecnologias em saude da pele.

Seu diferencial e a integracao entre diagnostico clinico preciso e dominio
completo do arsenal terapeutico moderno: toxina botulinica, preenchedores,
bioestimuladores, lasers, ultrassom microfocado, radiofrequencia, peelings,
skincare cosmeceutico e protocolos combinados.

Sua funcao e analisar uma fotografia de pele, gerar um laudo dermatologico
clinico e propor um plano terapeutico personalizado com procedimentos,
tecnologias e rotinas indicadas para cada achado identificado.

> AVISO ETICO: Este laudo e orientativo e nao substitui consulta medica
> presencial. Diagnosticos definitivos, prescricoes e procedimentos exigem
> avaliacao clinica completa por profissional habilitado.

IMPORTANT: ALL text output MUST be written in Brazilian Portuguese (pt-BR).
ONLY the "query" field should be in simple English.

## COORDINATES INSTRUCTIONS
Set x_point=0 and y_point=0 for ALL findings.
Coordinates will be filled automatically by a separate vision model.

### COORDINATE HINTS (x_hint, y_hint) — YOU MUST FILL THESE
You are looking at the image. For each finding, estimate WHERE it appears:
- x_hint: horizontal position (0.0=left edge of image, 0.5=horizontal center, 1.0=right edge)
- y_hint: vertical position (0.0=top of image, 0.5=vertical center, 1.0=bottom of image)

FACE ANATOMY REFERENCE for a typical portrait/selfie (face fills most of the frame):
  VERTICAL (y_hint):
  - Hairline / top of forehead:    y ≈ 0.10 – 0.18
  - Mid forehead:                  y ≈ 0.20 – 0.30
  - Glabella (between brows):      y ≈ 0.33 – 0.38
  - Eyes / eyelids (on the eye):   y ≈ 0.37 – 0.44
  - UNDER EYE / tear trough:       y ≈ 0.45 – 0.53  ← dark circles / olheiras here
  - Nose tip:                      y ≈ 0.58 – 0.65
  - Upper lip / philtrum:          y ≈ 0.65 – 0.70
  - Mouth / lips:                  y ≈ 0.70 – 0.76
  - Chin:                          y ≈ 0.82 – 0.92

  HORIZONTAL (x_hint) — image is mirrored vs. patient anatomy:
  - Patient's RIGHT side (appears on LEFT of image):  x ≈ 0.20 – 0.42
  - Center of face:                                   x ≈ 0.45 – 0.55
  - Patient's LEFT side (appears on RIGHT of image):  x ≈ 0.58 – 0.80

  CRITICAL DISTINCTIONS:
  * "ON the eye" (pupil, iris) = y ≈ 0.38-0.44 — DO NOT use for dark circles
  * "UNDER the eye / olheiras / sombreamento periorbital" = y ≈ 0.46-0.53
  * "Crow's feet" = outer corner of eye, x far from center, y ≈ 0.40-0.47
  * "Nasolabial fold" = runs from x≈0.38/0.62 at y≈0.55 down to x≈0.35/0.65 at y≈0.73

### QUERIES FIELD — 3 DISTINCT PRECISE ANATOMICAL DESCRIPTIONS
The "queries" field is a LIST of 3 different English descriptions used by a vision model.
Each query targets the SAME finding but from a different descriptive angle.
The system takes the MEDIAN of 3 results — so if 2 of 3 agree, precision is guaranteed.

RULES FOR ALL 3 QUERIES:
- NEVER use medical jargon (Moondream3 doesn't understand it)
- ALWAYS describe visually: WHAT you see + EXACT location with anatomical landmarks
- For periorbital: ALWAYS specify "below lower eyelid" / "outer corner" / "above cheekbone"
- queries[0] = DETAILED primary (landmark-rich, specific)
- queries[1] = ANATOMICAL VARIANT (describe using adjacent structures)
- queries[2] = SIMPLE VISUAL (direct, plain English)

EXAMPLES per finding type:

  Dark circles / olheiras:
    queries[0]: "dark brownish shadow in the hollow directly below the lower eyelid, above the cheekbone, tear trough region"
    queries[1]: "discoloration in the infraorbital hollow between the lower eye socket and upper cheekbone"
    queries[2]: "dark area under the eye"

  Crow's feet:
    queries[0]: "fine radiating lines at the outer corner of the left eye extending toward the temple"
    queries[1]: "small wrinkle lines fanning out from where the eyelids meet at the outer edge"
    queries[2]: "wrinkles at outer corner of eye"

  Eye bags:
    queries[0]: "puffy swollen bulge directly beneath the lower left eyelid margin"
    queries[1]: "soft puffiness in the area just under the lower eyelash line"
    queries[2]: "puffy bag below lower eyelid"

  Forehead lines:
    queries[0]: "horizontal crease lines running across the middle of the forehead"
    queries[1]: "parallel horizontal wrinkles on the upper face between hairline and eyebrows"
    queries[2]: "forehead wrinkle lines"

  Glabella / frown lines:
    queries[0]: "vertical frown lines between the eyebrows in the glabella region"
    queries[1]: "vertical creases in the space directly between the two eyebrows"
    queries[2]: "lines between eyebrows"

  Nasolabial fold:
    queries[0]: "deep fold running diagonally from the right nostril base down to the corner of the mouth"
    queries[1]: "groove on the right side of the face from the nose wing toward the lip corner"
    queries[2]: "nasolabial fold right side"

  Acne / pimple:
    queries[0]: "red raised pimple bump on the left cheek below the cheekbone"
    queries[1]: "inflamed red spot on the left facial cheek area"
    queries[2]: "red pimple on left cheek"

  Pores:
    queries[0]: "enlarged open pores on the nose tip and central forehead area"
    queries[1]: "visible pore texture on the nose and T-zone of the face"
    queries[2]: "enlarged pores on nose"

  Melasma / pigmentation:
    queries[0]: "brown pigmented patch on the right cheekbone area"
    queries[1]: "darker brown skin discoloration on the upper right cheek"
    queries[2]: "brown spot on right cheek"

  Redness / rosacea:
    queries[0]: "diffuse red flushing across both cheeks below the eyes"
    queries[1]: "reddish skin tone on the cheek areas beside the nose"
    queries[2]: "redness on cheeks"

BAD queries: "sombreamento periorbital", "hiperpigmentacao", "lesao", any Portuguese or medical jargon

---

## Protocolo de Analise

### 1. Fototipo (Escala de Fitzpatrick)
Identifique o fototipo aparente (I a VI) com base nas caracteristicas
visiveis. O fototipo direciona a escolha segura de tecnologias.

### 2. Analise por Zonas Dermatologicas

Avalie cada zona com rigor clinico e, para cada achado, indique tambem o
procedimento ou tecnologia mais indicada:

**Zona T (testa, nariz, queixo)**
- Seborreia, poros dilatados, comedoes, acne ativa, cicatrizes, manchas
- Procedimentos: peeling quimico, laser fracionado, radiofrequencia,
  limpeza de pele profissional, luz intensa pulsada (IPL)

**Regiao Periorbital**
- Olheiras (vascular / pigmentar / estrutural / mista), milia, rugas finas
  (pes de galinha), flacidez palpebral, ptose sobrancelha
- Procedimentos: toxina botulinica (pes de galinha, lifting de sobrancelha),
  preenchedor (olheira estrutural — acido hialuronico), carboxiterapia
  (olheira vascular/pigmentar), laser Nd:YAG, ultrassom microfocado (HIFU)

**Macas do Rosto**
- Rosacea, telangectasias, manchas (melasma, lentigos), cicatrizes de acne,
  perda de volume malar
- Procedimentos: IPL / laser vascular, peeling de TCA, preenchedor malar
  (acido hialuronico), bioestimuladores (Sculptra, Radiesse), microagulhamento

**Boca e Regiao Perioral**
- Rugas peribucais (codigo de barras), sulco nasolabial, comissura labial
  caida, volume labial, queilite
- Procedimentos: toxina botulinica (rugas peribucais, virada de labio),
  preenchedor labial e nasolabial, peeling superficial, laser CO2 fracionado

**Testa**
- Rugas dinamicas (frontalis) vs estaticas, manchas actinicas, glabela
- Procedimentos: toxina botulinica (linhas de expressao), laser fracionado
  (rugas estaticas), peeling quimico, bioestimulador de colageno

**Temporas e Contorno Facial**
- Perda de volume temporal, flacidez de mandibula, jowls, papada
- Procedimentos: preenchedor temporal, fios de PDO/PLLA (thread lift),
  ultrassom microfocado HIFU, radiofrequencia fracionada, toxina botulinica
  (platysma, masseter para slimming facial)

**Pescoco e Colo (se visivel)**
- Rugas horizontais (colar de Venus), manchas solares, flacidez, papada
- Procedimentos: toxina botulinica (platysma bands), laser fracionado,
  bioestimuladores, carboxiterapia, HIFU

---

### 3. Para cada achado identificado:
- Preencha todos os campos do schema de resposta com precisao clinica
- Inclua o campo `procedimentos_indicados` com as opcoes terapeuticas
- Cada procedimento deve ter: nome, tipo, descricao_breve, sessoes_estimadas, horizonte
- Report between 5 and 7 findings (inclusive) — priorize os mais relevantes clinicamente
- Do NOT invent findings. Do NOT skip the most visible/impactful ones.

---

### 4. Plano Terapeutico Personalizado

Estruture um plano em 3 horizontes:

**Curto prazo (0-30 dias) — Quick wins**
Procedimentos com resultado imediato ou de baixa complexidade:
toxina botulinica, preenchedores, peelings superficiais, limpeza de pele.

**Medio prazo (1-3 meses) — Tratamento base**
Tecnologias de remodelacao: laser fracionado, IPL, microagulhamento,
radiofrequencia, bioestimuladores, protocolos de peeling seriado.

**Longo prazo (3-12 meses) — Manutencao e prevencao**
Sessoes de manutencao, reaplicacoes, skincare cosmeceutico domiciliar,
fotoprotecao e revisao de protocolo.

---

### 5. Rotina de Skin Care Domiciliar (AM / PM)

Sugira rotina personalizada com base nos achados, incluindo:
- Limpador adequado ao tipo de pele
- Ativos cosmeceuticos indicados (retinol, niacinamida, vitamina C,
  acido azelaico, peptideos, etc.)
- Hidratante e barreira cutanea
- Fotoprotetor (FPS minimo, formulacao ideal para o fototipo)
- Sinergia entre rotina domiciliar e procedimentos em clinica

---

## Tom e Postura Clinica
- Medica experiente, empatica e atualizada — tecnica, mas acessivel ao paciente leigo
- Use nomenclatura dermatologica correta e explique em linguagem simples
- Sempre reforce fotoprotecao como alicerce de qualquer protocolo
- Mencione quando um achado requer avaliacao presencial ou prescricao medica
- Nunca prometa resultados; use linguagem de probabilidade clinica
- Foque em PROCEDIMENTOS ESTETICOS, nao em produtos comerciais"""


def analyze_image(
    img_path: str,
    procedures_catalog: list = None,
    cost_tracker: CostAccumulator | None = None,
) -> SkinAnalysisReport:
    """Analisa uma imagem de pele e retorna o laudo estruturado.

    Se cost_tracker for passado, os custos de Gemini e Moondream são
    acumulados nele. Caso contrário, um tracker descartável é criado
    apenas para manter a lógica interna consistente.
    """
    tracker = cost_tracker or CostAccumulator()

    agent = Agent(
        name="dra_sync_clinic",
        model=Gemini(id="gemini-2.5-flash-lite"),
        output_schema=SkinAnalysisReport,
        instructions=SYSTEM_PROMPT,
        markdown=True,
    )

    catalog_block = ""
    if procedures_catalog:
        valid_items = [p for p in procedures_catalog if p.get("nome") and p.get("ativo", True)]
        if valid_items:
            items_str = "\n".join(
                f"  - {p['nome']}{' — ' + p['marca'] if p.get('marca') else ''} [{p.get('tipo', 'OUTROS')}]"
                for p in valid_items
            )
            catalog_block = f"""

⚠️ STRICT CLINIC CATALOG — YOU MUST FOLLOW THIS:
The clinic only offers the procedures listed below.
You MUST ONLY recommend procedures from this exact list.
Do NOT suggest any procedure not in this list, even if clinically indicated.
If no procedure from the list fits a finding, omit procedimentos_indicados for that finding.

AVAILABLE PROCEDURES:
{items_str}
"""

    user_prompt = """Analyze the skin image with MAXIMUM DETAIL and generate the full dermatological report
focused on AESTHETIC PROCEDURES.

Remember:
- Set x_point=0 and y_point=0 for all findings (coordinates filled separately)
- FILL x_hint and y_hint with your visual estimate of WHERE the finding is (0-1 normalized)
- For UNDER-EYE findings (dark circles, olheiras): y_hint MUST be 0.46-0.53 (BELOW the eye, not ON it)
- Write "queries" field with EXACTLY 3 DISTINCT English queries (primary + anatomical variant + simple)
- The 3 queries describe the SAME finding from different angles — see the examples in instructions
- Write ALL other fields in Brazilian Portuguese (pt-BR)
- Include procedimentos_indicados for each finding with sessoes_estimadas
- Generate the plano_terapeutico with curto/medio/longo prazo
- Include AM and PM skincare routines
- Focus on aesthetic procedures, NOT commercial products""" + catalog_block

    _t_gemini_start = _time.time()
    response = agent.run(user_prompt, images=[Image(filepath=img_path)])
    _t_gemini_ms = int((_time.time() - _t_gemini_start) * 1000)
    report = response.content

    # Instrumentação de custo Gemini — extrai usage_metadata se disponível
    try:
        usage = getattr(response, "usage_metadata", None) or getattr(response, "metrics", None)
        tokens_in  = getattr(usage, "prompt_token_count",     0) or getattr(usage, "input_tokens",  0) or 0
        tokens_out = getattr(usage, "candidates_token_count", 0) or getattr(usage, "output_tokens", 0) or 0
        tracker.add_gemini(
            tokens_in=int(tokens_in),
            tokens_out=int(tokens_out),
            operation="generate_report",
            latency_ms=_t_gemini_ms,
        )
        print(f"[COST] Gemini: {tokens_in} in / {tokens_out} out — {_t_gemini_ms}ms")
    except Exception as _cost_exc:
        print(f"[COST] Não foi possível extrair tokens Gemini: {_cost_exc}")

    # Parsing defensivo: alguns modelos retornam string JSON em vez do objeto Pydantic
    if isinstance(report, str):
        import json as _json, re as _re
        print(f"[WARN] Modelo retornou string — tentando parse manual...")
        # Remove blocos de markdown ```json ... ```
        cleaned = _re.sub(r"```(?:json)?\s*", "", report).replace("```", "").strip()
        try:
            data = _json.loads(cleaned)
            report = SkinAnalysisReport(**data)
            print(f"[INFO] Parse manual bem-sucedido")
        except Exception as parse_exc:
            raise ValueError(
                f"Modelo retornou resposta inválida. Parse falhou: {parse_exc}\n"
                f"Preview: {report[:300]}"
            )

    from statistics import median as _median

    t0 = _time.time()
    print(f"\n[DRA. SYNC] Gerou {len(report.findings)} achados. Buscando coordenadas em paralelo...\n")

    # ── Paralelização total: todos os findings × todas as queries de uma vez ──
    # Em vez de processar finding por finding (sequencial), submete TODOS os pares
    # (finding_idx, query_idx) de uma vez para um único pool → tempo Moondream ≈ 1 lote
    all_tasks: list[tuple[int, int, str]] = []
    for i, finding in enumerate(report.findings):
        for j, q in enumerate(finding.queries or []):
            all_tasks.append((i, j, q))

    max_workers = max(1, min(len(all_tasks), 32))
    results_map: dict[tuple[int, int], dict] = {}

    print(f"  Submetendo {len(all_tasks)} queries em {max_workers} workers simultâneos...")
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_to_task = {
            pool.submit(get_moondream_points, img_path, q): (i, j)
            for i, j, q in all_tasks
        }
        for fut in as_completed(future_to_task):
            i, j = future_to_task[fut]
            try:
                results_map[(i, j)] = fut.result()
            except Exception as exc:
                print(f"  [A{i+1}/Q{j+1}] erro: {exc}")
                results_map[(i, j)] = {"x": 0, "y": 0}

    t_moondream = _time.time() - t0
    t_moondream_ms = int(t_moondream * 1000)
    print(f"  Moondream concluído em {t_moondream:.1f}s\n")

    # Instrumentação de custo Moondream — total de calls do lote principal
    if all_tasks:
        tracker.add_moondream(
            calls=len(all_tasks),
            operation="locate_finding",
            latency_ms=t_moondream_ms,
        )
        print(f"[COST] Moondream: {len(all_tasks)} calls — {t_moondream_ms}ms")

    # ── Processar resultados por finding ──
    for i, finding in enumerate(report.findings):
        print(f"[ACHADO {i+1}] {finding.zone}: {finding.description}")
        print(f"  Gemini hint: x={finding.x_hint:.3f}, y={finding.y_hint:.3f}")

        queries = finding.queries or []
        valid_results = []
        for j, q in enumerate(queries):
            coords = results_map.get((i, j), {"x": 0, "y": 0})
            if not (coords["x"] == 0 and coords["y"] == 0):
                print(f"  [Q{j+1}] ✓ x={coords['x']:.3f}, y={coords['y']:.3f} — '{q[:60]}'")
                valid_results.append(coords)
            else:
                print(f"  [Q{j+1}] ✗ sem resultado — '{q[:60]}'")

        # Fallback por zona se todas as queries falharam
        if not valid_results:
            alt_q = _build_zone_fallback(finding.zone)
            print(f"  [FALLBACK] Tentando fallback por zona: '{alt_q}'")
            _t_fb = _time.time()
            coords = get_moondream_points(img_path, alt_q)
            _t_fb_ms = int((_time.time() - _t_fb) * 1000)
            tracker.add_moondream(calls=1, operation="locate_finding_fallback", latency_ms=_t_fb_ms)
            if not (coords["x"] == 0 and coords["y"] == 0):
                valid_results.append(coords)
                print(f"  [FALLBACK] ✓ x={coords['x']:.3f}, y={coords['y']:.3f}")

        # Mediana dos resultados válidos
        if valid_results:
            median_coords = {
                "x": _median([r["x"] for r in valid_results]),
                "y": _median([r["y"] for r in valid_results]),
            }
            used_source = f"moondream-median({len(valid_results)}/{len(queries)})"
            print(f"  Mediana: x={median_coords['x']:.3f}, y={median_coords['y']:.3f}")
        else:
            print(f"  [FALLBACK-TOTAL] Moondream sem resultado — usando estimativa Gemini")
            median_coords = {"x": finding.x_hint, "y": finding.y_hint}
            used_source = "gemini-hint-fallback"

        # Validar com threshold por zona + blending proporcional
        final_coords = median_coords
        if used_source != "gemini-hint-fallback" and finding.x_hint > 0 and finding.y_hint > 0:
            zone_threshold = _get_zone_threshold(finding.zone)
            dist = _euclidean(median_coords["x"], median_coords["y"], finding.x_hint, finding.y_hint)
            print(f"  Dist hint↔mediana: {dist:.3f} (threshold zona: {zone_threshold:.2f})")

            if dist < zone_threshold:
                final_coords = median_coords
                used_source += " ✓confiavel"
            elif dist < zone_threshold * 2:
                hint_weight = ((dist - zone_threshold) / zone_threshold) * 0.6
                final_coords = _proportional_blend(median_coords, finding.x_hint, finding.y_hint, hint_weight)
                used_source += f" ~blend({hint_weight:.2f})"
            else:
                final_coords = _proportional_blend(median_coords, finding.x_hint, finding.y_hint, 0.75)
                used_source += " →hint(0.75)"

        finding.x_point = final_coords["x"]
        finding.y_point = final_coords["y"]
        print(f"  FINAL [{used_source}]: x={finding.x_point:.3f}, y={finding.y_point:.3f}\n")

    print(f"[CONCLUIDO] Coordenadas em {_time.time() - t0:.1f}s\n")
    return report


# ─── Helpers de coordenadas ───────────────────────────────────────────────────

def _euclidean(x1: float, y1: float, x2: float, y2: float) -> float:
    return ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5


def _proportional_blend(moondream: dict, hx: float, hy: float, hint_weight: float) -> dict:
    """Blending com peso explícito do hint (0.0=100% Moondream, 1.0=100% hint)."""
    w = max(0.0, min(1.0, hint_weight))
    return {
        "x": moondream["x"] * (1 - w) + hx * w,
        "y": moondream["y"] * (1 - w) + hy * w,
    }


def _get_zone_threshold(zone: str) -> float:
    """Threshold máximo de desvio aceitável por zona anatômica."""
    z = zone.lower()
    if any(k in z for k in ["periorbital", "orbital", "olheira"]):
        return 0.08   # Crítico: on eye vs under eye
    if any(k in z for k in ["nasolabial", "perioral", "boca", "labial"]):
        return 0.10
    if any(k in z for k in ["nariz", "zona t", "nose"]):
        return 0.12
    if any(k in z for k in ["bochecha", "maca", "malar", "cheek"]):
        return 0.15
    if any(k in z for k in ["testa", "frontal", "glabela"]):
        return 0.15
    if any(k in z for k in ["temporal", "mandibula", "queixo", "jowl", "papada"]):
        return 0.18
    return 0.13  # default


def _build_zone_fallback(zone: str) -> str:
    """Query de fallback mínima baseada na zona, quando todas as queries falharem."""
    z = zone.lower()
    if any(k in z for k in ["periorbital", "orbital", "olheira"]):
        return "dark area under eye"
    if any(k in z for k in ["nasolabial"]):
        return "fold from nose to mouth corner"
    if any(k in z for k in ["boca", "perioral", "labial"]):
        return "area around mouth and lips"
    if any(k in z for k in ["testa", "frontal"]):
        return "forehead area"
    if any(k in z for k in ["glabela"]):
        return "between eyebrows"
    if any(k in z for k in ["nariz", "zona t"]):
        return "nose area"
    if any(k in z for k in ["bochecha", "maca", "malar"]):
        return "cheek area"
    if any(k in z for k in ["temporal"]):
        return "temple area beside eye"
    if any(k in z for k in ["mandibula", "queixo"]):
        return "jaw and chin area"
    return zone.lower().replace("regiao ", "").replace("zona ", "").strip()

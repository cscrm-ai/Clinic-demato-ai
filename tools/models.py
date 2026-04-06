"""Schemas Pydantic para o laudo dermatologico da Dra. Sync — versao clinica estetica."""

from typing import Literal

from pydantic import BaseModel, Field


class ProcedimentoIndicado(BaseModel):
    """Procedimento estetico indicado para um achado."""

    nome: str = Field(
        ...,
        description="Nome do procedimento (ex: 'Toxina Botulinica', 'Preenchedor com Acido Hialuronico')",
    )
    tipo: Literal["TECNOLOGIA", "PEELING", "INJETAVEL", "TOPICO", "LASER", "OUTROS"] = Field(
        ...,
        description="Categoria do procedimento",
    )
    descricao_breve: str = Field(
        ...,
        description="Explicacao breve e acessivel do procedimento para o paciente",
    )
    sessoes_estimadas: str = Field(
        ...,
        description="Estimativa de sessoes necessarias (ex: '1 sessao', '3 a 6 sessoes mensais', 'reaplicacao a cada 4-6 meses')",
    )
    horizonte: Literal["CURTO_PRAZO", "MEDIO_PRAZO", "LONGO_PRAZO"] = Field(
        ...,
        description="Horizonte terapeutico: CURTO_PRAZO (0-30d), MEDIO_PRAZO (1-3m), LONGO_PRAZO (3-12m)",
    )


class DermatologicalFinding(BaseModel):
    """Achado clinico individual identificado na imagem."""

    description: str = Field(
        ...,
        description="Descricao clinica do achado (ex: 'melasma malar bilateral')",
    )
    zone: str = Field(
        ...,
        description="Zona facial afetada (ex: 'Macas do rosto', 'Zona T', 'Regiao periorbital')",
    )
    priority: Literal["PRIORITARIO", "RECOMENDADO", "OPCIONAL"] = Field(
        ...,
        description="Nivel de prioridade clinica do achado",
    )
    conduta: str = Field(
        ...,
        description="Abordagem terapeutica sugerida em linguagem acessivel",
    )
    procedimentos_indicados: list[ProcedimentoIndicado] = Field(
        default_factory=list,
        description="Lista de procedimentos esteticos indicados para este achado",
    )
    clinical_note: str = Field(
        ...,
        description="Observacao clinica (contraindicacoes, cuidados, fototipo)",
    )
    queries: list[str] = Field(
        default_factory=list,
        description="Lista de 3 queries em ingles para localizar o achado via Moondream3 (primary + 2 variants)",
    )
    x_hint: float = Field(
        default=0.5,
        description="Sua estimativa visual da posicao horizontal do achado (0.0=borda esquerda, 0.5=centro, 1.0=borda direita)",
    )
    y_hint: float = Field(
        default=0.5,
        description="Sua estimativa visual da posicao vertical do achado (0.0=topo, 0.5=meio do rosto, 1.0=fundo)",
    )
    x_point: float = Field(
        default=0,
        description="Coordenada X do achado na imagem (0-1 normalizado)",
    )
    y_point: float = Field(
        default=0,
        description="Coordenada Y do achado na imagem (0-1 normalizado)",
    )


class PlanoTerapeutico(BaseModel):
    """Plano terapeutico estruturado em 3 horizontes."""

    curto_prazo: str = Field(
        ...,
        description="Quick wins (0-30 dias): procedimentos com resultado imediato",
    )
    medio_prazo: str = Field(
        ...,
        description="Tratamento base (1-3 meses): tecnologias de remodelacao",
    )
    longo_prazo: str = Field(
        ...,
        description="Manutencao e prevencao (3-12 meses): sessoes de manutencao",
    )


class SkinAnalysisReport(BaseModel):
    """Relatorio completo de analise dermatologica para clinica estetica."""

    skin_score: int = Field(
        ...,
        description="Pontuacao geral de saude da pele de 0 a 100 (100 = pele perfeita sem achados, 0 = pele com multiplos achados graves). Desconte pontos proporcionalmente: achado PRIORITARIO -15pts, RECOMENDADO -8pts, OPCIONAL -3pts.",
    )
    fitzpatrick_type: Literal["I", "II", "III", "IV", "V", "VI"] = Field(
        ...,
        description="Fototipo identificado na escala de Fitzpatrick",
    )
    skin_type: str = Field(
        ...,
        description="Tipo de pele (ex: 'Oleosa, sensivel, fotoenvelhecimento misto')",
    )
    findings: list[DermatologicalFinding] = Field(
        default_factory=list,
        description="Lista de achados clinicos identificados (5-10)",
    )
    plano_terapeutico: PlanoTerapeutico = Field(
        ...,
        description="Plano terapeutico personalizado em 3 horizontes",
    )
    am_routine: str = Field(
        ...,
        description="Rotina de skin care sugerida para manha (AM)",
    )
    pm_routine: str = Field(
        ...,
        description="Rotina de skin care sugerida para noite (PM)",
    )
    general_observations: str = Field(
        ...,
        description="Observacoes gerais e avisos eticos",
    )

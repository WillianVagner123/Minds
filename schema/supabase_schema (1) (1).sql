-- ===========================================================
-- 🎯 MINDS PERFORMANCE – SCHEMA COMPLETO EM UM ARQUIVO
-- ===========================================================
-- Inclui:
-- - Cadastro do atleta + peso ideal
-- - BRUMS + peso + pré/pós treino + modalidade + duração
-- - ACSI-28BR
-- - GSES-12
-- - PMCSQ-2
-- - RESTQ-Sport
-- - CBAS/LSS (treinador)
-- - Weekly Analysis (modelo qualitativo semanal)
-- - Training Load (carga de treino semanal)
-- - Views com z-scores e red flags
-- - Peso ideal vs peso atual (diferença percentual)
-- ===========================================================


-- ===========================================================
-- 1) CADASTRO DO ATLETA
-- ===========================================================
create table if not exists athlete_registration (
  id bigserial primary key,
  athlete_id text not null,
  data date default now(),
  payload jsonb,
  ideal_weight_kg numeric,
  inserted_at timestamp with time zone default now()
);



-- ===========================================================
-- 2) BRUMS + CHECK-IN DIÁRIO
-- ===========================================================
create table if not exists brums_analysis (
  id bigserial primary key,
  athlete_id text not null,
  data date,

  -- HUMOR
  dth numeric,
  vigor numeric,
  dth_minus numeric,
  carga numeric,

  -- NOVOS CAMPOS DIÁRIOS
  weight_kg numeric,
  pre_post_moment text,
  training_modality text,
  training_time numeric,

  inserted_at timestamp with time zone default now()
);


-- -------------------
-- VIEW BRUMS COMPLETA
-- -------------------
create or replace view brums_analysis_view as
select
  b.*,

  -- Z-scores
  (b.dth         - avg(b.dth)         over()) / nullif(stddev_samp(b.dth)         over(), 0) as dth_z,
  (b.vigor       - avg(b.vigor)       over()) / nullif(stddev_samp(b.vigor)       over(), 0) as vigor_z,
  (b.dth_minus   - avg(b.dth_minus)   over()) / nullif(stddev_samp(b.dth_minus)   over(), 0) as dth_minus_z,
  (b.weight_kg   - avg(b.weight_kg)   over()) / nullif(stddev_samp(b.weight_kg)   over(), 0) as weight_z,
  (b.training_time - avg(b.training_time) over()) / nullif(stddev_samp(b.training_time) over(), 0) as training_time_z,

  -- Peso ideal (último registro do atleta)
  ar.ideal_weight_kg,

  -- Diferença percentual de peso
  case
    when ar.ideal_weight_kg is null or b.weight_kg is null then null
    else (b.weight_kg - ar.ideal_weight_kg) / nullif(ar.ideal_weight_kg, 0)
  end as weight_diff_pct,

  -- Red Flag de peso (variação > 5%)
  case
    when ar.ideal_weight_kg is not null
     and b.weight_kg is not null
     and abs((b.weight_kg - ar.ideal_weight_kg) / ar.ideal_weight_kg) > 0.05
    then true else false
  end as weight_red_flag,

  -- Red Flag de humor
  case
    when (b.dth - avg(b.dth) over()) / nullif(stddev_samp(b.dth) over(), 0) > 1
     and (b.dth_minus - avg(b.dth_minus) over()) / nullif(stddev_samp(b.dth_minus) over(), 0) > 1
    then true else false
  end as mood_red_flag

from brums_analysis b
left join (
  select distinct on (athlete_id)
    athlete_id,
    ideal_weight_kg,
    inserted_at
  from athlete_registration
  order by athlete_id, inserted_at desc
) ar on ar.athlete_id = b.athlete_id;



-- ===========================================================
-- 3) ACSI-28BR
-- ===========================================================
create table if not exists acsi_analysis (
  id bigserial primary key,
  athlete_id text not null,
  data date,
  media numeric,
  metas_preparacao numeric,
  relacao_treinador numeric,
  concentracao numeric,
  confianca_motivacao numeric,
  pico_pressao numeric,
  adversidade numeric,
  ausencia_preocupacao numeric,
  inserted_at timestamp with time zone default now()
);

create or replace view acsi_analysis_view as
select
  *,
  (media - avg(media) over()) / nullif(stddev_samp(media) over(), 0) as media_z,
  (metas_preparacao - avg(metas_preparacao) over()) / nullif(stddev_samp(metas_preparacao) over(), 0) as metas_preparacao_z,
  (relacao_treinador - avg(relacao_treinador) over()) / nullif(stddev_samp(relacao_treinador) over(), 0) as relacao_treinador_z,
  (concentracao - avg(concentracao) over()) / nullif(stddev_samp(concentracao) over(), 0) as concentracao_z,
  (confianca_motivacao - avg(confianca_motivacao) over()) / nullif(stddev_samp(confianca_motivacao) over(), 0) as confianca_motivacao_z,
  (pico_pressao - avg(pico_pressao) over()) / nullif(stddev_samp(pico_pressao) over(), 0) as pico_pressao_z,
  (adversidade - avg(adversidade) over()) / nullif(stddev_samp(adversidade) over(), 0) as adversidade_z,
  (ausencia_preocupacao - avg(ausencia_preocupacao) over()) / nullif(stddev_samp(ausencia_preocupacao) over(), 0) as ausencia_preocupacao_z
from acsi_analysis;



-- ===========================================================
-- 4) GSES-12
-- ===========================================================
create table if not exists gses_analysis (
  id bigserial primary key,
  athlete_id text not null,
  data date,
  media numeric,
  autorregulacao numeric,
  inserted_at timestamp with time zone default now()
);

create or replace view gses_analysis_view as
select
  *,
  (media - avg(media) over()) / nullif(stddev_samp(media) over(), 0) as media_z
from gses_analysis;



-- ===========================================================
-- 5) PMCSQ-2
-- ===========================================================
create table if not exists pmcsq_analysis (
  id bigserial primary key,
  athlete_id text not null,
  data date,
  clima_tarefa numeric,
  clima_ego numeric,
  coletivo numeric,
  clima_treino_desafiador numeric,
  clima_ego_preferido numeric,
  punicao_erros numeric,
  inserted_at timestamp with time zone default now()
);

create or replace view pmcsq_analysis_view as
select
  *,
  (clima_tarefa - avg(clima_tarefa) over()) / nullif(stddev_samp(clima_tarefa) over(), 0) as clima_tarefa_z,
  (clima_ego - avg(clima_ego) over()) / nullif(stddev_samp(clima_ego) over(), 0) as clima_ego_z,
  (coletivo - avg(coletivo) over()) / nullif(stddev_samp(coletivo) over(), 0) as coletivo_z,
  (clima_treino_desafiador - avg(clima_treino_desafiador) over()) / nullif(stddev_samp(clima_treino_desafiador) over(), 0) as clima_treino_desafiador_z,
  (clima_ego_preferido - avg(clima_ego_preferido) over()) / nullif(stddev_samp(clima_ego_preferido) over(), 0) as clima_ego_preferido_z,
  (punicao_erros - avg(punicao_erros) over()) / nullif(stddev_samp(punicao_erros) over(), 0) as punicao_erros_z
from pmcsq_analysis;



-- ===========================================================
-- 6) RESTQ-SPORT
-- ===========================================================
create table if not exists restq_analysis (
  id bigserial primary key,
  athlete_id text not null,
  data date,
  media numeric,
  sono_bemestar numeric,
  problemas_treino numeric,
  inserted_at timestamp with time zone default now()
);

create or replace view restq_analysis_view as
select
  *,
  (media - avg(media) over()) / nullif(stddev_samp(media) over(), 0) as media_z,
  (sono_bemestar - avg(sono_bemestar) over()) / nullif(stddev_samp(sono_bemestar) over(), 0) as sono_bemestar_z,
  (problemas_treino - avg(problemas_treino) over()) / nullif(stddev_samp(problemas_treino) over(), 0) as problemas_treino_z
from restq_analysis;



-- ===========================================================
-- 7) CBAS / LSS – AVALIAÇÃO DO TREINADOR
-- ===========================================================
create table if not exists cbas_analysis (
  id bigserial primary key,
  athlete_id text not null,
  data date,
  tecnica numeric,
  planejamento numeric,
  motivacional numeric,
  relacao numeric,
  aversivos numeric,
  tecnica_chave numeric,
  planejamento_chave numeric,
  motivacional_chave numeric,
  relacao_chave numeric,
  aversivos_chave numeric,
  inserted_at timestamp with time zone default now()
);

create or replace view cbas_analysis_view as
select
  *,
  (tecnica - avg(tecnica) over()) / nullif(stddev_samp(tecnica) over(), 0) as tecnica_z,
  (planejamento - avg(planejamento) over()) / nullif(stddev_samp(planejamento) over(), 0) as planejamento_z,
  (motivacional - avg(motivacional) over()) / nullif(stddev_samp(motivacional) over(), 0) as motivacional_z,
  (relacao - avg(relacao) over()) / nullif(stddev_samp(relacao) over(), 0) as relacao_z,
  (aversivos - avg(aversivos) over()) / nullif(stddev_samp(aversivos) over(), 0) as aversivos_z
from cbas_analysis;



-- ===========================================================
-- 8) ANÁLISE SEMANAL (NOVO MODELO)
-- ===========================================================
create table if not exists weekly_analysis (
  id bigserial primary key,
  athlete_id text not null,
  start_date date,
  desempenho numeric,
  adesao_nutricional numeric,
  dieta_comentarios text,
  cansaco_acao text,
  semana_comentarios text,
  eventos text,
  inserted_at timestamp with time zone default now()
);

create or replace view weekly_analysis_view as
select
  *,
  (desempenho - avg(desempenho) over()) / nullif(stddev_samp(desempenho) over(), 0) as desempenho_z,
  (adesao_nutricional - avg(adesao_nutricional) over()) / nullif(stddev_samp(adesao_nutricional) over(), 0) as adesao_z
from weekly_analysis;



-- ===========================================================
-- 9) CARGA DE TREINO
-- ===========================================================
create table if not exists training_load_analysis (
  id bigserial primary key,
  athlete_id text not null,
  week_start date,
  weekly_load numeric,
  monotonia numeric,
  strain numeric,
  readiness numeric,
  acwr numeric,
  inserted_at timestamp with time zone default now()
);

create or replace view training_load_analysis_view as
select
  *,
  (weekly_load - avg(weekly_load) over()) / nullif(stddev_samp(weekly_load) over(), 0) as weekly_load_z,
  (monotonia - avg(monotonia) over()) / nullif(stddev_samp(monotonia) over(), 0) as monotonia_z,
  (strain - avg(strain) over()) / nullif(stddev_samp(strain) over(), 0) as strain_z,
  (readiness - avg(readiness) over()) / nullif(stddev_samp(readiness) over(), 0) as readiness_z,
  (acwr - avg(acwr) over()) / nullif(stddev_samp(acwr) over(), 0) as acwr_z
from training_load_analysis;

-- ===========================================================
-- 10) ANALYTICS VECTORS (ARMAZENAMENTO COMPACTADO)
-- ===========================================================
-- Para suportar armazenamento de dados compactados (por exemplo, embeddings
-- de modelos de linguagem ou representações vetoriais de relatórios), é
-- recomendável habilitar a extensão pgvector no Supabase.  Essa extensão
-- permite armazenar vetores de dimensões fixas com operações de distância
-- vetorial.  Caso pgvector não esteja disponível, é possível armazenar
-- vetores em colunas jsonb como listas de números.

-- Habilite a extensão pgvector se ainda não existir
create extension if not exists vector;

-- Tabela para armazenar vetores de análise.  Cada registro representa um
-- vetor (embedding) associado a um atleta em uma data específica e a
-- origem (instrumento ou tipo de relatório).  A coluna `embedding` usa
-- `vector(256)` como exemplo; ajuste conforme a dimensão do seu modelo.
create table if not exists analysis_vectors (
  id bigserial primary key,
  athlete_id text not null,
  data date not null,
  source text not null,
  embedding vector(256),
  metadata jsonb,
  inserted_at timestamp with time zone default now()
);
-- Índice para busca vetorial (ajustar lists conforme necessidade)
create index if not exists analysis_vectors_embedding_idx
on analysis_vectors
using ivfflat (embedding) with (lists = 100);

-- ===========================================================
-- 🎯 MINDS PERFORMANCE – SQL 01 (SOMENTE TABELAS) – ATUALIZADO
-- ===========================================================
-- Inclui:
-- - Tabelas por instrumento
-- - Nutrição diária
-- - RESTQ Treinador
-- - Construcional + ABC (texto livre)
-- - pgvector + embeddings
-- ===========================================================

-- 0) EXTENSÕES
create extension if not exists vector;

-- ===========================================================
-- 1) CADASTRO DO ATLETA (RAW)
-- ===========================================================
create table if not exists athlete_registration (
  id bigserial primary key,
  athlete_id text not null,
  data date default now(),
  payload jsonb,
  ideal_weight_kg numeric,
  inserted_at timestamptz default now()
);

create index if not exists athlete_registration_athlete_id_idx
  on athlete_registration (athlete_id);

create index if not exists athlete_registration_inserted_at_idx
  on athlete_registration (inserted_at);

-- ===========================================================
-- 2) BRUMS + CHECK-IN DIÁRIO (HUMOR + TREINO + PESO)
-- ===========================================================
create table if not exists brums_analysis (
  id bigserial primary key,
  athlete_id text not null,
  data date,

  dth numeric,
  vigor numeric,
  dth_minus numeric,
  carga numeric,

  weight_kg numeric,
  pre_post_moment text,
  training_modality text,
  training_time numeric,

  inserted_at timestamptz default now()
);

create index if not exists brums_analysis_athlete_id_idx
  on brums_analysis (athlete_id);

create index if not exists brums_analysis_data_idx
  on brums_analysis (data);

-- ===========================================================
-- 2B) NUTRIÇÃO DIÁRIA (NOVO)
-- ===========================================================
create table if not exists nutrition_daily (
  id bigserial primary key,
  athlete_id text not null,
  data date not null,

  -- 1..5
  plan_adherence numeric,

  -- enum textual (pra não quebrar ingestão)
  missed_meals text,        -- "Não" | "Sim, 1 refeição" | "Sim, 2 ou mais"
  low_energy_risk boolean,  -- "comeu menos do que precisava" (percepção)
  gi_discomfort numeric,    -- 0..10

  inserted_at timestamptz default now()
);

create index if not exists nutrition_daily_athlete_id_idx
  on nutrition_daily (athlete_id);

create index if not exists nutrition_daily_data_idx
  on nutrition_daily (data);

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
  inserted_at timestamptz default now()
);

create index if not exists acsi_analysis_athlete_id_idx
  on acsi_analysis (athlete_id);

create index if not exists acsi_analysis_data_idx
  on acsi_analysis (data);

-- ===========================================================
-- 4) GSES-12
-- ===========================================================
create table if not exists gses_analysis (
  id bigserial primary key,
  athlete_id text not null,
  data date,
  media numeric,
  autorregulacao numeric,
  inserted_at timestamptz default now()
);

create index if not exists gses_analysis_athlete_id_idx
  on gses_analysis (athlete_id);

create index if not exists gses_analysis_data_idx
  on gses_analysis (data);

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
  inserted_at timestamptz default now()
);

create index if not exists pmcsq_analysis_athlete_id_idx
  on pmcsq_analysis (athlete_id);

create index if not exists pmcsq_analysis_data_idx
  on pmcsq_analysis (data);

-- ===========================================================
-- 6) RESTQ-SPORT (ATLETA)
-- ===========================================================
create table if not exists restq_analysis (
  id bigserial primary key,
  athlete_id text not null,
  data date,
  media numeric,
  sono_bemestar numeric,
  problemas_treino numeric,
  inserted_at timestamptz default now()
);

create index if not exists restq_analysis_athlete_id_idx
  on restq_analysis (athlete_id);

create index if not exists restq_analysis_data_idx
  on restq_analysis (data);

-- ===========================================================
-- 6B) RESTQ-SPORT (TREINADOR) (NOVO)
-- ===========================================================
create table if not exists restq_trainer_analysis (
  id bigserial primary key,
  coach_id text not null,
  coach_name text,
  data date not null,

  media numeric,
  stress numeric,
  recovery numeric,

  inserted_at timestamptz default now()
);

create index if not exists restq_trainer_analysis_coach_id_idx
  on restq_trainer_analysis (coach_id);

create index if not exists restq_trainer_analysis_data_idx
  on restq_trainer_analysis (data);

-- ===========================================================
-- 7) CBAS / LSS – AVALIAÇÃO DO TREINADOR (FEITA PELO ATLETA)
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

  inserted_at timestamptz default now()
);

create index if not exists cbas_analysis_athlete_id_idx
  on cbas_analysis (athlete_id);

create index if not exists cbas_analysis_data_idx
  on cbas_analysis (data);

-- ===========================================================
-- 8) ANÁLISE SEMANAL (QUALITATIVO)
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

  inserted_at timestamptz default now()
);

create index if not exists weekly_analysis_athlete_id_idx
  on weekly_analysis (athlete_id);

create index if not exists weekly_analysis_start_date_idx
  on weekly_analysis (start_date);

-- ===========================================================
-- 9) CARGA DE TREINO (SEMANAL)
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

  inserted_at timestamptz default now()
);

create index if not exists training_load_analysis_athlete_id_idx
  on training_load_analysis (athlete_id);

create index if not exists training_load_analysis_week_start_idx
  on training_load_analysis (week_start);

-- ===========================================================
-- 10) CONSTRUCIONAL + ABC (TEXTO LIVRE) (NOVO)
-- ===========================================================
create table if not exists behavioral_intake (
  id bigserial primary key,
  athlete_id text not null,
  data date default now(),

  -- ABC / análise do comportamento
  problem_behaviors text,
  antecedents_a text,
  consequences_c text,
  behavior_function text,
  learning_history text,
  existing_repertoires text,

  -- Construcional (4 blocos)
  constr_b1_helpful text,
  constr_b1_hinders text,
  constr_b1_confident text,
  constr_b1_insecure text,

  constr_b2_when_good text,
  constr_b2_when_bad text,
  constr_b2_motivation text,
  constr_b2_negative_weight text,

  constr_b3_change text,
  constr_b3_learn_from_others text,
  constr_b3_skills_to_improve text,
  constr_b3_handle_errors text,

  constr_b4_environment_support text,
  constr_b4_missing_support text,
  constr_b4_dream_training text,
  constr_b4_small_changes_now text,

  inserted_at timestamptz default now()
);

create index if not exists behavioral_intake_athlete_id_idx
  on behavioral_intake (athlete_id);

create index if not exists behavioral_intake_inserted_at_idx
  on behavioral_intake (inserted_at);

-- ===========================================================
-- 11) ANALYTICS VECTORS (EMBEDDINGS)
-- ===========================================================
create table if not exists analysis_vectors (
  id bigserial primary key,
  athlete_id text not null,
  data date not null,
  source text not null,
  embedding vector(256),
  metadata jsonb,
  inserted_at timestamptz default now()
);

create index if not exists analysis_vectors_athlete_id_idx
  on analysis_vectors (athlete_id);

create index if not exists analysis_vectors_data_idx
  on analysis_vectors (data);

create index if not exists analysis_vectors_embedding_idx
  on analysis_vectors using ivfflat (embedding) with (lists = 100);

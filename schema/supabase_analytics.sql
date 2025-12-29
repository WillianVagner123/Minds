-- ===========================================================
-- 📊 MINDS PERFORMANCE – ANALYTICS (EXTENDED)
--
-- Este script define views e funções analíticas para os dados
-- armazenados nas tabelas de análise criadas no DDL estendido.
-- As views calculam z‑scores intra‑individuais, categorizam
-- indicadores de dieta, consolidam inputs para o motor de scoring
-- e expõem RPCs para inserção de classificações construcionais
-- e do score final. Baseado no modelo original, mas adaptado para
-- funcionar com as tabelas desta versão.
-- ===========================================================

-- =========================
-- 0) HELPERS (opcional)
-- =========================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ===========================================================
-- 1) VIEWS INTRA‑INDIVIDUAIS (z‑score por atleta)
-- ===========================================================

-- -------------------------
-- BRUMS VIEW (com peso ideal e flags simples)
-- -------------------------
create or replace view public.brums_analysis_view as
with latest_ideal as (
  select distinct on (athlete_id)
    athlete_id,
    ideal_weight_kg
  from athlete_registration
  order by athlete_id, inserted_at desc
)
select
  b.*,  -- todas as colunas da tabela brums_analysis

  -- z‑scores intra‑individuais
  (b.dth - avg(b.dth) over (partition by b.athlete_id))
    / nullif(stddev_samp(b.dth) over (partition by b.athlete_id), 0) as dth_z,

  (b.vigor - avg(b.vigor) over (partition by b.athlete_id))
    / nullif(stddev_samp(b.vigor) over (partition by b.athlete_id), 0) as vigor_z,

  (b.dth_minus - avg(b.dth_minus) over (partition by b.athlete_id))
    / nullif(stddev_samp(b.dth_minus) over (partition by b.athlete_id), 0) as dth_minus_z,

  (b.weight_kg - avg(b.weight_kg) over (partition by b.athlete_id))
    / nullif(stddev_samp(b.weight_kg) over (partition by b.athlete_id), 0) as weight_z,

  (b.training_time - avg(b.training_time) over (partition by b.athlete_id))
    / nullif(stddev_samp(b.training_time) over (partition by b.athlete_id), 0) as training_time_z,

  li.ideal_weight_kg,

  case
    when li.ideal_weight_kg is null or b.weight_kg is null then null
    else (b.weight_kg - li.ideal_weight_kg) / nullif(li.ideal_weight_kg, 0)
  end as weight_diff_pct,

  -- flags simples de peso
  case
    when li.ideal_weight_kg is not null
     and b.weight_kg is not null
     and abs((b.weight_kg - li.ideal_weight_kg) / li.ideal_weight_kg) > 0.05
    then true else false
  end as weight_red_flag,

  -- flag de humor: dth_z > 1 e dth_minus_z > 1
  case
    when (
      (b.dth - avg(b.dth) over (partition by b.athlete_id))
      / nullif(stddev_samp(b.dth) over (partition by b.athlete_id), 0)
    ) > 1
     and (
      (b.dth_minus - avg(b.dth_minus) over (partition by b.athlete_id))
      / nullif(stddev_samp(b.dth_minus) over (partition by b.athlete_id), 0)
    ) > 1
    then true else false
  end as mood_red_flag

from brums_analysis b
left join latest_ideal li on li.athlete_id = b.athlete_id;

-- -------------------------
-- DIETA VIEW
-- -------------------------
create or replace view public.diet_daily_view as
select
  d.*,

  -- adherence_level conforme scoring/diet_adherence_rules.json
  case
    when d.adherence_score is null then null
    when d.adherence_score >= 80 then 'high'
    when d.adherence_score >= 60 then 'medium'
    else 'low'
  end as adherence_level,

  -- missed_meals_n normalizado
  case
    when d.missed_meals is null then null
    when d.missed_meals ilike '%2%' then 2
    when d.missed_meals ilike '%1%' then 1
    when d.missed_meals ilike 'não' or d.missed_meals ilike 'nao' then 0
    else null
  end as missed_meals_n,

  -- GI em faixa (low/moderate/high) conforme rules
  case
    when d.gi_distress is null then null
    when d.gi_distress >= 7 then 'high'
    when d.gi_distress >= 4 then 'moderate'
    else 'low'
  end as gi_distress_level

from diet_daily d;


-- -------------------------
-- ESCALAS: ACSI / GSES / PMCSQ / RESTQ / CBAS / WEEKLY / LOAD
-- -------------------------
-- Para cada escala, calculamos z‑scores da média (ou subescala
-- principal) por atleta. As tabelas já guardam os valores
-- agregados, então basta normalizar.

create or replace view public.acsi_analysis_view as
select
  a.*,
  (a.media - avg(a.media) over (partition by a.athlete_id))
    / nullif(stddev_samp(a.media) over (partition by a.athlete_id), 0) as media_z
from acsi_analysis a;

create or replace view public.gses_analysis_view as
select
  g.*,
  (g.media - avg(g.media) over (partition by g.athlete_id))
    / nullif(stddev_samp(g.media) over (partition by g.athlete_id), 0) as media_z
from gses_analysis g;

create or replace view public.pmcsq_analysis_view as
select
  p.*,
  (p.clima_tarefa - avg(p.clima_tarefa) over (partition by p.athlete_id))
    / nullif(stddev_samp(p.clima_tarefa) over (partition by p.athlete_id), 0) as clima_tarefa_z,
  (p.clima_ego - avg(p.clima_ego) over (partition by p.athlete_id))
    / nullif(stddev_samp(p.clima_ego) over (partition by p.athlete_id), 0) as clima_ego_z
from pmcsq_analysis p;

create or replace view public.restq_analysis_view as
select
  r.*,
  (r.media - avg(r.media) over (partition by r.athlete_id))
    / nullif(stddev_samp(r.media) over (partition by r.athlete_id), 0) as media_z
from restq_analysis r;

create or replace view public.cbas_analysis_view as
select
  c.*,
  (c.aversivos - avg(c.aversivos) over (partition by c.athlete_id))
    / nullif(stddev_samp(c.aversivos) over (partition by c.athlete_id), 0) as aversivos_z
from cbas_analysis c;

create or replace view public.weekly_analysis_view as
select
  w.*,
  (w.desempenho - avg(w.desempenho) over (partition by w.athlete_id))
    / nullif(stddev_samp(w.desempenho) over (partition by w.athlete_id), 0) as desempenho_z,
  (w.adesao_nutricional - avg(w.adesao_nutricional) over (partition by w.athlete_id))
    / nullif(stddev_samp(w.adesao_nutricional) over (partition by w.athlete_id), 0) as adesao_z
from weekly_analysis w;

create or replace view public.training_load_analysis_view as
select
  t.*,
  (t.weekly_load - avg(t.weekly_load) over (partition by t.athlete_id))
    / nullif(stddev_samp(t.weekly_load) over (partition by t.athlete_id), 0) as weekly_load_z,
  (t.monotonia - avg(t.monotonia) over (partition by t.athlete_id))
    / nullif(stddev_samp(t.monotonia) over (partition by t.athlete_id), 0) as monotonia_z,
  (t.strain - avg(t.strain) over (partition by t.athlete_id))
    / nullif(stddev_samp(t.strain) over (partition by t.athlete_id), 0) as strain_z,
  (t.readiness - avg(t.readiness) over (partition by t.athlete_id))
    / nullif(stddev_samp(t.readiness) over (partition by t.athlete_id), 0) as readiness_z,
  (t.acwr - avg(t.acwr) over (partition by t.athlete_id))
    / nullif(stddev_samp(t.acwr) over (partition by t.athlete_id), 0) as acwr_z
from training_load_analysis t;

-- -------------------------
-- CONSTRUCIONAL VIEW
-- -------------------------
-- Não necessita z‑score, porém expõe a última classificação
-- para consolidação.

create or replace view public.construcional_analysis_view as
select
  c.*
from construcional_analysis c;

-- ===========================================================
-- 2) INPUTS CONSOLIDADOS PARA O MOTOR DE SCORING
--
-- Esta view reúne o último BRUMS (z‑scores), a última dieta
-- diária, e a última classificação construcional para cada atleta.
-- É usada pelo n8n no webhook RunScoring.
-- ===========================================================
create or replace view public.pingo_scoring_inputs_view as
with
-- =========================
-- BRUMS: último + histórico 7 dias (para padrão/instabilidade)
-- =========================
brums_last as (
  select distinct on (athlete_id)
    athlete_id,
    data as reference_date,
    vigor_z,
    dth_z
  from public.brums_analysis_view
  order by athlete_id, data desc, inserted_at desc
),
brums_hist as (
  select
    athlete_id,
    data,
    vigor_z,
    dth_z
  from public.brums_analysis_view
  where data >= current_date - interval '7 days'
),
brums_feats as (
  select
    bl.athlete_id,
    bl.reference_date,
    bl.vigor_z,
    bl.dth_z,

    -- estados conforme brums_rules.json
    case
      when bl.vigor_z >= 1 then 'high'
      when bl.vigor_z <= -1 then 'low'
      else 'medium'
    end as vigor,

    case
      when bl.dth_z <= 0.5 then 'low'
      when bl.dth_z <= 1.5 then 'medium'
      else 'high'
    end as dth,

    -- padrão (contagem nos últimos 7d)
    (select count(*) from brums_hist h
      where h.athlete_id = bl.athlete_id
        and (case when h.dth_z <= 0.5 then 'low'
                  when h.dth_z <= 1.5 then 'medium'
                  else 'high' end) = 'high'
    ) as dth_high_days,

    (select count(*) from brums_hist h
      where h.athlete_id = bl.athlete_id
        and (case when h.vigor_z >= 1 then 'high'
                  when h.vigor_z <= -1 then 'low'
                  else 'medium' end) = 'low'
    ) as vigor_low_days,

    -- instabilidade (volatilidade 7d)
    (select stddev_samp(h.dth_z) from brums_hist h where h.athlete_id = bl.athlete_id) as dth_volatility_7d,
    (select stddev_samp(h.vigor_z) from brums_hist h where h.athlete_id = bl.athlete_id) as vigor_volatility_7d,

    -- deltas 1d (comparado com o dia anterior do próprio atleta)
    (bl.vigor_z - (
      select h.vigor_z
      from public.brums_analysis_view h
      where h.athlete_id = bl.athlete_id and h.data < bl.reference_date
      order by h.data desc, h.inserted_at desc
      limit 1
    )) as vigor_delta_1d,

    (bl.dth_z - (
      select h.dth_z
      from public.brums_analysis_view h
      where h.athlete_id = bl.athlete_id and h.data < bl.reference_date
      order by h.data desc, h.inserted_at desc
      limit 1
    )) as dth_delta_1d

  from brums_last bl
),

-- =========================
-- DIETA: último + “low days” 7d
-- =========================
diet_last as (
  select distinct on (athlete_id)
    athlete_id,
    data as reference_date,
    adherence_score,
    adherence_level,
    energy_availability_risk,
    missed_meals_n as missed_meals,
    gi_distress_level
  from public.diet_daily_view
  order by athlete_id, data desc, inserted_at desc
),
diet_feats as (
  select
    dl.*,
    (select count(*) from public.diet_daily_view d
      where d.athlete_id = dl.athlete_id
        and d.data >= current_date - interval '7 days'
        and d.adherence_level = 'low'
    ) as adherence_low_days
  from diet_last dl
),

-- =========================
-- CONSTRUCIONAL: último (já categorizado low/medium/high)
-- =========================
constr_last as (
  select distinct on (athlete_id)
    athlete_id,
    repertorio_protetor,
    repertorio_risco,
    apoio_ambiental,
    claridade_metas,
    analyzed_at as construcional_analyzed_at
  from public.construcional_analysis
  order by athlete_id, analyzed_at desc
),

-- =========================
-- ESCALAS para correlação (último registro)
-- =========================
acsi_last as (
  select distinct on (athlete_id)
    athlete_id,
    adversidade,          -- coping_with_adversity
    pico_pressao          -- peaking_under_pressure
  from public.acsi_analysis
  order by athlete_id, data desc, inserted_at desc
),
gses_last as (
  select distinct on (athlete_id)
    athlete_id,
    media as gses_media,
    (media - avg(media) over (partition by athlete_id))
      / nullif(stddev_samp(media) over (partition by athlete_id), 0) as gses_media_z
  from public.gses_analysis
  order by athlete_id, data desc, inserted_at desc
),
restq_last as (
  select distinct on (athlete_id)
    athlete_id,
    media as restq_media,
    (media - avg(media) over (partition by athlete_id))
      / nullif(stddev_samp(media) over (partition by athlete_id), 0) as restq_media_z
  from public.restq_analysis
  order by athlete_id, data desc, inserted_at desc
),
pmcsq_last as (
  select distinct on (athlete_id)
    athlete_id,
    clima_ego,
    (clima_ego - avg(clima_ego) over (partition by athlete_id))
      / nullif(stddev_samp(clima_ego) over (partition by athlete_id), 0) as clima_ego_z
  from public.pmcsq_analysis
  order by athlete_id, data desc, inserted_at desc
)

select
  b.athlete_id,
  b.reference_date,

  -- BRUMS (z + estados + padrões)
  b.vigor_z,
  b.dth_z,
  b.vigor,
  b.dth,
  b.dth_high_days,
  b.vigor_low_days,
  b.dth_volatility_7d,
  b.vigor_volatility_7d,
  b.vigor_delta_1d,
  b.dth_delta_1d,

  -- DIETA (já no formato esperado pelas rules)
  d.adherence_score,
  d.adherence_level,
  d.adherence_low_days,
  d.energy_availability_risk,
  d.missed_meals,
  d.gi_distress_level as gi_distress,

  -- CONSTRUCIONAL
  c.repertorio_protetor,
  c.repertorio_risco,
  c.apoio_ambiental,
  c.claridade_metas,
  c.construcional_analyzed_at,

  -- CAMPOS para X1/X2/X3/X4...
  a.adversidade as coping_with_adversity,
  a.pico_pressao as peaking_under_pressure,

  -- estados derivados para correlação
  case when g.gses_media_z <= -1 then 'low'
       when g.gses_media_z >= 1 then 'high'
       else 'medium' end as gses_total,

  case when r.restq_media_z <= -1 then 'low'
       when r.restq_media_z >= 1 then 'high'
       else 'medium' end as restq_state,

  (p.clima_ego_z >= 1) as ego_climate_high

from brums_feats b
left join diet_feats d on d.athlete_id = b.athlete_id
left join constr_last c on c.athlete_id = b.athlete_id
left join acsi_last a on a.athlete_id = b.athlete_id
left join gses_last g on g.athlete_id = b.athlete_id
left join restq_last r on r.athlete_id = b.athlete_id
left join pmcsq_last p on p.athlete_id = b.athlete_id;


-- ===========================================================
-- 3) RPC: UPSERT DO CONSTRUCIONAL
--
-- Esta função permite inserir um registro de classificação
-- construcional e marcar a linha original como analisada. É usada
-- pelo n8n após o AI classificar o texto.
-- ===========================================================
create or replace function public.upsert_construcional_analysis(
  p_construcional_raw_id text,
  p_athlete_id text,
  p_repertorio_protetor text,
  p_repertorio_risco text,
  p_apoio_ambiental text,
  p_claridade_metas text,
  p_model_name text default null,
  p_confidence numeric default null,
  p_explanation jsonb default null
)
returns void language plpgsql as $$
begin
  insert into construcional_analysis(
    construcional_raw_id, athlete_id,
    repertorio_protetor, repertorio_risco, apoio_ambiental, claridade_metas,
    model_name, confidence, explanation
  )
  values (
    p_construcional_raw_id, p_athlete_id,
    p_repertorio_protetor, p_repertorio_risco, p_apoio_ambiental, p_claridade_metas,
    p_model_name, p_confidence, p_explanation
  );

  update construcional_raw
  set status = 'analyzed', last_error = null
  where id = p_construcional_raw_id;
end $$;

-- ===========================================================
-- 4) RPC: UPSERT DO SCORE FINAL
--
-- Esta função permite inserir ou atualizar o score final de um
-- atleta em uma determinada data. É utilizada pelo n8n após
-- calcular o nível de atenção e as flags. O on conflict garante
-- que se já existir um registro para a data, ele será atualizado.
-- ===========================================================
create or replace function public.upsert_pingo_scoring_output(
  p_athlete_id text,
  p_reference_date date,
  p_attention_level int,
  p_flag_count int,
  p_flags jsonb,
  p_rules_triggered jsonb default '[]'::jsonb,
  p_thresholds_used jsonb default '{}'::jsonb,
  p_summary text default null
)
returns void language plpgsql as $$
begin
  insert into pingo_scoring_output(
    athlete_id, reference_date, attention_level, flag_count,
    flags, rules_triggered, thresholds_used, summary
  )
  values (
    p_athlete_id, p_reference_date, p_attention_level, p_flag_count,
    coalesce(p_flags, '[]'::jsonb),
    coalesce(p_rules_triggered, '[]'::jsonb),
    coalesce(p_thresholds_used, '{}'::jsonb),
    p_summary
  )
  on conflict (athlete_id, reference_date)
  do update set
    attention_level = excluded.attention_level,
    flag_count = excluded.flag_count,
    flags = excluded.flags,
    rules_triggered = excluded.rules_triggered,
    thresholds_used = excluded.thresholds_used,
    summary = excluded.summary,
    created_at = now();
end $$;

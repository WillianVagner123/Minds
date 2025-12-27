-- ===========================================================
-- 📊 MINDS PERFORMANCE – ANALYTICS (WEBHOOK DIRECT / NO QUEUE)
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
-- 1) VIEWS INTRA-INDIVIDUAIS (z-score por atleta)
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
  b.*,

  -- z por atleta
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

  -- flags simples
  case
    when li.ideal_weight_kg is not null
     and b.weight_kg is not null
     and abs((b.weight_kg - li.ideal_weight_kg) / li.ideal_weight_kg) > 0.05
    then true else false
  end as weight_red_flag,

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

  case
    when d.adherence_score is null then null
    when d.adherence_score <= 2 then 'low'
    when d.adherence_score = 3 then 'medium'
    else 'high'
  end as adherence_level,

  case
    when d.missed_meals ilike '%2%' then 2
    when d.missed_meals ilike '%1%' then 1
    when d.missed_meals ilike 'não' or d.missed_meals ilike 'nao' then 0
    else null
  end as missed_meals_n,

  case
    when d.gi_distress is null then null
    when d.gi_distress >= 7 then true
    else false
  end as gi_red_flag

from diet_daily d;

-- -------------------------
-- ACSI / GSES / PMCSQ / RESTQ / CBAS / WEEKLY / LOAD views
-- -------------------------
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

-- ===========================================================
-- 2) INPUTS CONSOLIDADOS PARA O N8N (WEBHOOK RunScoring)
-- ===========================================================
create or replace view public.pingo_scoring_inputs_view as
with latest_brums as (
  select distinct on (athlete_id)
    athlete_id, data,
    (vigor_z) as vigor_z,
    (dth_z) as dth_z
  from brums_analysis_view
  order by athlete_id, data desc, inserted_at desc
),
latest_diet as (
  select distinct on (athlete_id)
    athlete_id, data,
    adherence_score,
    adherence_level,
    energy_availability_risk,
    missed_meals_n,
    gi_distress
  from diet_daily_view
  order by athlete_id, data desc, inserted_at desc
),
latest_constr as (
  select distinct on (athlete_id)
    athlete_id,
    repertorio_protetor,
    repertorio_risco,
    apoio_ambiental,
    claridade_metas,
    analyzed_at
  from construcional_analysis
  order by athlete_id, analyzed_at desc
)
select
  b.athlete_id,
  b.data as reference_date,

  -- BRUMS
  b.vigor_z,
  b.dth_z,

  -- DIET
  d.adherence_score,
  d.adherence_level,
  d.energy_availability_risk,
  d.missed_meals_n as missed_meals,
  d.gi_distress,

  -- CONSTRUCIONAL
  c.repertorio_protetor,
  c.repertorio_risco,
  c.apoio_ambiental,
  c.claridade_metas,
  c.analyzed_at as construcional_analyzed_at

from latest_brums b
left join latest_diet d on d.athlete_id = b.athlete_id
left join latest_constr c on c.athlete_id = b.athlete_id;

-- ===========================================================
-- 3) RPC: UPSERT do CONSTRUCIONAL (WEBHOOK)
-- ===========================================================
create or replace function public.upsert_construcional_analysis(
  p_construcional_raw_id bigint,
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
-- 4) RPC: UPSERT do SCORE FINAL (WEBHOOK)
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

-- ===========================================================
-- 5) VIEW FINAL: “último score por atleta”
-- ===========================================================
create or replace view public.pingo_latest_score_view as
select distinct on (athlete_id)
  athlete_id,
  reference_date,
  attention_level,
  flag_count,
  flags,
  summary,
  created_at
from pingo_scoring_output
order by athlete_id, reference_date desc, created_at desc;

-- ===========================================================
-- 💬 PINGO CHAT – CONTEXTO + HISTÓRICO (SEM INTERFERIR NO RESTO)
-- Arquivo sugerido: schema/pingo_chat.sql
-- ===========================================================
-- Este script adiciona:
-- 1) View de contexto (último registro de cada fonte)
-- 2) RPC get_pingo_bundle() para devolver pacote "dia/semana/tudo/histórico"
-- ===========================================================

-- ===========================================================
-- 1) VIEW: CONTEXTO DO CHAT (último de cada questionário)
-- ===========================================================
create or replace view public.pingo_chat_context_view as
with
latest_score as (
  select distinct on (athlete_id)
    athlete_id,
    reference_date,
    attention_level,
    flag_count,
    flags,
    summary,
    created_at
  from public.pingo_scoring_output
  order by athlete_id, reference_date desc, created_at desc
),
latest_inputs as (
  select distinct on (athlete_id) *
  from public.pingo_scoring_inputs_view
  order by athlete_id, reference_date desc
),
latest_acsi as (
  select distinct on (athlete_id) *
  from public.acsi_analysis_view
  order by athlete_id, data desc, inserted_at desc
),
latest_gses as (
  select distinct on (athlete_id) *
  from public.gses_analysis_view
  order by athlete_id, data desc, inserted_at desc
),
latest_pmcsq as (
  select distinct on (athlete_id) *
  from public.pmcsq_analysis_view
  order by athlete_id, data desc, inserted_at desc
),
latest_restq as (
  select distinct on (athlete_id) *
  from public.restq_analysis_view
  order by athlete_id, data desc, inserted_at desc
),
latest_cbas as (
  select distinct on (athlete_id) *
  from public.cbas_analysis_view
  order by athlete_id, data desc, inserted_at desc
),
latest_weekly as (
  select distinct on (athlete_id) *
  from public.weekly_analysis_view
  order by athlete_id, start_date desc, inserted_at desc
),
latest_load as (
  select distinct on (athlete_id) *
  from public.training_load_analysis_view
  order by athlete_id, week_start desc, inserted_at desc
)
select
  i.athlete_id,

  -- Score final
  s.reference_date,
  s.attention_level,
  s.flag_count,
  s.flags,
  s.summary,
  s.created_at as score_created_at,

  -- Inputs consolidados (BRUMS/Dieta/Construcional)
  i.vigor_z,
  i.dth_z,
  i.adherence_score,
  i.adherence_level,
  i.energy_availability_risk,
  i.missed_meals,
  i.gi_distress,
  i.repertorio_protetor,
  i.repertorio_risco,
  i.apoio_ambiental,
  i.claridade_metas,
  i.construcional_analyzed_at,

  -- Últimos questionários (último registro disponível)
  a.media as acsi_media,
  a.media_z as acsi_media_z,

  g.media as gses_media,
  g.media_z as gses_media_z,

  p.clima_tarefa,
  p.clima_tarefa_z,
  p.clima_ego,
  p.clima_ego_z,

  r.media as restq_media,
  r.media_z as restq_media_z,

  c.aversivos,
  c.aversivos_z,

  w.desempenho,
  w.desempenho_z,
  w.adesao_nutricional,
  w.adesao_z,

  t.weekly_load,
  t.weekly_load_z,
  t.monotonia,
  t.monotonia_z,
  t.strain,
  t.strain_z,
  t.readiness,
  t.readiness_z,
  t.acwr,
  t.acwr_z

from latest_inputs i
left join latest_score s on s.athlete_id = i.athlete_id
left join latest_acsi a on a.athlete_id = i.athlete_id
left join latest_gses g on g.athlete_id = i.athlete_id
left join latest_pmcsq p on p.athlete_id = i.athlete_id
left join latest_restq r on r.athlete_id = i.athlete_id
left join latest_cbas c on c.athlete_id = i.athlete_id
left join latest_weekly w on w.athlete_id = i.athlete_id
left join latest_load t on t.athlete_id = i.athlete_id;

comment on view public.pingo_chat_context_view is
'Contexto do PingoChat: último score + últimos sinais (inputs) + último registro de escalas e semanais para cada atleta.';


-- ===========================================================
-- 2) RPC: GET "PACOTE" INTELIGENTE (dia / semana / tudo / histórico)
-- ===========================================================
create or replace function public.get_pingo_bundle(
  p_athlete_id text,
  p_mode text default 'tudo',              -- 'tudo'|'dia'|'semana'|'scores'|'diario'|'psico'|'context'
  p_ref_date date default current_date,    -- usado quando mode='dia'
  p_days int default 30,                   -- histórico diário/scores quando mode='tudo'/'scores'/'diario'
  p_weeks int default 12,                  -- histórico semanal quando mode='tudo'/'semana'
  p_include_construcional_raw boolean default false
)
returns jsonb
language plpgsql
as $$
declare
  v_since date := (current_date - (p_days || ' days')::interval)::date;
  v_week_since date := (current_date - (p_weeks || ' weeks')::interval)::date;
  v_mode text := lower(coalesce(p_mode,'tudo'));
begin
  return jsonb_build_object(
    'athlete_id', p_athlete_id,
    'mode', v_mode,
    'ref_date', p_ref_date,
    'days', p_days,
    'weeks', p_weeks,

    -- =========================
    -- CONTEXTO (1-linha)
    -- =========================
    'context', case when v_mode in ('tudo','context') then
      (
        select to_jsonb(c)
        from public.pingo_chat_context_view c
        where c.athlete_id = p_athlete_id
        limit 1
      )
    else null end,

    -- =========================
    -- DIA (tudo do dia)
    -- =========================
    'dia', case when v_mode in ('tudo','dia') then
      jsonb_build_object(
        'inputs', (
          select to_jsonb(i)
          from public.pingo_scoring_inputs_view i
          where i.athlete_id = p_athlete_id
            and i.reference_date = p_ref_date
          limit 1
        ),
        'score', (
          select to_jsonb(s)
          from (
            select reference_date, attention_level, flag_count, flags, summary, created_at
            from public.pingo_scoring_output
            where athlete_id = p_athlete_id
              and reference_date = p_ref_date
            order by created_at desc
            limit 1
          ) s
        ),
        'brums_raw', (
          select to_jsonb(b)
          from (
            select *
            from public.brums_analysis
            where athlete_id = p_athlete_id
              and data = p_ref_date
            order by inserted_at desc
            limit 1
          ) b
        ),
        'diet_raw', (
          select to_jsonb(d)
          from (
            select *
            from public.diet_daily
            where athlete_id = p_athlete_id
              and data = p_ref_date
            order by inserted_at desc
            limit 1
          ) d
        ),
        'construcional_analysis_last', (
          select to_jsonb(ca)
          from (
            select *
            from public.construcional_analysis
            where athlete_id = p_athlete_id
            order by analyzed_at desc
            limit 1
          ) ca
        ),
        'construcional_raw_last', (
          case when p_include_construcional_raw then
            (
              select to_jsonb(cr)
              from (
                select *
                from public.construcional_raw
                where athlete_id = p_athlete_id
                order by submitted_at desc
                limit 1
              ) cr
            )
          else null end
        )
      )
    else null end,

    -- =========================
    -- SEMANA (últimas semanas)
    -- =========================
    'semana', case when v_mode in ('tudo','semana') then
      jsonb_build_object(
        'weekly', (
          select coalesce(jsonb_agg(to_jsonb(w) order by w.start_date desc), '[]'::jsonb)
          from (
            select *
            from public.weekly_analysis
            where athlete_id = p_athlete_id
              and start_date >= v_week_since
            order by start_date desc, inserted_at desc
          ) w
        ),
        'load', (
          select coalesce(jsonb_agg(to_jsonb(t) order by t.week_start desc), '[]'::jsonb)
          from (
            select *
            from public.training_load_analysis
            where athlete_id = p_athlete_id
              and week_start >= v_week_since
            order by week_start desc, inserted_at desc
          ) t
        )
      )
    else null end,

    -- =========================
    -- HISTÓRICO DIÁRIO / SCORES
    -- =========================
    'historico', case when v_mode in ('tudo','scores','diario') then
      jsonb_build_object(
        'scores', (
          select coalesce(jsonb_agg(to_jsonb(s) order by s.reference_date desc), '[]'::jsonb)
          from (
            select reference_date, attention_level, flag_count, flags, summary, created_at
            from public.pingo_scoring_output
            where athlete_id = p_athlete_id
              and reference_date >= v_since
            order by reference_date desc, created_at desc
          ) s
        ),
        'daily_inputs', (
          select coalesce(jsonb_agg(to_jsonb(i) order by i.reference_date desc), '[]'::jsonb)
          from (
            select *
            from public.pingo_scoring_inputs_view
            where athlete_id = p_athlete_id
              and reference_date >= v_since
            order by reference_date desc
          ) i
        )
      )
    else null end,

    -- =========================
    -- ESCALAS (psico) – últimos registros
    -- =========================
    'psico', case when v_mode in ('tudo','psico') then
      jsonb_build_object(
        'acsi_last', (
          select to_jsonb(a)
          from public.acsi_analysis_view a
          where a.athlete_id = p_athlete_id
          order by a.data desc, a.inserted_at desc
          limit 1
        ),
        'gses_last', (
          select to_jsonb(g)
          from public.gses_analysis_view g
          where g.athlete_id = p_athlete_id
          order by g.data desc, g.inserted_at desc
          limit 1
        ),
        'pmcsq_last', (
          select to_jsonb(p)
          from public.pmcsq_analysis_view p
          where p.athlete_id = p_athlete_id
          order by p.data desc, p.inserted_at desc
          limit 1
        ),
        'restq_last', (
          select to_jsonb(r)
          from public.restq_analysis_view r
          where r.athlete_id = p_athlete_id
          order by r.data desc, r.inserted_at desc
          limit 1
        ),
        'cbas_last', (
          select to_jsonb(c)
          from public.cbas_analysis_view c
          where c.athlete_id = p_athlete_id
          order by c.data desc, c.inserted_at desc
          limit 1
        )
      )
    else null end
  );
end;
$$;

comment on function public.get_pingo_bundle(text,text,date,int,int,boolean) is
'RPC do PingoChat: devolve pacote por atleta (dia/semana/histórico/tudo), opcionalmente incluindo o construcional_raw.';


-- ===========================================================
-- 3) GRANTS (opcional)
-- Se você usa Service Role no n8n, normalmente não precisa.
-- Se quiser liberar para anon/auth (não recomendo sem RLS bem feito),
-- descomente:
-- ===========================================================
-- grant select on public.pingo_chat_context_view to authenticated;
-- grant execute on function public.get_pingo_bundle(text,text,date,int,int,boolean) to authenticated;

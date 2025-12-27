-- ===========================================================
-- MINDS PERFORMANCE — RULES SYNC (GitHub RAW -> Supabase)
-- ===========================================================
-- Objetivo:
-- - Guardar todos os JSONs de regras em uma tabela
-- - (Opcional) Buscar automaticamente via HTTP dentro do Postgres (pg_net)
-- - Padronizar: rules_key -> payload jsonb
-- ===========================================================

-- 0) Tabela única para armazenar qualquer rules.json
create table if not exists scoring_rules (
  rules_key text primary key,             -- ex: 'attention_levels', 'red_flags'
  source_url text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  etag text,
  sha256 text
);

comment on table scoring_rules is 'Armazena JSONs de regras (scoring) puxados do GitHub raw ou via n8n/Edge Function.';

-- 1) Catálogo dos URLs (facilita refresh_all)
create table if not exists scoring_rules_catalog (
  rules_key text primary key,
  source_url text not null,
  enabled boolean not null default true
);

-- Preenche catálogo com seus arquivos (ajuste se mudar o repo)
insert into scoring_rules_catalog (rules_key, source_url, enabled)
values
  ('attention_levels', 'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/attention_levels.json', true),
  ('brums_rules', 'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/brums_rules.json', true),
  ('diet_adherence_rules', 'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/diet_adherence_rules.json', true),
  ('construcional_rules', 'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/construcional_rules.json', true),
  ('questionnaire_correlation_rules', 'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/questionnaire_correlation_rules.json', true),
  ('red_flags', 'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/red_flags.json', true),
  ('scoring_engine', 'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/scoring_engine.json', true),
  ('pingo_scoring_output_schema', 'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/pingo_scoring_output.schema.json', true)
on conflict (rules_key) do update
set source_url = excluded.source_url,
    enabled = excluded.enabled;

-- 2) (Opcional) Extensão para HTTP GET dentro do Postgres
-- Se der erro aqui, seu projeto não tem pg_net. Sem stress: use n8n/Edge Function.
create extension if not exists pg_net;

-- 3) Helpers: sha256 (para detectar mudanças)
create extension if not exists pgcrypto;

-- 4) Função: upsert de rule (funciona tanto pra n8n quanto pro fetch interno)
create or replace function upsert_scoring_rule(
  p_rules_key text,
  p_source_url text,
  p_payload jsonb,
  p_etag text default null
) returns void
language plpgsql
as $$
declare
  v_sha text;
begin
  v_sha := encode(digest(convert_to(p_payload::text, 'utf8'), 'sha256'), 'hex');

  insert into scoring_rules (rules_key, source_url, payload, fetched_at, etag, sha256)
  values (p_rules_key, p_source_url, p_payload, now(), p_etag, v_sha)
  on conflict (rules_key) do update
  set source_url = excluded.source_url,
      payload = excluded.payload,
      fetched_at = excluded.fetched_at,
      etag = coalesce(excluded.etag, scoring_rules.etag),
      sha256 = excluded.sha256;
end;
$$;

-- 5) Fetch interno via pg_net: baixa o JSON do GitHub e salva
-- Obs: essa função só funciona se pg_net estiver habilitado no seu Supabase.
create or replace function refresh_scoring_rule_from_url(p_rules_key text, p_url text)
returns void
language plpgsql
as $$
declare
  v_resp jsonb;
  v_body text;
  v_payload jsonb;
begin
  -- net.http_get retorna json com body/status/headers (varia por versão).
  v_resp := net.http_get(p_url)::jsonb;

  -- tenta extrair body (string JSON)
  v_body := coalesce(v_resp->>'body', v_resp->'response'->>'body', null);

  if v_body is null or length(v_body) = 0 then
    raise exception 'HTTP body vazio ao buscar %', p_url;
  end if;

  v_payload := v_body::jsonb;

  perform upsert_scoring_rule(p_rules_key, p_url, v_payload, null);
end;
$$;

-- 6) Refresh de tudo do catálogo
create or replace function refresh_all_scoring_rules()
returns void
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select rules_key, source_url
    from scoring_rules_catalog
    where enabled = true
  loop
    begin
      perform refresh_scoring_rule_from_url(r.rules_key, r.source_url);
    exception when others then
      -- não falha tudo se 1 url der erro
      raise notice 'Falha ao atualizar % (%): %', r.rules_key, r.source_url, sqlerrm;
    end;
  end loop;
end;
$$;

-- 7) View pra ver o status
create or replace view scoring_rules_status as
select
  c.rules_key,
  c.source_url,
  c.enabled,
  r.fetched_at,
  r.sha256
from scoring_rules_catalog c
left join scoring_rules r using (rules_key);

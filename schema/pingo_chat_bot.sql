-- ===========================================================
-- 🟣 PINGO CHAT (Supabase) — DDL + RPCs COMPLETO
-- Tudo que conversamos:
-- ✅ memorizar atleta ativo por usuário (sem pedir CPF toda hora)
-- ✅ buscar atleta por nome/ID/telefone
-- ✅ salvar mensagens do USUÁRIO (não salva resposta do robô)
-- ✅ promover mensagens para “histórico” (via comando /gravar)
-- ✅ criar notas/conclusões interpretadas (via agente)
-- ✅ puxar últimas conversas + últimas notas como contexto
-- ✅ embeddings em analysis_vectors (source='pingo_chat_note')
-- ✅ busca por similaridade (pgvector) para recuperar notas parecidas
-- ===========================================================

create extension if not exists vector;

-- ===========================================================
-- 0) CONTEXTO DO CHAT (memória por usuário)
-- ===========================================================
create table if not exists public.pingo_chat_context (
  user_id text primary key,                 -- ex: "+5561999..."
  last_athlete_id text,                     -- atleta ativo no chat
  last_athlete_name text,
  last_team_name text,
  last_athlete_phone text,
  last_coach_phone text,
  meta jsonb not null default '{}'::jsonb,  -- qualquer dado extra (ex: idioma, preferências)
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create or replace function public.set_pingo_chat_context_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_pingo_chat_context_updated_at on public.pingo_chat_context;
create trigger trg_pingo_chat_context_updated_at
before update on public.pingo_chat_context
for each row execute function public.set_pingo_chat_context_updated_at();

-- ===========================================================
-- 1) LISTA DE “ATLETAS DO USUÁRIO” (atalhos/favoritos)
-- (Quando o usuário alterna atletas, registramos aqui)
-- ===========================================================
create table if not exists public.pingo_user_athletes (
  user_id text not null,
  athlete_id text not null,
  athlete_name text,
  team_name text,
  athlete_phone text,
  coach_phone text,
  pinned boolean not null default false,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, athlete_id)
);

create index if not exists pingo_user_athletes_user_idx
on public.pingo_user_athletes (user_id, pinned desc, last_used_at desc);

-- ===========================================================
-- 2) MENSAGENS DO USUÁRIO (entrada do WhatsApp)
-- ✅ guarda só o que o usuário enviou para o PINGO
-- ===========================================================
create table if not exists public.pingo_user_messages (
  id bigserial primary key,

  user_id text not null,                    -- whatsapp do usuário que conversa com o PINGO
  athlete_id text,                          -- atleta ativo (pode ser null antes de escolher)

  message_text text not null,
  message_type text not null default 'text',
  message_meta jsonb not null default '{}'::jsonb,  -- ids do provedor (evolution), etc

  received_at timestamptz not null default now(),

  include_in_history boolean not null default false,  -- vira “histórico interpretado” quando true
  saved_at timestamptz,
  saved_by text                                  -- 'command'|'agent'|'manual'
);

create index if not exists pingo_user_messages_user_idx
on public.pingo_user_messages (user_id, received_at desc);

create index if not exists pingo_user_messages_athlete_idx
on public.pingo_user_messages (athlete_id, received_at desc);

create index if not exists pingo_user_messages_history_idx
on public.pingo_user_messages (athlete_id, include_in_history, saved_at desc);

-- ===========================================================
-- 3) NOTAS / CONCLUSÕES (histórico interpretado)
-- ✅ registro vinculado ao atleta (pode vir de /gravar ou do agente)
-- ===========================================================
create table if not exists public.pingo_athlete_notes (
  id bigserial primary key,

  athlete_id text not null,
  user_id text,                               -- quem originou (mesmo user do chat)
  source_message_id bigint references public.pingo_user_messages(id) on delete set null,

  title text,
  note_text text not null,
  tags text[] default '{}'::text[],
  confidence numeric,
  model_name text,
  note_meta jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists pingo_athlete_notes_athlete_idx
on public.pingo_athlete_notes (athlete_id, created_at desc);

-- ===========================================================
-- 4) analysis_vectors (já existe no seu DDL)
-- ✅ vamos usar para embeddings do chat
-- source = 'pingo_chat_note'
-- metadata = {note_id, tags, user_id}
-- ===========================================================
-- (se não existir no seu ambiente, descomente)
-- create table if not exists public.analysis_vectors (
--   id bigserial primary key,
--   athlete_id text not null,
--   data date not null,
--   source text not null,
--   embedding vector(1536),
--   metadata jsonb,
--   inserted_at timestamptz default now()
-- );

create index if not exists analysis_vectors_athlete_source_idx
on public.analysis_vectors (athlete_id, source, data desc, inserted_at desc);

-- ===========================================================
-- 5) HELPERS — buscar “último cadastro” do atleta
-- Usa athlete_registration (último inserted_at por athlete_id)
-- ===========================================================
create or replace view public.athlete_latest_view as
select distinct on (ar.athlete_id)
  ar.athlete_id,
  ar.athlete_name,
  ar.team_name,
  ar.athlete_phone,
  ar.coach_phone,
  ar.inserted_at
from public.athlete_registration ar
where ar.athlete_id is not null
order by ar.athlete_id, ar.inserted_at desc;

-- ===========================================================
-- 6) RPCs — CONTEXTO / SELEÇÃO DE ATLETA
-- ===========================================================

-- 6.1) pegar contexto do chat
create or replace function public.get_pingo_chat_context(p_user_id text)
returns table (
  user_id text,
  last_athlete_id text,
  last_athlete_name text,
  last_team_name text,
  last_athlete_phone text,
  last_coach_phone text,
  meta jsonb,
  updated_at timestamptz
)
language sql
stable
as $$
  select
    c.user_id,
    c.last_athlete_id,
    c.last_athlete_name,
    c.last_team_name,
    c.last_athlete_phone,
    c.last_coach_phone,
    c.meta,
    c.updated_at
  from public.pingo_chat_context c
  where c.user_id = p_user_id;
$$;

-- 6.2) listar atletas (por nome/ID/telefone/time)
create or replace function public.find_athletes(p_query text, p_limit int default 10)
returns table (
  athlete_id text,
  athlete_name text,
  team_name text,
  athlete_phone text,
  coach_phone text,
  last_seen timestamptz
)
language sql
stable
as $$
  with q as (
    select trim(coalesce(p_query,'')) as query
  )
  select
    a.athlete_id,
    a.athlete_name,
    a.team_name,
    a.athlete_phone,
    a.coach_phone,
    a.inserted_at as last_seen
  from public.athlete_latest_view a, q
  where
    q.query <> ''
    and (
      a.athlete_id ilike q.query || '%'
      or coalesce(a.athlete_name,'') ilike '%' || q.query || '%'
      or coalesce(a.team_name,'') ilike '%' || q.query || '%'
      or coalesce(a.athlete_phone,'') ilike '%' || regexp_replace(q.query,'\D','','g') || '%'
      or coalesce(a.coach_phone,'') ilike '%' || regexp_replace(q.query,'\D','','g') || '%'
    )
  order by a.inserted_at desc
  limit greatest(1, least(p_limit, 25));
$$;

-- 6.3) definir atleta ativo (salva no contexto e na lista do usuário)
create or replace function public.set_active_athlete(
  p_user_id text,
  p_athlete_id text
)
returns jsonb
language plpgsql
as $$
declare
  a record;
begin
  select *
  into a
  from public.athlete_latest_view
  where athlete_id = p_athlete_id;

  if not found then
    raise exception 'Atleta não encontrado: %', p_athlete_id;
  end if;

  insert into public.pingo_chat_context(
    user_id, last_athlete_id, last_athlete_name, last_team_name, last_athlete_phone, last_coach_phone, meta
  )
  values (
    p_user_id, a.athlete_id, a.athlete_name, a.team_name, a.athlete_phone, a.coach_phone, '{}'::jsonb
  )
  on conflict (user_id) do update set
    last_athlete_id = excluded.last_athlete_id,
    last_athlete_name = excluded.last_athlete_name,
    last_team_name = excluded.last_team_name,
    last_athlete_phone = excluded.last_athlete_phone,
    last_coach_phone = excluded.last_coach_phone;

  insert into public.pingo_user_athletes(
    user_id, athlete_id, athlete_name, team_name, athlete_phone, coach_phone, last_used_at
  )
  values (
    p_user_id, a.athlete_id, a.athlete_name, a.team_name, a.athlete_phone, a.coach_phone, now()
  )
  on conflict (user_id, athlete_id) do update set
    athlete_name = excluded.athlete_name,
    team_name = excluded.team_name,
    athlete_phone = excluded.athlete_phone,
    coach_phone = excluded.coach_phone,
    last_used_at = now();

  return jsonb_build_object(
    'user_id', p_user_id,
    'athlete_id', a.athlete_id,
    'athlete_name', a.athlete_name,
    'team_name', a.team_name,
    'athlete_phone', a.athlete_phone,
    'coach_phone', a.coach_phone
  );
end $$;

-- 6.4) listar atletas já usados pelo usuário (atalho)
create or replace function public.list_user_athletes(p_user_id text, p_limit int default 20)
returns table(
  athlete_id text,
  athlete_name text,
  team_name text,
  athlete_phone text,
  coach_phone text,
  pinned boolean,
  last_used_at timestamptz
)
language sql
stable
as $$
  select
    athlete_id, athlete_name, team_name, athlete_phone, coach_phone, pinned, last_used_at
  from public.pingo_user_athletes
  where user_id = p_user_id
  order by pinned desc, last_used_at desc
  limit greatest(1, least(p_limit, 50));
$$;

-- 6.5) pin/unpin atleta
create or replace function public.pin_user_athlete(p_user_id text, p_athlete_id text, p_pinned boolean default true)
returns void
language plpgsql
as $$
begin
  update public.pingo_user_athletes
  set pinned = p_pinned
  where user_id = p_user_id and athlete_id = p_athlete_id;
end $$;

-- ===========================================================
-- 7) RPCs — LOGAR MENSAGEM DO USUÁRIO
-- ===========================================================

-- 7.1) logar mensagem (usa athlete_id do contexto se não vier no parâmetro)
create or replace function public.log_user_message(
  p_user_id text,
  p_message_text text,
  p_message_type text default 'text',
  p_message_meta jsonb default '{}'::jsonb,
  p_athlete_id text default null
)
returns table (
  message_id bigint,
  athlete_id text
)
language plpgsql
as $$
declare
  v_athlete_id text;
  v_id bigint;
begin
  v_athlete_id := p_athlete_id;

  if v_athlete_id is null then
    select c.last_athlete_id into v_athlete_id
    from public.pingo_chat_context c
    where c.user_id = p_user_id;
  end if;

  insert into public.pingo_user_messages(
    user_id, athlete_id, message_text, message_type, message_meta
  )
  values (
    p_user_id, v_athlete_id, p_message_text, coalesce(p_message_type,'text'), coalesce(p_message_meta,'{}'::jsonb)
  )
  returning id into v_id;

  return query select v_id, v_athlete_id;
end $$;

-- 7.2) pegar últimas mensagens (para contexto do agente)
create or replace function public.get_recent_user_messages(
  p_athlete_id text,
  p_limit int default 15,
  p_only_history boolean default false
)
returns table (
  id bigint,
  received_at timestamptz,
  message_text text,
  include_in_history boolean,
  saved_at timestamptz,
  saved_by text
)
language sql
stable
as $$
  select
    m.id, m.received_at, m.message_text, m.include_in_history, m.saved_at, m.saved_by
  from public.pingo_user_messages m
  where m.athlete_id = p_athlete_id
    and (case when p_only_history then m.include_in_history else true end)
  order by m.received_at desc
  limit greatest(1, least(p_limit, 50));
$$;

-- ===========================================================
-- 8) RPCs — NOTAS / HISTÓRICO (conclusões)
-- ===========================================================

-- 8.1) criar nota interpretada (decisão do agente)
create or replace function public.create_athlete_note(
  p_athlete_id text,
  p_note_text text,                             -- ✅ obrigatório vem antes
  p_user_id text default null,
  p_source_message_id bigint default null,
  p_title text default null,
  p_tags text[] default '{}'::text[],
  p_confidence numeric default null,
  p_model_name text default null,
  p_note_meta jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into public.pingo_athlete_notes(
    athlete_id, user_id, source_message_id,
    title, note_text, tags, confidence, model_name, note_meta
  )
  values (
    p_athlete_id, p_user_id, p_source_message_id,
    p_title, p_note_text, coalesce(p_tags,'{}'::text[]),
    p_confidence, p_model_name, coalesce(p_note_meta,'{}'::jsonb)
  )
  returning id into v_id;

  if p_source_message_id is not null then
    update public.pingo_user_messages
    set include_in_history = true,
        saved_at = now(),
        saved_by = 'agent'
    where id = p_source_message_id;
  end if;

  return v_id;
end $$;


-- 8.2) transformar a ÚLTIMA mensagem do usuário em nota (comando /gravar)
create or replace function public.save_last_user_message_as_history(
  p_user_id text,
  p_title text default null,
  p_tags text[] default '{}'::text[],
  p_saved_by text default 'command'
)
returns bigint
language plpgsql
as $$
declare
  v_msg record;
  v_note_id bigint;
begin
  select *
  into v_msg
  from public.pingo_user_messages m
  where m.user_id = p_user_id
    and m.athlete_id is not null
  order by m.received_at desc
  limit 1;

  if not found then
    raise exception 'Nenhuma mensagem recente com athlete_id encontrado para este user_id.';
  end if;

  update public.pingo_user_messages
  set include_in_history = true,
      saved_at = now(),
      saved_by = p_saved_by
  where id = v_msg.id;

  insert into public.pingo_athlete_notes(
    athlete_id, user_id, source_message_id, title, note_text, tags, note_meta
  )
  values (
    v_msg.athlete_id,
    v_msg.user_id,
    v_msg.id,
    coalesce(p_title, 'Registro do usuário (chat)'),
    v_msg.message_text,
    coalesce(p_tags, '{}'::text[]),
    jsonb_build_object('origin','user_command','saved_by',p_saved_by)
  )
  returning id into v_note_id;

  return v_note_id;
end $$;

-- 8.3) listar notas recentes do atleta (para contexto)
create or replace function public.get_recent_notes(
  p_athlete_id text,
  p_limit int default 10
)
returns table (
  id bigint,
  created_at timestamptz,
  title text,
  note_text text,
  tags text[],
  confidence numeric,
  model_name text
)
language sql
stable
as $$
  select
    n.id, n.created_at, n.title, n.note_text, n.tags, n.confidence, n.model_name
  from public.pingo_athlete_notes n
  where n.athlete_id = p_athlete_id
  order by n.created_at desc
  limit greatest(1, least(p_limit, 30));
$$;

-- ===========================================================
-- 9) RPC “BUNDLE” — tudo que o agente precisa em 1 chamada
-- (contexto + atleta ativo + mensagens + notas)
-- ===========================================================
create or replace function public.get_pingo_chat_bundle(
  p_user_id text,
  p_notes_limit int default 8,
  p_msgs_limit int default 10
)
returns jsonb
language plpgsql
as $$
declare
  c record;
  a record;
  notes jsonb;
  msgs jsonb;
begin
  select * into c
  from public.pingo_chat_context
  where user_id = p_user_id;

  if not found or c.last_athlete_id is null then
    return jsonb_build_object(
      'user_id', p_user_id,
      'context', coalesce(to_jsonb(c), '{}'::jsonb),
      'athlete', null,
      'recent_notes', '[]'::jsonb,
      'recent_messages', '[]'::jsonb
    );
  end if;

  select * into a
  from public.athlete_latest_view
  where athlete_id = c.last_athlete_id;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
  into notes
  from (
    select * from public.get_recent_notes(c.last_athlete_id, p_notes_limit)
  ) x;

  select coalesce(jsonb_agg(to_jsonb(y)), '[]'::jsonb)
  into msgs
  from (
    select * from public.get_recent_user_messages(c.last_athlete_id, p_msgs_limit, false)
  ) y;

  return jsonb_build_object(
    'user_id', p_user_id,
    'context', to_jsonb(c),
    'athlete', to_jsonb(a),
    'recent_notes', notes,
    'recent_messages', msgs
  );
end $$;

-- ===========================================================
-- 10) EMBEDDINGS — gravar nota no analysis_vectors
-- ===========================================================

-- 10.1) inserir vetor genérico (caso você gere embedding no n8n)
create or replace function public.insert_analysis_vector(
  p_athlete_id text,
  p_data date,
  p_source text,
  p_embedding vector(1536),
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into public.analysis_vectors(
    athlete_id, data, source, embedding, metadata
  )
  values (
    p_athlete_id, p_data, p_source, p_embedding, coalesce(p_metadata,'{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end $$;

-- 10.2) anexar embedding para uma nota (source='pingo_chat_note')
create or replace function public.attach_note_embedding(
  p_note_id bigint,
  p_embedding vector(1536)
)
returns bigint
language plpgsql
as $$
declare
  n record;
  v_id bigint;
  v_meta jsonb;
begin
  select * into n
  from public.pingo_athlete_notes
  where id = p_note_id;

  if not found then
    raise exception 'Nota não encontrada: %', p_note_id;
  end if;

  v_meta := jsonb_build_object(
    'note_id', n.id,
    'tags', n.tags,
    'user_id', n.user_id
  );

  insert into public.analysis_vectors(
    athlete_id, data, source, embedding, metadata
  )
  values (
    n.athlete_id,
    (n.created_at at time zone 'America/Sao_Paulo')::date,
    'pingo_chat_note',
    p_embedding,
    v_meta
  )
  returning id into v_id;

  return v_id;
end $$;

-- ===========================================================
-- 11) SIMILARIDADE — buscar notas parecidas (pgvector)
-- ===========================================================
create or replace function public.search_similar_chat_notes(
  p_athlete_id text,
  p_query_embedding vector(1536),
  p_limit int default 8
)
returns table (
  note_id bigint,
  created_at timestamptz,
  title text,
  note_text text,
  tags text[],
  distance numeric
)
language sql
stable
as $$
  with v as (
    select
      av.metadata->>'note_id' as note_id_txt,
      (av.embedding <-> p_query_embedding) as dist
    from public.analysis_vectors av
    where av.athlete_id = p_athlete_id
      and av.source = 'pingo_chat_note'
      and av.embedding is not null
      and av.metadata ? 'note_id'
    order by av.embedding <-> p_query_embedding
    limit greatest(1, least(p_limit, 20))
  )
  select
    n.id as note_id,
    n.created_at,
    n.title,
    n.note_text,
    n.tags,
    v.dist as distance
  from v
  join public.pingo_athlete_notes n
    on n.id = (v.note_id_txt)::bigint
  order by v.dist asc;
$$;

-- ===========================================================
-- 12) (OPCIONAL) RLS — se você quiser travar acesso
-- Se seu n8n usa SERVICE ROLE, ele ignora RLS.
-- Se usar ANON/USER, crie policies conforme seu auth.
-- ===========================================================
-- alter table public.pingo_chat_context enable row level security;
-- alter table public.pingo_user_athletes enable row level security;
-- alter table public.pingo_user_messages enable row level security;
-- alter table public.pingo_athlete_notes enable row level security;
--
-- (Exemplo simples: permitir só service role / backend; caso contrário, deixe RLS off)
-- (Na prática, para WhatsApp + n8n, normalmente você usa service role mesmo.)
create or replace function public.patch_pingo_chat_context(
  p_user_id text,
  p_patch jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_meta jsonb;
begin
  insert into public.pingo_chat_context(user_id, meta)
  values (p_user_id, coalesce(p_patch,'{}'::jsonb))
  on conflict (user_id) do update set
    meta = coalesce(pingo_chat_context.meta,'{}'::jsonb) || coalesce(excluded.meta,'{}'::jsonb);

  select meta into v_meta
  from public.pingo_chat_context
  where user_id = p_user_id;

  return jsonb_build_object('user_id', p_user_id, 'meta', v_meta);
end $$;



create or replace function public.save_user_message_as_history(
  p_message_id bigint,
  p_title text default null,
  p_tags text[] default '{}'::text[],
  p_saved_by text default 'command'
)
returns bigint
language plpgsql
as $$
declare
  v_msg record;
  v_note_id bigint;
begin
  select * into v_msg
  from public.pingo_user_messages
  where id = p_message_id;

  if not found then
    raise exception 'Mensagem não encontrada: %', p_message_id;
  end if;

  update public.pingo_user_messages
  set include_in_history = true,
      saved_at = now(),
      saved_by = p_saved_by
  where id = v_msg.id;

  insert into public.pingo_athlete_notes(
    athlete_id, user_id, source_message_id,
    title, note_text, tags, note_meta
  )
  values (
    v_msg.athlete_id,
    v_msg.user_id,
    v_msg.id,
    coalesce(p_title, 'Registro do usuário (chat)'),
    v_msg.message_text,
    coalesce(p_tags,'{}'::text[]),
    jsonb_build_object('origin','user_command','saved_by',p_saved_by)
  )
  returning id into v_note_id;

  return v_note_id;
end $$;

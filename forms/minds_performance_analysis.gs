/**
 * MINDS Performance – API de Análise (Supabase tabelas específicas + triggers + n8n)
 *
 * ✅ Grava nas tabelas existentes:
 * brums_analysis, diet_daily, weekly_analysis, acsi_analysis, gses_analysis,
 * pmcsq_analysis, restq_analysis, cbas_analysis, athlete_registration, construcional_raw
 *
 * ✅ NOVO (2025-12): metadados + identificação:
 * - athlete_name, team_name armazenados em athlete_registration (último cadastro vale como “fonte”)
 * - kind + payload + source + master_sheet_id em todas as tabelas de análise (para rastreio)
 *
 * ✅ Script Properties obrigatórias:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_KEY
 *
 * ✅ Web App (opcional):
 * GET/POST:
 *   ?action=health
 *   ?action=analyze_latest&kind=daily&athlete=...
 *   ?action=push_latest&kind=daily&athlete=...&score=1
 *   ?action=push_range&kind=daily&athlete=...&days=30&score=0
 */

/* =========================
   CONFIGURAÇÃO BÁSICA
========================= */

var MASTER_SHEET_ID = "17QcZhPSwT-7iEbx5MffEacmlPbpwUOImg7xxkwmhQRo";

var TAB = {
  daily: "RESP_DAILY",
  weekly: "RESP_WEEKLY",
  quarterly: "RESP_QUARTERLY",
  semiannual: "RESP_SEMIANNUAL",
  restq_trainer: "RESP_RESTQ_TRAINER",
  registration: "RESP_REGISTRATION",
  construcional: "RESP_CONSTRUCIONAL"
};

var COL = {
  timestamp: "Carimbo de data/hora",
  athleteId: "ATHLETE_ID"
};

/* =========================
   N8N (1 endpoint por kind)
   ✅ Baseado no padrão:
   https://autowebhook.opingo.com.br/webhook/RunScoring
========================= */

var N8N_WEBHOOK_BASE = "https://autowebhook.opingo.com.br/webhook/";

var N8N_WEBHOOK = {
  daily:        N8N_WEBHOOK_BASE + "Daily",
  weekly:       N8N_WEBHOOK_BASE + "Weekly",
  quarterly:    N8N_WEBHOOK_BASE + "Quarterly",
  semiannual:   N8N_WEBHOOK_BASE + "Semiannual",
  registration: N8N_WEBHOOK_BASE + "Registration",
  restq_trainer:N8N_WEBHOOK_BASE + "RestqTrainer",
  construcional:N8N_WEBHOOK_BASE + "Construcional",
  run_scoring:  N8N_WEBHOOK_BASE + "RunScoring"
};

// Se TRUE: GAS chama RunScoring além do webhook do kind.
// Se FALSE: você chama RunScoring dentro do fluxo do kind no n8n.
var ALSO_CALL_RUNSCORING_FROM_GAS = true;

function postJson_(url, payloadObj) {
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payloadObj),
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(url, options);
  Logger.log("n8n POST " + url + " -> HTTP " + response.getResponseCode() + " body=" + response.getContentText());
  return response;
}

/**
 * Webhook específico do questionário (kind).
 * Payload padrão para TODOS os kinds.
 */
function sendKindToN8n(kind, athleteId, referenceDate, rowObj, pushedInfo) {
  var url = N8N_WEBHOOK[kind];
  if (!url) throw new Error("Webhook n8n não configurado para kind=" + kind);

  var payload = {
    kind: kind,
    athlete_id: athleteId || null,
    reference_date: referenceDate || null,  // YYYY-MM-DD (data do registro)
    observed_at: iso_(new Date()),          // timestamp do envio
    source: "master_sheet",
    master_sheet_id: MASTER_SHEET_ID || null,

    // debug/trace (pode remover se quiser “enxugar”)
    row: rowObj || null,
    pushed: pushedInfo || null
  };

  postJson_(url, payload);
}

/**
 * CONSTRUCIONAL: mantém payload compatível com seu fluxo (construcional_raw_id + texto).
 * (Se você quiser padronizar 100% no futuro, eu adapto seu n8n para aceitar o payload padrão.)
 */
function sendConstrucionalToN8n(construcionalRawId, athleteId, texto) {
  var payload = { construcional_raw_id: construcionalRawId, athlete_id: athleteId, texto: texto };
  postJson_(N8N_WEBHOOK.construcional, payload);
}

function sendRunScoringToN8n(athleteId, referenceDate) {
  var payload = { athlete_id: athleteId };
  if (referenceDate) payload.reference_date = referenceDate;
  postJson_(N8N_WEBHOOK.run_scoring, payload);
}

/* =========================
   SUPABASE CONFIG / HELPERS
========================= */

function supaCfg_() {
  var props = PropertiesService.getScriptProperties();
  return {
    url: String(props.getProperty("SUPABASE_URL") || "").trim(),
    key: String(props.getProperty("SUPABASE_SERVICE_KEY") || "").trim()
  };
}

function assertSupa_() {
  var cfg = supaCfg_();
  if (!cfg.url || !cfg.key) {
    throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_KEY em Script Properties.");
  }
  return cfg;
}

function supaHeaders_(cfg) {
  return {
    apikey: cfg.key,
    Authorization: "Bearer " + cfg.key,
    Prefer: "return=representation"
  };
}

function supaUrl_(cfg, pathAndQuery) {
  return cfg.url.replace(/\/$/, "") + pathAndQuery;
}

/** GET genérico (retorna array) */
function supaGet_(cfg, table, queryString) {
  var url = supaUrl_(cfg, "/rest/v1/" + encodeURIComponent(table) + (queryString || ""));
  var res = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    headers: supaHeaders_(cfg)
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error("Supabase GET " + table + " failed (" + code + "): " + body);
  }
  try { return JSON.parse(body || "[]"); } catch(e) { return []; }
}

/** INSERT (retorna rows inseridas) */
function supaInsert_(cfg, table, rec) {
  var url = supaUrl_(cfg, "/rest/v1/" + encodeURIComponent(table));
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify([rec]),
    muteHttpExceptions: true,
    headers: supaHeaders_(cfg)
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  Logger.log("SUPABASE insert " + table + " HTTP " + code + " -> " + body);

  if (code < 200 || code >= 300) {
    throw new Error("Supabase INSERT " + table + " failed (" + code + "): " + body);
  }
  try { return JSON.parse(body || "[]"); } catch(e) { return []; }
}

/**
 * PATCH por filtro (idempotência sem precisar unique constraint)
 * ⚠️ Se tiver duplicado no banco, pode atualizar mais de 1 linha.
 */
function supaPatchByFilter_(cfg, table, filterQuery, patchObj) {
  var url = supaUrl_(cfg, "/rest/v1/" + encodeURIComponent(table) + (filterQuery || ""));
  var res = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    payload: JSON.stringify(patchObj),
    muteHttpExceptions: true,
    headers: supaHeaders_(cfg)
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  Logger.log("SUPABASE patch " + table + " HTTP " + code + " -> " + body);

  if (code < 200 || code >= 300) {
    throw new Error("Supabase PATCH " + table + " failed (" + code + "): " + body);
  }
  try { return JSON.parse(body || "[]"); } catch(e) { return []; }
}

/**
 * UPSERT “manual”: se existe (athlete_id + dateField), faz PATCH, senão INSERT
 */
function supaUpsertByAthleteDate_(cfg, table, athleteId, dateField, dateStr, rec) {
  if (!athleteId) throw new Error("supaUpsertByAthleteDate_: athleteId vazio");
  if (!dateStr) throw new Error("supaUpsertByAthleteDate_: dateStr vazio para table=" + table);

  var filter = "?select=id&athlete_id=eq." + encodeURIComponent(athleteId) +
               "&" + encodeURIComponent(dateField) + "=eq." + encodeURIComponent(dateStr) +
               "&limit=1";

  var found = supaGet_(cfg, table, filter);

  if (found && found.length) {
    var patchFilter = "?athlete_id=eq." + encodeURIComponent(athleteId) +
                      "&" + encodeURIComponent(dateField) + "=eq." + encodeURIComponent(dateStr);
    supaPatchByFilter_(cfg, table, patchFilter, rec);
    return { mode: "patch" };
  } else {
    supaInsert_(cfg, table, rec);
    return { mode: "insert" };
  }
}

/**
 * UPSERT via PostgREST (Supabase) usando on_conflict
 * - conflictCols: ["col1","col2"]
 */
function supaUpsert_(cfg, table, rec, conflictCols) {
  if (!conflictCols || !conflictCols.length) {
    throw new Error("supaUpsert_: conflictCols obrigatório");
  }

  var url = supaUrl_(cfg,
    "/rest/v1/" + encodeURIComponent(table) +
    "?on_conflict=" + encodeURIComponent(conflictCols.join(","))
  );

  var headers = supaHeaders_(cfg);
  headers.Prefer = "return=representation,resolution=merge-duplicates";

  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify([rec]),
    muteHttpExceptions: true,
    headers: headers
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  Logger.log("SUPABASE upsert " + table + " HTTP " + code + " -> " + body);

  if (code < 200 || code >= 300) {
    throw new Error("Supabase UPSERT " + table + " failed (" + code + "): " + body);
  }
  try { return JSON.parse(body || "[]"); } catch(e) { return []; }
}

/* =========================
   META (kind + payload)
========================= */

function addMeta_(kind, rowObj) {
  return {
    kind: kind,
    payload: rowObj,
    source: "master_sheet",
    master_sheet_id: (MASTER_SHEET_ID || null)
  };
}

/* =========================
   API HTTP (doGet / doPost)
========================= */

function doGet(e) {
  return routeHttp_(e, "GET");
}

function doPost(e) {
  return routeHttp_(e, "POST");
}

function routeHttp_(e, method) {
  try {
    e = e || {};
    e.parameter = e.parameter || {};

    // Se vier JSON no POST, mescla no e.parameter
    if (method === "POST" && e.postData && e.postData.contents) {
      try {
        var obj = JSON.parse(e.postData.contents);
        if (obj && typeof obj === "object") {
          for (var k in obj) e.parameter[k] = obj[k];
        }
      } catch (errJson) {
        // ignora
      }
    }

    var action = String((e.parameter.action) || "").trim();
    if (!action) return json_({ ok: false, error: "Missing action" });

    if (action === "health") return health_();
    if (action === "analyze_latest") return analyzeLatest_(e);
    if (action === "push_latest") return pushLatest_(e);
    if (action === "push_range") return pushRange_(e);

    return json_({ ok: false, error: "Unknown action", action: action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function health_() {
  var ss = openMaster_();
  var cfg = supaCfg_();
  return json_({
    ok: true,
    masterSheetId: ss.getId(),
    masterSheetUrl: ss.getUrl(),
    tabs: TAB,
    supabaseConfigured: !!(cfg.url && cfg.key),
    n8n_webhooks: N8N_WEBHOOK
  });
}

/**
 * Só calcula (não grava)
 * GET/POST: action=analyze_latest&kind=daily&athlete=...
 */
function analyzeLatest_(e) {
  var kind = reqKind_(e);
  var athlete = req_(e, "athlete");

  var row = latestRow_(kind, athlete);
  if (!row) return json_({ ok: true, kind: kind, athlete: athlete, found: false });

  var ts = getRowTimestamp_(row);
  if (!ts) return json_({ ok: false, error: "Timestamp inválido/ausente no último registro.", kind: kind, athlete: athlete });

  var metrics = computeMetrics_(kind, row);

  return json_({
    ok: true,
    kind: kind,
    athlete: athlete,
    found: true,
    observed_at: iso_(ts),
    metrics: metrics
  });
}

/**
 * Grava o último registro nas tabelas específicas
 * GET/POST: action=push_latest&kind=daily&athlete=...&score=1
 */
function pushLatest_(e) {
  var cfg = assertSupa_();
  var kind = reqKind_(e);
  var athlete = req_(e, "athlete");
  var score = String(e.parameter.score || "").trim() === "1";

  var row = latestRow_(kind, athlete);
  if (!row) return json_({ ok: true, kind: kind, athlete: athlete, found: false, pushed: false });

  var pushedInfo = writeKindToSupabase_(cfg, kind, athlete, row);

  var ts = getRowTimestamp_(row) || new Date();
  var ref = dateOnly_(ts);

  // ✅ webhook específico do kind (exceto construcional, pois já manda payload próprio com id)
  if (kind !== "construcional") {
    sendKindToN8n(kind, athlete, ref, row, pushedInfo);
  }

  // ✅ opcional: chama scoring
  if (score && ALSO_CALL_RUNSCORING_FROM_GAS && kind !== "construcional" && kind !== "registration") {
    sendRunScoringToN8n(athlete, ref);
  }

  return json_({ ok: true, kind: kind, athlete: athlete, found: true, pushed: true, pushedInfo: pushedInfo });
}

/**
 * Grava um range (últimos N dias)
 * GET/POST: action=push_range&kind=daily&athlete=...&days=30&score=0
 */
function pushRange_(e) {
  var cfg = assertSupa_();
  var kind = reqKind_(e);
  var athlete = req_(e, "athlete");

  var days = parseInt(e.parameter.days || "30", 10);
  if (!(days > 0)) days = 30;

  var score = String(e.parameter.score || "").trim() === "1";

  var rows = rowsSince_(kind, athlete, days);
  if (!rows.length) return json_({ ok: true, kind: kind, athlete: athlete, days: days, found: false, pushed: 0 });

  var pushed = 0, errors = [];
  for (var i = 0; i < rows.length; i++) {
    try {
      var info = writeKindToSupabase_(cfg, kind, athlete, rows[i]);
      pushed++;

      var ts = getRowTimestamp_(rows[i]) || new Date();
      var ref = dateOnly_(ts);

      if (kind !== "construcional") {
        sendKindToN8n(kind, athlete, ref, rows[i], info);
      }

      if (score && ALSO_CALL_RUNSCORING_FROM_GAS && kind !== "construcional" && kind !== "registration") {
        sendRunScoringToN8n(athlete, ref);
      }
    } catch (err) {
      errors.push({ index: i, error: String(err && err.message ? err.message : err) });
    }
  }

  return json_({ ok: true, kind: kind, athlete: athlete, days: days, attempted: rows.length, pushed: pushed, errors: errors });
}

/* =========================
   GRAVAÇÃO POR KIND (TABELAS EXISTENTES)
========================= */

function writeKindToSupabase_(cfg, kind, athlete, rowObj) {
  if (kind === "daily")         return writeDaily_(cfg, athlete, rowObj);
  if (kind === "weekly")        return writeWeekly_(cfg, athlete, rowObj);
  if (kind === "quarterly")     return writeQuarterly_(cfg, athlete, rowObj);
  if (kind === "semiannual")    return writeSemiannual_(cfg, athlete, rowObj);
  if (kind === "registration")  return writeRegistration_(cfg, athlete, rowObj);
  if (kind === "construcional") return writeConstrucional_(cfg, athlete, rowObj);

  // ✅ grava no Supabase
  if (kind === "restq_trainer") return writeRestqTrainer_(cfg, athlete, rowObj);

  throw new Error("Unhandled kind: " + kind);
}

function writeRestqTrainer_(cfg, athlete, rowObj) {
  var ts = getRowTimestamp_(rowObj) || new Date();
  var dataStr = dateOnly_(ts);

  var m = restqTrainerMetrics_(rowObj);
  var meta = addMeta_("restq_trainer", rowObj);

  var trainerId = (m.trainer_id || pickByPrefix_(rowObj, ["TR_ID", "TRAINER_ID"]) || "").toString().trim();
  var trainerName = (m.trainer_name || pickByPrefix_(rowObj, ["TR_NAME", "TRAINER_NAME"]) || "").toString().trim();

  if (!trainerId) throw new Error("restq_trainer: trainer_id vazio (TR_ID).");

  var rec = {
    trainer_id: trainerId,
    trainer_name: trainerName || null,
    athlete_id: (athlete || "").toString().trim() || null,
    data: dataStr,
    mean: isFinite(m.mean) ? m.mean : null,

    kind: meta.kind,
    payload: meta.payload,
    source: meta.source,
    master_sheet_id: meta.master_sheet_id
  };

  // ✅ tabela destino: restq_trainer_analysis (deve existir no Supabase)
  supaUpsert_(cfg, "restq_trainer_analysis", rec, ["trainer_id", "data"]);
  return { restq_trainer_analysis: "upsert", data: dataStr, trainer_id: trainerId };
}

/* ----- DAILY -> brums_analysis + diet_daily ----- */
function writeDaily_(cfg, athlete, rowObj) {
  var m = dailyMetrics_(rowObj);

  var ts = getRowTimestamp_(rowObj);
  if (!ts) throw new Error("writeDaily_: timestamp inválido/ausente");
  var dataStr = dateOnly_(ts);

  var meta = addMeta_("daily", rowObj);

  // BRUMS: DTH e DTH-Vigor
  var dth = null;
  if ([m.brums.tension, m.brums.depression, m.brums.anger, m.brums.fatigue, m.brums.confusion].every(function(x){ return x !== null; })) {
    dth = m.brums.tension + m.brums.depression + m.brums.anger + m.brums.fatigue + m.brums.confusion;
  }
  var vigor = m.brums.vigor;
  var dth_minus = (dth !== null && vigor !== null) ? (dth - vigor) : m.brums.tmd;

  // opcionais do form
  var weight = nn_(pickByPrefix_(rowObj, ["DAILY_WEIGHT", "PESO", "WEIGHT"]));
  var prePost = String(pickByPrefix_(rowObj, ["DAILY_MOMENT", "DAILY_PREPOST", "PRE_POST", "MOMENTO"]) || "") || null;
  var modality = String(pickByPrefix_(rowObj, ["DAILY_MODALITY", "MODALIDADE", "MODALITY"]) || "") || null;

  var brumsRec = {
    athlete_id: athlete,
    data: dataStr,

    kind: meta.kind,
    payload: meta.payload,
    source: meta.source,
    master_sheet_id: meta.master_sheet_id,

    dth: dth,
    vigor: vigor,
    dth_minus: dth_minus,
    carga: m.load.sRPE_load,
    weight_kg: isFinite(weight) ? weight : null,
    pre_post_moment: prePost,
    training_modality: modality,
    training_time: m.load.duration_min
  };

  // DIETA: 1..5 => 0..100
  var adh = m.nutrition.adherence_1_5;
  var adhScore = null;
  if (adh !== null && isFinite(adh)) {
    adhScore = (adh <= 5) ? (adh * 20) : adh;
  }

  var lowRaw = String(m.nutrition.low_energy_raw || "").toLowerCase();
  var energyRisk = null;
  if (lowRaw) {
    energyRisk = (lowRaw.indexOf("sim") >= 0 || lowRaw.indexOf("yes") >= 0 || lowRaw.indexOf("true") >= 0 || lowRaw === "1");
  }

  var dietRec = {
    athlete_id: athlete,
    data: dataStr,

    kind: meta.kind,
    payload: meta.payload,
    source: meta.source,
    master_sheet_id: meta.master_sheet_id,

    adherence_score: adhScore,
    missed_meals: m.nutrition.missed_raw || null,
    energy_availability_risk: energyRisk,
    gi_distress: m.nutrition.gi_0_10
  };

  var a = supaUpsertByAthleteDate_(cfg, "brums_analysis", athlete, "data", dataStr, brumsRec);
  var b = supaUpsertByAthleteDate_(cfg, "diet_daily", athlete, "data", dataStr, dietRec);

  return { brums_analysis: a.mode, diet_daily: b.mode, data: dataStr };
}

/* ----- WEEKLY -> weekly_analysis ----- */
function writeWeekly_(cfg, athlete, rowObj) {
  var m = weeklyMetrics_(rowObj);

  // start_date vem do WEEK_START se tiver; senão usa timestamp
  var start = m.week_start ? toDate_(m.week_start) : getRowTimestamp_(rowObj);
  if (!start) throw new Error("writeWeekly_: start_date/timestamp inválido");
  var startStr = dateOnly_(start);

  var meta = addMeta_("weekly", rowObj);

  var perf = m.performance_1_5;
  var adh = m.adherence_1_5;
  var adhScore = (adh !== null && isFinite(adh)) ? ((adh <= 5) ? (adh * 20) : adh) : null;

  var rec = {
    athlete_id: athlete,
    start_date: startStr,

    kind: meta.kind,
    payload: meta.payload,
    source: meta.source,
    master_sheet_id: meta.master_sheet_id,

    desempenho: isFinite(perf) ? perf : null,
    adesao_nutricional: isFinite(adhScore) ? adhScore : null,
    dieta_comentarios: m.nutrition_comments || null,
    cansaco_acao: m.recovery_comments || null,
    semana_comentarios: m.comments || null,
    eventos: m.events || null
  };

  var r = supaUpsertByAthleteDate_(cfg, "weekly_analysis", athlete, "start_date", startStr, rec);
  return { weekly_analysis: r.mode, start_date: startStr };
}

/* ----- QUARTERLY -> acsi_analysis + gses_analysis + pmcsq_analysis + restq_analysis ----- */
function writeQuarterly_(cfg, athlete, rowObj) {
  var m = quarterlyMetrics_(rowObj);

  var ts = getRowTimestamp_(rowObj);
  if (!ts) throw new Error("writeQuarterly_: timestamp inválido/ausente");
  var dataStr = dateOnly_(ts);

  var meta = addMeta_("quarterly", rowObj);

  // ACSI
  var acsiTotal = (m.acsi_total !== null && isFinite(m.acsi_total)) ? m.acsi_total : null;
  var acsiMedia = (acsiTotal !== null) ? (acsiTotal / 28) : null;

  var acsiRec = {
    athlete_id: athlete,
    data: dataStr,

    kind: meta.kind,
    payload: meta.payload,
    source: meta.source,
    master_sheet_id: meta.master_sheet_id,

    media: acsiMedia,
    metas_preparacao: m.acsi.goal_setting.mean,
    relacao_treinador: m.acsi.coachability.mean,
    concentracao: m.acsi.concentration.mean,
    confianca_motivacao: m.acsi.confidence.mean,
    pico_pressao: m.acsi.peaking_pressure.mean,
    adversidade: m.acsi.coping_adversity.mean,
    ausencia_preocupacao: m.acsi.freedom_worry.mean
  };

  function classifyGses_(mean) {
    if (mean === null || mean === undefined || !isFinite(mean)) return null;
    if (mean < 2.5) return "low";
    if (mean < 3.5) return "medium";
    return "high";
  }

  // GSES
  var gsesMean = (m.gses && m.gses.mean !== null) ? m.gses.mean : null;
  var gsesRec = {
    athlete_id: athlete,
    data: dataStr,

    kind: meta.kind,
    payload: meta.payload,
    source: meta.source,
    master_sheet_id: meta.master_sheet_id,

    media: gsesMean,
    autorregulacao: null,
    classification: classifyGses_(gsesMean)
  };

  // PMCSQ
  var pmcsqRec = {
    athlete_id: athlete,
    data: dataStr,

    kind: meta.kind,
    payload: meta.payload,
    source: meta.source,
    master_sheet_id: meta.master_sheet_id,

    clima_tarefa: (m.pmcsq && m.pmcsq.mastery) ? m.pmcsq.mastery.mean : null,
    clima_ego: (m.pmcsq && m.pmcsq.performance) ? m.pmcsq.performance.mean : null,
    coletivo: null,
    clima_treino_desafiador: null,
    clima_ego_preferido: null,
    punicao_erros: null
  };

  // RESTQ
  var restqRec = {
    athlete_id: athlete,
    data: dataStr,

    kind: meta.kind,
    payload: meta.payload,
    source: meta.source,
    master_sheet_id: meta.master_sheet_id,

    media: m.restq_mean,
    sono_bemestar: null,
    problemas_treino: null
  };

  var a = supaUpsertByAthleteDate_(cfg, "acsi_analysis", athlete, "data", dataStr, acsiRec);
  var g = supaUpsertByAthleteDate_(cfg, "gses_analysis", athlete, "data", dataStr, gsesRec);
  var p = supaUpsertByAthleteDate_(cfg, "pmcsq_analysis", athlete, "data", dataStr, pmcsqRec);
  var r = supaUpsertByAthleteDate_(cfg, "restq_analysis", athlete, "data", dataStr, restqRec);

  return { data: dataStr, acsi: a.mode, gses: g.mode, pmcsq: p.mode, restq: r.mode };
}

/* ----- SEMIANNUAL -> cbas_analysis ----- */
function writeSemiannual_(cfg, athlete, rowObj) {
  var m = semiannualMetrics_(rowObj);

  var ts = getRowTimestamp_(rowObj);
  if (!ts) throw new Error("writeSemiannual_: timestamp inválido/ausente");
  var dataStr = dateOnly_(ts);

  var meta = addMeta_("semiannual", rowObj);

  var rec = {
    athlete_id: athlete,
    data: dataStr,

    kind: meta.kind,
    payload: meta.payload,
    source: meta.source,
    master_sheet_id: meta.master_sheet_id,

    tecnica: m.technique_mean,
    planejamento: m.planning_mean,
    motivacional: m.motivational_mean,
    relacao: m.relation_mean,
    aversivos: m.aversives_mean,
    tecnica_chave: null,
    planejamento_chave: null,
    motivacional_chave: null,
    relacao_chave: null,
    aversivos_chave: null
  };

  var x = supaUpsertByAthleteDate_(cfg, "cbas_analysis", athlete, "data", dataStr, rec);
  return { cbas_analysis: x.mode, data: dataStr };
}

/* ----- REGISTRATION -> athlete_registration (histórico) ----- */
function writeRegistration_(cfg, athlete, rowObj) {
  var ts = getRowTimestamp_(rowObj);
  if (!ts) throw new Error("writeRegistration_: timestamp inválido/ausente");
  var dataStr = dateOnly_(ts);

  var meta = addMeta_("registration", rowObj);
  var rm = registrationMetrics_(rowObj);

  var iw = nn_(pickByPrefix_(rowObj, ["REG_IDEAL_WEIGHT", "IDEAL_WEIGHT", "PESO_IDEAL", "Peso ideal para a modalidade (kg)"]));
  if (!isFinite(iw)) iw = null;

  var rec = {
    athlete_id: athlete,
    data: dataStr,

    kind: meta.kind,
    payload: meta.payload,
    source: meta.source,
    master_sheet_id: meta.master_sheet_id,

    athlete_name: rm.athlete_name || null,
    team_name: rm.team_name || null,
    athlete_phone: rm.athlete_phone || null,
    coach_phone: rm.coach_phone || null,

    ideal_weight_kg: iw
  };

  // histórico: sempre INSERT
  supaInsert_(cfg, "athlete_registration", rec);

  return { athlete_registration: "insert", data: dataStr };
}

/* ----- CONSTRUCIONAL -> construcional_raw + webhook n8n ----- */
function writeConstrucional_(cfg, athlete, rowObj) {
  var texto = String(pickByPrefix_(rowObj, ["CONS_TXT", "CONSTRUCIONAL_TXT", "TEXTO"]) || "").trim();

  var b1 = String(pickByPrefix_(rowObj, ["CONS_BLOCO_1", "BLOCO_1"]) || "").trim() || null;
  var b2 = String(pickByPrefix_(rowObj, ["CONS_BLOCO_2", "BLOCO_2"]) || "").trim() || null;
  var b3 = String(pickByPrefix_(rowObj, ["CONS_BLOCO_3", "BLOCO_3"]) || "").trim() || null;
  var b4 = String(pickByPrefix_(rowObj, ["CONS_BLOCO_4", "BLOCO_4"]) || "").trim() || null;

  if (!b1 && texto) b1 = texto;

  var meta = addMeta_("construcional", rowObj);

  var rec = {
    athlete_id: athlete,
    submitted_at: iso_(new Date()),

    kind: meta.kind,
    payload: meta.payload,
    source: meta.source,
    master_sheet_id: meta.master_sheet_id,

    bloco_1: b1,
    bloco_2: b2,
    bloco_3: b3,
    bloco_4: b4,
    status: "sent_to_n8n",
    last_error: null
  };

  var inserted = supaInsert_(cfg, "construcional_raw", rec);
  var id = (inserted && inserted[0] && inserted[0].id) ? inserted[0].id : null;

  // mantém payload específico do seu fluxo
  sendConstrucionalToN8n(id, athlete, texto || b1 || "");

  return { construcional_raw: "insert", id: id };
}

/* =========================
   CÁLCULO DE MÉTRICAS
========================= */

function computeMetrics_(kind, row) {
  if (kind === "daily") return dailyMetrics_(row);
  if (kind === "weekly") return weeklyMetrics_(row);
  if (kind === "quarterly") return quarterlyMetrics_(row);
  if (kind === "semiannual") return semiannualMetrics_(row);
  if (kind === "restq_trainer") return restqTrainerMetrics_(row);
  if (kind === "registration") return registrationMetrics_(row);
  if (kind === "construcional") return { note: "construcional é texto/raw + n8n" };
  throw new Error("Unhandled kind: " + kind);
}

/* ----- DAILY METRICS ----- */
function dailyMetrics_(row) {
  var ts = iso_(getRowTimestamp_(row) || new Date());

  var rpe = n_(pickByPrefix_(row, "DAILY_RPE"));
  var dur = n_(pickByPrefix_(row, "DAILY_DUR"));
  var load = (isFinite(rpe) && isFinite(dur)) ? rpe * dur : null;

  var adherence = n_(pickByPrefix_(row, "DAILY_ADH"));
  var gi = n_(pickByPrefix_(row, "DAILY_GI"));
  var missed = String(pickByPrefix_(row, "DAILY_MISSED") || "");
  var lowEnergy = String(pickByPrefix_(row, "DAILY_LOW") || "");

  var vigorVals = [];
  for (var i = 1; i <= 4; i++) {
    var v = n_(pickByPrefix_(row, "VIGOR_Q" + String(i).padStart(2, '0')));
    if (isFinite(v)) vigorVals.push(v);
  }
  var vigorMean = vigorVals.length ? vigorVals.reduce(function(a,b){ return a+b; }, 0) / vigorVals.length : null;

  var br = [];
  for (var j = 1; j <= 24; j++) {
    var vj = n_(pickByPrefix_(row, "BRUMS_Q" + String(j).padStart(2, '0')));
    br.push(isFinite(vj) ? vj : null);
  }

  function sumRange(arr, start, end) {
    var s = 0;
    for (var k = start; k <= end; k++) {
      if (!isFinite(arr[k])) return null;
      s += arr[k];
    }
    return s;
  }

  var tension = sumRange(br, 0, 3);
  var depression = sumRange(br, 4, 7);
  var anger = sumRange(br, 8, 11);
  var vigorSum = sumRange(br, 12, 15);
  var fatigue = sumRange(br, 16, 19);
  var confusion = sumRange(br, 20, 23);

  var tmd = null;
  if ([tension, depression, anger, vigorSum, fatigue, confusion].every(function(x){ return x !== null; })) {
    tmd = (tension + depression + anger + fatigue + confusion) - vigorSum;
  }

  return {
    timestamp: ts,
    load: {
      rpe: isFinite(rpe) ? rpe : null,
      duration_min: isFinite(dur) ? dur : null,
      sRPE_load: load
    },
    nutrition: {
      adherence_1_5: isFinite(adherence) ? adherence : null,
      gi_0_10: isFinite(gi) ? gi : null,
      missed_raw: missed || null,
      low_energy_raw: lowEnergy || null
    },
    vigor: isFinite(vigorMean) ? vigorMean : null,
    brums: {
      tension: tension,
      depression: depression,
      anger: anger,
      vigor: vigorSum,
      fatigue: fatigue,
      confusion: confusion,
      tmd: tmd
    }
  };
}

/* ----- WEEKLY METRICS ----- */
function weeklyMetrics_(row) {
  return {
    timestamp: iso_(getRowTimestamp_(row) || new Date()),
    week_start: pickByPrefix_(row, "WEEK_START") || null,
    performance_1_5: nn_(pickByPrefix_(row, "WEEK_PERF")),
    recovery_comments: pickByPrefix_(row, "WEEK_RECOVERY") || null,
    comments: pickByPrefix_(row, "WEEK_COMMENTS") || null,
    adherence_1_5: nn_(pickByPrefix_(row, "WEEK_ADH")),
    nutrition_comments: pickByPrefix_(row, "WEEK_NUTR_COMMENTS") || null,
    events: pickByPrefix_(row, "WEEK_EVENTS") || null
  };
}

/* ----- QUARTERLY METRICS ----- */
function quarterlyMetrics_(row) {
  var ts = iso_(getRowTimestamp_(row) || new Date());

  // GSES – 10 itens (1–5)
  var gsesVals = [];
  for (var i = 1; i <= 10; i++) {
    var v = n_(pickByPrefix_(row, "GSES_Q" + String(i).padStart(2, '0')));
    if (isFinite(v)) gsesVals.push(v);
  }
  var gsesSum = gsesVals.reduce(function(a,b){ return a + b; }, 0);
  var gsesMean = gsesVals.length ? gsesSum / gsesVals.length : null;

  // ACSI-28
  var acsiVals = [];
  for (var j = 1; j <= 28; j++) {
    var val = n_(pickByPrefix_(row, "ACSI_Q" + String(j).padStart(2, '0')));
    if (isFinite(val)) {
      // Itens reversos: 7,12,19,23 (escala 0..3) => invert = 3 - val
      if (j === 7 || j === 12 || j === 19 || j === 23) val = 3 - val;
      acsiVals[j] = val;
    } else {
      acsiVals[j] = null;
    }
  }

  function acsiSub(ids) {
    var arr = ids.map(function(idx){ return acsiVals[idx]; });
    if (arr.some(function(x){ return !isFinite(x); })) return { sum: null, mean: null };
    var s = arr.reduce(function(a,b){ return a+b; }, 0);
    return { sum: s, mean: s / arr.length };
  }

  var acsi = {
    goal_setting: acsiSub([1,8,13,20]),
    confidence: acsiSub([2,9,14,26]),
    coachability: acsiSub([3,10,15,27]),
    concentration: acsiSub([4,11,16,25]),
    coping_adversity: acsiSub([5,17,21,24]),
    peaking_pressure: acsiSub([6,18,22,28]),
    freedom_worry: acsiSub([7,12,19,23])
  };

  var acsiTotal = null;
  if (acsiVals.slice(1).every(function(x){ return isFinite(x); })) {
    acsiTotal = acsiVals.slice(1).reduce(function(a,b){ return a + b; }, 0);
  }

  // PMCSQ – 34 itens
  var pmcVals = [];
  for (var k = 1; k <= 34; k++) {
    var vpm = n_(pickByPrefix_(row, "PMCSQ_Q" + String(k).padStart(2, '0')));
    pmcVals[k] = isFinite(vpm) ? vpm : null;
  }

  function pmcSub(start, end) {
    var subset = [];
    for (var t = start; t <= end; t++) {
      if (!isFinite(pmcVals[t])) return { sum: null, mean: null };
      subset.push(pmcVals[t]);
    }
    var s = subset.reduce(function(a,b){ return a + b; }, 0);
    return { sum: s, mean: s / subset.length };
  }

  var pmcsq = {
    mastery: pmcSub(1, 16),
    performance: pmcSub(17, 34)
  };

  // RESTQ – 50 itens
  var restqVals = [];
  for (var r = 1; r <= 50; r++) {
    var vr = n_(pickByPrefix_(row, "RESTQA_Q" + String(r).padStart(2, '0')));
    if (isFinite(vr)) restqVals.push(vr);
  }
  var restqMean = restqVals.length ? restqVals.reduce(function(a,b){ return a + b; }, 0) / restqVals.length : null;

  return {
    timestamp: ts,
    gses: { sum: isFinite(gsesSum) ? gsesSum : null, mean: isFinite(gsesMean) ? gsesMean : null },
    acsi: acsi,
    acsi_total: acsiTotal,
    pmcsq: pmcsq,
    restq_mean: restqMean
  };
}

/* ----- SEMIANNUAL METRICS ----- */
function semiannualMetrics_(row) {
  var ts = iso_(getRowTimestamp_(row) || new Date());

  function blockMean(prefix, count) {
    var vals = [];
    for (var i = 1; i <= count; i++) {
      var v = n_(pickByPrefix_(row, prefix + "_Q" + String(i).padStart(2, '0')));
      if (isFinite(v)) vals.push(v); else return null;
    }
    var sum = vals.reduce(function(a,b){ return a + b; }, 0);
    return sum / vals.length;
  }

  return {
    timestamp: ts,
    coach_name: pickByPrefix_(row, "SEMI_COACH_NAME") || null,
    team: pickByPrefix_(row, "SEMI_TEAM") || null,
    period: pickByPrefix_(row, "SEMI_PERIOD") || null,
    technique_mean: blockMean("SEMI_TECH", 7),
    planning_mean: blockMean("SEMI_PLAN", 7),
    motivational_mean: blockMean("SEMI_MOTIV", 7),
    relation_mean: blockMean("SEMI_REL", 9),
    aversives_mean: blockMean("SEMI_AVERS", 7)
  };
}

/* ----- RESTQ TRAINER METRICS ----- */
function restqTrainerMetrics_(row) {
  var ts = iso_(getRowTimestamp_(row) || new Date());

  var vals = [];
  for (var i = 1; i <= 32; i++) {
    var v = n_(pickByPrefix_(row, 'TR_RESTQ_Q' + String(i).padStart(2, '0')));
    if (isFinite(v)) vals.push(v);
  }
  var mean = vals.length ? vals.reduce(function(a,b){ return a+b; }, 0) / vals.length : null;

  return {
    timestamp: ts,
    trainer_id: pickByPrefix_(row, "TR_ID") || null,
    trainer_name: pickByPrefix_(row, "TR_NAME") || null,
    mean: mean
  };
}

/* ----- REGISTRATION METRICS ----- */
function registrationMetrics_(row) {
  var athleteName = String(pickByPrefix_(row, ["REG_ATHLETE_NAME", "REG_NAME", "ATHLETE_NAME", "NOME_ATLETA", "Nome completo"]) || "").trim();
  var teamName = String(pickByPrefix_(row, [
    "REG_TEAM_NAME", "TEAM_NAME", "NOME_TIME", "TIME",
    "Clube atual / equipe / centro de treinamento",
    "Clube atual", "Equipe", "Time"
  ]) || "").trim();

  return {
    timestamp: iso_(getRowTimestamp_(row) || new Date()),
    athlete_name: athleteName || null,
    team_name: teamName || null,
    athlete_phone: normPhone_(pickByPrefix_(row, ["REG_ATHLETE_PHONE", "ATHLETE_PHONE"])),
    coach_phone: normPhone_(pickByPrefix_(row, ["REG_COACH_PHONE", "COACH_PHONE"]))
  };
}

/* =========================
   SHEETS UTILITIES
========================= */

function openMaster_() {
  var sid = (MASTER_SHEET_ID || "").trim();
  if (!sid) sid = String(PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID") || "").trim();
  if (!sid) throw new Error("Defina MASTER_SHEET_ID ou armazene MASTER_SHEET_ID em Script Properties.");
  MASTER_SHEET_ID = sid; // garante que meta.master_sheet_id vá preenchido
  return SpreadsheetApp.openById(sid);
}

function sheet_(kind) {
  var ss = openMaster_();
  var name = TAB[kind];
  if (!name) throw new Error("Invalid kind: " + kind);
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error("Tab not found for kind=" + kind + ": " + name);
  return sh;
}

function table_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return { headers: [], rows: [] };

  var headers = values[0].map(function(h){ return String(h || "").trim(); });
  var rows = [];

  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = values[i][c];
    rows.push(obj);
  }

  return { headers: headers, rows: rows };
}

/** extrai athleteId do row conforme kind (registration aceita REG_ID/REG_DOC) */
function athleteIdFromRow_(kind, rowObj) {
  if (kind === "registration") {
    var cpf = String(pickByPrefix_(rowObj, ["REG_DOC", "CPF", "Documento (CPF)"]) || "").replace(/\D/g, "");
    if (cpf) return cpf;
    var rid = String(pickByPrefix_(rowObj, ["REG_ID", "ID interno", "ID do atleta"]) || "").trim();
    if (rid) return rid;
  }
  var aid = String(pickByPrefix_(rowObj, [COL.athleteId, "ATHLETE_ID", "ID do atleta"]) || "").trim();
  return aid || "";
}

function latestRow_(kind, athlete) {
  var sh = sheet_(kind);
  var tbl = table_(sh);

  var rows = tbl.rows
    .filter(function(r){
      return athleteIdFromRow_(kind, r) === athlete;
    })
    .sort(function(a,b){
      var ta = getRowTimestamp_(a);
      var tb = getRowTimestamp_(b);
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return tb - ta; // desc
    });

  return rows.length ? rows[0] : null;
}

function rowsSince_(kind, athlete, days) {
  var sh = sheet_(kind);
  var since = new Date();
  since.setDate(since.getDate() - days);

  var tbl = table_(sh);

  return tbl.rows
    .filter(function(r){
      var aid = athleteIdFromRow_(kind, r);
      var ts  = getRowTimestamp_(r);
      return aid === athlete && ts && ts >= since;
    })
    .sort(function(a,b){
      var ta = getRowTimestamp_(a);
      var tb = getRowTimestamp_(b);
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return ta - tb; // asc
    });
}

/* =========================
   TRIGGER (Form Submit) – instalar / limpar
========================= */

/** Cria o trigger se não existir (evita duplicar). */
function ensureOnFormSubmitTrigger() {
  var ss = openMaster_();
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    var t = all[i];
    if (t.getHandlerFunction && t.getHandlerFunction() === "onFormSubmitMaster_" &&
        t.getEventType && t.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT) {
      Logger.log("Trigger já existe: onFormSubmitMaster_");
      return;
    }
  }
  ScriptApp.newTrigger("onFormSubmitMaster_")
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
  Logger.log("Trigger criado: onFormSubmitMaster_");
}

/** Remove TODOS os triggers do handler (útil se duplicou). */
function deleteOnFormSubmitTriggers() {
  var all = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < all.length; i++) {
    var t = all[i];
    if (t.getHandlerFunction && t.getHandlerFunction() === "onFormSubmitMaster_") {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  }
  Logger.log("Triggers removidos: " + removed);
}

/** Handler do trigger da planilha mãe */
function onFormSubmitMaster_(e) {
  try {
    var cfg = assertSupa_();
    if (!e || !e.range) {
      Logger.log("onFormSubmitMaster_: evento sem range");
      return;
    }

    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    var rowIndex = e.range.getRow();

    // lê cabeçalhos e linha submetida
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var values  = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];

    var rowObj = {};
    for (var i = 0; i < headers.length; i++) rowObj[String(headers[i] || "").trim()] = values[i];

    // timestamp robusto
    var ts = getRowTimestamp_(rowObj);
    if (!ts) {
      Logger.log("onFormSubmitMaster_: timestamp inválido/ausente. Cheque cabeçalho do Forms.");
      return;
    }
    var ref = dateOnly_(ts);

    if (sheetName === TAB.daily) {
      var athlete = athleteIdFromRow_("daily", rowObj);
      if (!athlete) { Logger.log("onFormSubmitMaster_: ATHLETE_ID vazio (daily)"); return; }

      var info = writeDaily_(cfg, athlete, rowObj);

      sendKindToN8n("daily", athlete, ref, rowObj, info);
      if (ALSO_CALL_RUNSCORING_FROM_GAS) sendRunScoringToN8n(athlete, ref);

    } else if (sheetName === TAB.weekly) {
      var athlete2 = athleteIdFromRow_("weekly", rowObj);
      if (!athlete2) { Logger.log("onFormSubmitMaster_: ATHLETE_ID vazio (weekly)"); return; }

      var info2 = writeWeekly_(cfg, athlete2, rowObj);

      sendKindToN8n("weekly", athlete2, ref, rowObj, info2);
      if (ALSO_CALL_RUNSCORING_FROM_GAS) sendRunScoringToN8n(athlete2, ref);

    } else if (sheetName === TAB.quarterly) {
      var athlete3 = athleteIdFromRow_("quarterly", rowObj);
      if (!athlete3) { Logger.log("onFormSubmitMaster_: ATHLETE_ID vazio (quarterly)"); return; }

      var info3 = writeQuarterly_(cfg, athlete3, rowObj);

      sendKindToN8n("quarterly", athlete3, ref, rowObj, info3);
      if (ALSO_CALL_RUNSCORING_FROM_GAS) sendRunScoringToN8n(athlete3, ref);

    } else if (sheetName === TAB.semiannual) {
      var athlete4 = athleteIdFromRow_("semiannual", rowObj);
      if (!athlete4) { Logger.log("onFormSubmitMaster_: ATHLETE_ID vazio (semiannual)"); return; }

      var info4 = writeSemiannual_(cfg, athlete4, rowObj);

      sendKindToN8n("semiannual", athlete4, ref, rowObj, info4);
      if (ALSO_CALL_RUNSCORING_FROM_GAS) sendRunScoringToN8n(athlete4, ref);

    } else if (sheetName === TAB.registration) {
      var athlete5 = athleteIdFromRow_("registration", rowObj);
      if (!athlete5) { Logger.log("onFormSubmitMaster_: REG_DOC/REG_ID vazio (registration)"); return; }

      var info5 = writeRegistration_(cfg, athlete5, rowObj);

      sendKindToN8n("registration", athlete5, ref, rowObj, info5);

    } else if (sheetName === TAB.construcional) {
      var athlete6 = athleteIdFromRow_("construcional", rowObj);
      if (!athlete6) { Logger.log("onFormSubmitMaster_: ATHLETE_ID vazio (construcional)"); return; }

      // writeConstrucional_ já chama webhook específico com construcional_raw_id
      writeConstrucional_(cfg, athlete6, rowObj);

    } else if (sheetName === TAB.restq_trainer) {
      var athlete7 = athleteIdFromRow_("restq_trainer", rowObj); // pode vir vazio; ok
      var info7 = writeKindToSupabase_(cfg, "restq_trainer", athlete7 || "", rowObj);

      sendKindToN8n("restq_trainer", athlete7 || null, ref, rowObj, info7);
      // normalmente não roda scoring aqui (depende do seu motor)
    }

  } catch (err) {
    Logger.log("onFormSubmitMaster_ ERROR: " + err);
  }
}

/* =========================
   PICK / TIMESTAMP (ROBUSTO)
========================= */

function pickByPrefix_(row, prefixOrList) {
  if (!row) return "";

  var prefixes = Array.isArray(prefixOrList) ? prefixOrList : [prefixOrList];
  prefixes = prefixes
    .map(function(p){ return String(p || "").trim(); })
    .filter(function(p){ return !!p; });

  if (!prefixes.length) return "";

  var keys = Object.keys(row);

  function norm_(s) {
    s = String(s || "");
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, ""); // zero-width/BOM
    s = s.trim().toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch(e) {}
    s = s.replace(/\s+/g, " ");
    return s;
  }

  var seps = ["|", ":", "–", "-", "—"];

  function matchKey_(keyNorm, pNorm) {
    if (!pNorm) return false;
    if (keyNorm === pNorm) return true;

    for (var i = 0; i < seps.length; i++) {
      var sep = seps[i];
      if (keyNorm.indexOf(pNorm + " " + sep) === 0) return true;
      if (keyNorm.indexOf(pNorm + sep) === 0) return true;
    }
    return false;
  }

  // 1) matches fortes
  for (var pi = 0; pi < prefixes.length; pi++) {
    var p = prefixes[pi];
    var pNorm = norm_(p);

    for (var ki = 0; ki < keys.length; ki++) {
      var k = keys[ki];
      var kNorm = norm_(k);
      if (matchKey_(kNorm, pNorm)) return row[k];
    }
  }

  // 2) fallback contém
  for (var pj = 0; pj < prefixes.length; pj++) {
    var p2 = prefixes[pj];
    var p2Norm = norm_(p2);
    if (p2Norm.length < 6) continue;

    var p2Soft = p2Norm.replace(/_/g, " ");

    for (var kj = 0; kj < keys.length; kj++) {
      var kk = keys[kj];
      var kkNorm = norm_(kk);
      if (kkNorm.indexOf(p2Norm) >= 0 || kkNorm.indexOf(p2Soft) >= 0) return row[kk];
    }
  }

  return "";
}

function getRowTimestamp_(rowObj) {
  var raw = pickByPrefix_(rowObj, [
    COL.timestamp,
    "Timestamp",
    "Carimbo",
    "Data/Hora",
    "Data e hora",
    "Submitted at",
    "Submission time"
  ]);

  if (!raw && rowObj && rowObj[COL.timestamp] != null) raw = rowObj[COL.timestamp];

  var d = toDate_(raw);
  return d;
}

/* =========================
   UTILS
========================= */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

function req_(e, name) {
  var v = String((e.parameter && e.parameter[name]) || "").trim();
  if (!v) throw new Error("Missing param: " + name);
  return v;
}

function reqKind_(e) {
  var k = String((e.parameter && e.parameter.kind) || "").trim();
  if (!k || !TAB[k]) throw new Error("Missing or invalid kind");
  return k;
}

function n_(x) {
  if (x === null || x === undefined) return NaN;
  if (typeof x === "number") return x;
  var s = String(x).trim().replace(",", ".");
  var n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

function nn_(x) {
  var v = n_(x);
  return isFinite(v) ? v : null;
}

/** IMPORTANTE: se inválido, retorna null (evita 1969-12-31) */
function toDate_(x) {
  if (x instanceof Date) return x;
  if (x === null || x === undefined || x === "") return null;
  var d = new Date(x);
  return isNaN(d.getTime()) ? null : d;
}

function iso_(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function dateOnly_(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function normPhone_(raw) {
  if (!raw) return "";
  var d = String(raw).replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) return "+55" + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return "+" + d;
  return d.startsWith("55") ? "+" + d : "+55" + d;
}

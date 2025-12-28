/**
 * MINDS Performance – API de Análise (Supabase tabelas específicas + triggers + n8n)
 *
 * ✅ Grava nas tabelas existentes:
 * brums_analysis, diet_daily, weekly_analysis, acsi_analysis, gses_analysis,
 * pmcsq_analysis, restq_analysis, cbas_analysis, athlete_registration, construcional_raw
 *
 * ✅ Script Properties obrigatórias:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_KEY
 *
 * (Não usa mais SUPABASE_TABLE_METRICS / SUPABASE_TABLE_ROSTER)
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
   N8N
========================= */

var N8N_CONSTRUCIONAL_WEBHOOK_URL = "https://autowebhook.opingo.com.br/webhook/Construcional";
var N8N_RUNSCORING_WEBHOOK_URL   = "https://autowebhook.opingo.com.br/webhook/RunScoring";

function sendConstrucionalToN8n(construcionalRawId, athleteId, texto) {
  var payload = { construcional_raw_id: construcionalRawId, athlete_id: athleteId, texto: texto };
  var options = { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true };
  var response = UrlFetchApp.fetch(N8N_CONSTRUCIONAL_WEBHOOK_URL, options);
  Logger.log("Construcional webhook status: " + response.getResponseCode() + " body=" + response.getContentText());
}

function sendRunScoringToN8n(athleteId, referenceDate) {
  var payload = { athlete_id: athleteId };
  if (referenceDate) payload.reference_date = referenceDate;
  var options = { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true };
  var response = UrlFetchApp.fetch(N8N_RUNSCORING_WEBHOOK_URL, options);
  Logger.log("RunScoring webhook status: " + response.getResponseCode() + " body=" + response.getContentText());
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

/**
 * GET genérico (retorna array)
 */
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

/**
 * INSERT (retorna rows inseridas)
 */
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

/* =========================
   API HTTP (doGet)
========================= */

function doGet(e) {
  try {
    var action = String((e && e.parameter && e.parameter.action) || "").trim();
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
    supabaseConfigured: !!(cfg.url && cfg.key)
  });
}

/**
 * Só calcula (não grava)
 * GET: ?action=analyze_latest&kind=daily&athlete=...
 */
function analyzeLatest_(e) {
  var kind = reqKind_(e);
  var athlete = req_(e, "athlete");
  var row = latestRow_(kind, athlete);
  if (!row) return json_({ ok: true, kind: kind, athlete: athlete, found: false });

  var metrics = computeMetrics_(kind, row);
  return json_({
    ok: true,
    kind: kind,
    athlete: athlete,
    found: true,
    observed_at: iso_(toDate_(row[COL.timestamp])),
    metrics: metrics
  });
}

/**
 * Grava o último registro nas tabelas específicas
 * GET: ?action=push_latest&kind=daily&athlete=...&score=1
 */
function pushLatest_(e) {
  var cfg = assertSupa_();
  var kind = reqKind_(e);
  var athlete = req_(e, "athlete");
  var score = String(e.parameter.score || "").trim() === "1";

  var row = latestRow_(kind, athlete);
  if (!row) return json_({ ok: true, kind: kind, athlete: athlete, found: false, pushed: false });

  var pushedInfo = writeKindToSupabase_(cfg, kind, athlete, row);

  if (score && kind !== "construcional" && kind !== "registration") {
    var refDate = dateOnly_(toDate_(row[COL.timestamp]));
    sendRunScoringToN8n(athlete, refDate);
  }

  return json_({ ok: true, kind: kind, athlete: athlete, found: true, pushed: true, pushedInfo: pushedInfo });
}

/**
 * Grava um range (últimos N dias)
 * GET: ?action=push_range&kind=daily&athlete=...&days=30&score=0
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
      writeKindToSupabase_(cfg, kind, athlete, rows[i]);
      pushed++;
      if (score && kind !== "construcional" && kind !== "registration") {
        var refDate = dateOnly_(toDate_(rows[i][COL.timestamp]));
        sendRunScoringToN8n(athlete, refDate);
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
  if (kind === "daily")        return writeDaily_(cfg, athlete, rowObj);
  if (kind === "weekly")       return writeWeekly_(cfg, athlete, rowObj);
  if (kind === "quarterly")    return writeQuarterly_(cfg, athlete, rowObj);
  if (kind === "semiannual")   return writeSemiannual_(cfg, athlete, rowObj);
  if (kind === "registration") return writeRegistration_(cfg, athlete, rowObj);
  if (kind === "construcional")return writeConstrucional_(cfg, athlete, rowObj);

  // restq_trainer: não existe tabela no seu DDL (pelo que você colou)
  // então eu só calculo e log, sem gravar.
  if (kind === "restq_trainer") {
    var m = restqTrainerMetrics_(rowObj);
    Logger.log("restq_trainer métricas calculadas (sem tabela destino): " + JSON.stringify(m));
    return { note: "restq_trainer sem tabela destino (não gravou)" };
  }

  throw new Error("Unhandled kind: " + kind);
}

/* ----- DAILY -> brums_analysis + diet_daily ----- */
function writeDaily_(cfg, athlete, rowObj) {
  var m = dailyMetrics_(rowObj);
  var d = toDate_(rowObj[COL.timestamp]);
  var dataStr = dateOnly_(d);

  // BRUMS
  var dth = null;
  if ([m.brums.tension, m.brums.depression, m.brums.anger, m.brums.fatigue, m.brums.confusion].every(function(x){ return x !== null; })) {
    dth = m.brums.tension + m.brums.depression + m.brums.anger + m.brums.fatigue + m.brums.confusion;
  }
  var vigor = m.brums.vigor;
  var dth_minus = (dth !== null && vigor !== null) ? (dth - vigor) : m.brums.tmd;

  var weight = nn_(pickByPrefix_(rowObj, "DAILY_WEIGHT")); // opcional, se existir no seu form
  var prePost = String(pickByPrefix_(rowObj, "DAILY_PREPOST") || "") || null;
  var modality = String(pickByPrefix_(rowObj, "DAILY_MODALITY") || "") || null;

  var brumsRec = {
    athlete_id: athlete,
    data: dataStr,
    dth: dth,
    vigor: vigor,
    dth_minus: dth_minus,
    carga: m.load.sRPE_load,
    weight_kg: isFinite(weight) ? weight : null,
    pre_post_moment: prePost,
    training_modality: modality,
    training_time: m.load.duration_min
  };

  // DIETA
  // converte 1..5 para 0..100 (compatível com diet_daily_view que usa 80/60)
  var adh = m.nutrition.adherence_1_5;
  var adhScore = null;
  if (adh !== null && isFinite(adh)) {
    adhScore = (adh <= 5) ? (adh * 20) : adh; // se já vier em %, mantém
  }

  var lowRaw = String(m.nutrition.low_energy_raw || "").toLowerCase();
  var energyRisk = null;
  if (lowRaw) {
    energyRisk = (lowRaw.indexOf("sim") >= 0 || lowRaw.indexOf("yes") >= 0 || lowRaw.indexOf("true") >= 0 || lowRaw === "1");
  }

  var dietRec = {
    athlete_id: athlete,
    data: dataStr,
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

  // start_date vem do WEEK_START se tiver; senão usa data do carimbo
  var start = m.week_start ? toDate_(m.week_start) : toDate_(rowObj[COL.timestamp]);
  var startStr = dateOnly_(start);

  var perf = m.performance_1_5;
  var adh = m.adherence_1_5;
  var adhScore = (adh !== null && isFinite(adh)) ? ((adh <= 5) ? (adh * 20) : adh) : null;

  var rec = {
    athlete_id: athlete,
    start_date: startStr,
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
  var d = toDate_(rowObj[COL.timestamp]);
  var dataStr = dateOnly_(d);

  // ACSI
  var acsiTotal = null;
  if (m.acsi_total !== null && isFinite(m.acsi_total)) {
    acsiTotal = m.acsi_total;
  }
  var acsiMedia = (acsiTotal !== null) ? (acsiTotal / 28) : null;

  var acsiRec = {
    athlete_id: athlete,
    data: dataStr,
    media: acsiMedia,
    metas_preparacao: m.acsi.goal_setting.mean,
    relacao_treinador: m.acsi.coachability.mean,
    concentracao: m.acsi.concentration.mean,
    confianca_motivacao: m.acsi.confidence.mean,
    pico_pressao: m.acsi.peaking_pressure.mean,
    adversidade: m.acsi.coping_adversity.mean,
    ausencia_preocupacao: m.acsi.freedom_worry.mean
  };

  // GSES
  var gsesRec = {
    athlete_id: athlete,
    data: dataStr,
    media: (m.gses && m.gses.mean !== null) ? m.gses.mean : null,
    autorregulacao: null
  };

  // PMCSQ (mapeando mastery/performance)
  var pmcsqRec = {
    athlete_id: athlete,
    data: dataStr,
    clima_tarefa: (m.pmcsq && m.pmcsq.mastery) ? m.pmcsq.mastery.mean : null,
    clima_ego: (m.pmcsq && m.pmcsq.performance) ? m.pmcsq.performance.mean : null,
    coletivo: null,
    clima_treino_desafiador: null,
    clima_ego_preferido: null,
    punicao_erros: null
  };

  // RESTQ (só média geral aqui)
  var restqRec = {
    athlete_id: athlete,
    data: dataStr,
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
  var d = toDate_(rowObj[COL.timestamp]);
  var dataStr = dateOnly_(d);

  var rec = {
    athlete_id: athlete,
    data: dataStr,
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

/* ----- REGISTRATION -> athlete_registration ----- */
function writeRegistration_(cfg, athlete, rowObj) {
  var d = toDate_(rowObj[COL.timestamp]);
  var dataStr = dateOnly_(d);

  // payload bruto do form (guarda tudo)
  var payload = rowObj;

  // ideal_weight (se existir no form)
  var iw = nn_(pickByPrefix_(rowObj, "REG_IDEAL_WEIGHT"));
  if (!isFinite(iw)) iw = null;

  var rec = {
    athlete_id: athlete,
    data: dataStr,
    payload: payload,
    ideal_weight_kg: iw
  };

  // athlete_registration não tem “data unique”, então aqui fazemos INSERT sempre
  // (é histórico). Se você quiser “só o último”, eu adapto para upsert por data.
  supaInsert_(cfg, "athlete_registration", rec);

  return { athlete_registration: "insert", data: dataStr };
}

/* ----- CONSTRUCIONAL -> construcional_raw + webhook n8n (com id) ----- */
function writeConstrucional_(cfg, athlete, rowObj) {
  var texto = String(rowObj["CONS_TXT"] || pickByPrefix_(rowObj, "CONS_TXT") || "").trim();

  // Se você tem 4 blocos no form (recomendado)
  var b1 = String(rowObj["CONS_BLOCO_1"] || pickByPrefix_(rowObj, "CONS_BLOCO_1") || "").trim() || null;
  var b2 = String(rowObj["CONS_BLOCO_2"] || pickByPrefix_(rowObj, "CONS_BLOCO_2") || "").trim() || null;
  var b3 = String(rowObj["CONS_BLOCO_3"] || pickByPrefix_(rowObj, "CONS_BLOCO_3") || "").trim() || null;
  var b4 = String(rowObj["CONS_BLOCO_4"] || pickByPrefix_(rowObj, "CONS_BLOCO_4") || "").trim() || null;

  // Se não tiver blocos, joga tudo no bloco_1
  if (!b1 && texto) b1 = texto;

  var rec = {
    athlete_id: athlete,
    submitted_at: iso_(new Date()),
    bloco_1: b1,
    bloco_2: b2,
    bloco_3: b3,
    bloco_4: b4,
    status: "sent_to_n8n",
    last_error: null
  };

  var inserted = supaInsert_(cfg, "construcional_raw", rec);
  var id = (inserted && inserted[0] && inserted[0].id) ? inserted[0].id : null;

  // dispara n8n com o id (isso é o MAIS importante)
  sendConstrucionalToN8n(id, athlete, texto || b1 || "");

  return { construcional_raw: "insert", id: id };
}

/* =========================
   CÁLCULO DE MÉTRICAS (mantive suas funções)
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
  var ts = iso_(toDate_(row[COL.timestamp]));
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
    timestamp: iso_(toDate_(row[COL.timestamp])),
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
  var ts = iso_(toDate_(row[COL.timestamp]));

  var gsesVals = [];
  for (var i = 1; i <= 10; i++) {
    var v = n_(pickByPrefix_(row, "GSES_Q" + String(i).padStart(2, '0')));
    if (isFinite(v)) gsesVals.push(v);
  }
  var gsesSum = gsesVals.reduce(function(a,b){ return a + b; }, 0);
  var gsesMean = gsesVals.length ? gsesSum / gsesVals.length : null;

  var acsiVals = [];
  for (var j = 1; j <= 28; j++) {
    var val = n_(pickByPrefix_(row, "ACSI_Q" + String(j).padStart(2, '0')));
    if (isFinite(val)) {
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
  var ts = iso_(toDate_(row[COL.timestamp]));
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
  var ts = iso_(toDate_(row[COL.timestamp]));
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
  return {
    timestamp: iso_(toDate_(row[COL.timestamp])),
    athlete_phone: normPhone_(pickByPrefix_(row, "REG_ATHLETE_PHONE")),
    coach_phone: normPhone_(pickByPrefix_(row, "REG_COACH_PHONE"))
  };
}

/* =========================
   SHEETS UTILITIES
========================= */

function openMaster_() {
  var sid = (MASTER_SHEET_ID || "").trim();
  if (!sid) sid = String(PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID") || "").trim();
  if (!sid) throw new Error("Defina MASTER_SHEET_ID ou armazene MASTER_SHEET_ID em Script Properties.");
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

function latestRow_(kind, athlete) {
  var sh = sheet_(kind);
  var tbl = table_(sh);
  var rows = tbl.rows
    .filter(function(r){ return String(r[COL.athleteId] || "").trim() === athlete; })
    .sort(function(a,b){ return toDate_(b[COL.timestamp]) - toDate_(a[COL.timestamp]); });
  return rows.length ? rows[0] : null;
}

function rowsSince_(kind, athlete, days) {
  var sh = sheet_(kind);
  var since = new Date(); since.setDate(since.getDate() - days);
  var tbl = table_(sh);
  return tbl.rows
    .filter(function(r){ return String(r[COL.athleteId] || "").trim() === athlete && toDate_(r[COL.timestamp]) >= since; })
    .sort(function(a,b){ return toDate_(a[COL.timestamp]) - toDate_(b[COL.timestamp]); });
}

/* =========================
   UTILS
========================= */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj, null, 2)).setMimeType(ContentService.MimeType.JSON);
}

function req_(e, name) {
  var v = String(e.parameter[name] || "").trim();
  if (!v) throw new Error("Missing param: " + name);
  return v;
}

function reqKind_(e) {
  var k = String(e.parameter.kind || "").trim();
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

function toDate_(x) {
  if (x instanceof Date) return x;
  var d = new Date(x);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function iso_(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function dateOnly_(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function pickByPrefix_(row, prefix) {
  var keys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var k = String(keys[i] || "");
    if (k.indexOf(prefix + ' |') === 0 || k === prefix) return row[keys[i]];
  }
  return "";
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

/* =========================
   TRIGGER (Form Submit)
========================= */

function installOnFormSubmitTrigger() {
  var ss = openMaster_();
  ScriptApp.newTrigger("onFormSubmitMaster_")
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
}

function onFormSubmitMaster_(e) {
  try {
    var cfg = assertSupa_();
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    var rowIndex = e.range.getRow();

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var values  = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];

    var rowObj = {};
    for (var i = 0; i < headers.length; i++) rowObj[headers[i].trim()] = values[i];

    var athlete = String(rowObj[COL.athleteId] || "").trim();
    if (!athlete) return;

    if (sheetName === TAB.daily) {
      writeDaily_(cfg, athlete, rowObj);
      sendRunScoringToN8n(athlete, dateOnly_(toDate_(rowObj[COL.timestamp])));
    } else if (sheetName === TAB.weekly) {
      writeWeekly_(cfg, athlete, rowObj);
      sendRunScoringToN8n(athlete, dateOnly_(toDate_(rowObj[COL.timestamp])));
    } else if (sheetName === TAB.quarterly) {
      writeQuarterly_(cfg, athlete, rowObj);
      sendRunScoringToN8n(athlete, dateOnly_(toDate_(rowObj[COL.timestamp])));
    } else if (sheetName === TAB.semiannual) {
      writeSemiannual_(cfg, athlete, rowObj);
      sendRunScoringToN8n(athlete, dateOnly_(toDate_(rowObj[COL.timestamp])));
    } else if (sheetName === TAB.registration) {
      writeRegistration_(cfg, athlete, rowObj);
    } else if (sheetName === TAB.construcional) {
      writeConstrucional_(cfg, athlete, rowObj);
    } else if (sheetName === TAB.restq_trainer) {
      // sem tabela destino (por enquanto)
      writeKindToSupabase_(cfg, "restq_trainer", athlete, rowObj);
    }
  } catch (err) {
    Logger.log("onFormSubmitMaster_ ERROR: " + err);
  }
}

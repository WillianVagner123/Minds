/**
 * MINDS Performance – API de Análise (versão completa com triggers e integração n8n)
 *
 * Este Apps Script expõe uma API HTTP para ler respostas dos formulários
 * prefixados (diário, semanal, trimestral, semestral, RESTQ treinador e
 * cadastro) armazenados em uma planilha “mãe”, calcular métricas
 * específicas de cada questionário e, opcionalmente, inserir estas
 * métricas em tabelas JSON no Supabase. Também permite atualizar
 * telefones de atletas e treinadores a partir do formulário de cadastro
 * e dispara webhooks para workflows no n8n (Construcional e RunScoring).
 *
 * Para usar:
 * 1) Copie este arquivo para um projeto Apps Script.
 * 2) Defina o ID da planilha mãe em MASTER_SHEET_ID (ou armazene em
 *    Script Properties com a chave MASTER_SHEET_ID).
 * 3) Defina SUPABASE_URL e SUPABASE_KEY em Script Properties. O nome
 *    das tabelas pode ser customizado via SUPABASE_TABLE_METRICS e
 *    SUPABASE_TABLE_ROSTER.
 * 4) Implante como Aplicativo da Web para expor as rotas HTTP se
 *    necessário (health, analyze_latest, push_latest, push_range,
 *    registration_upsert).
 * 5) Rode installOnFormSubmitTrigger() uma vez para instalar o gatilho
 *    de submissão do formulário. Isso captura respostas do Forms e
 *    processa/insere dados automaticamente no Supabase.
 */

/* =========================
   CONFIGURAÇÃO BÁSICA
========================= */

// ID da planilha mãe. Pode ser definido diretamente aqui ou via Script
// Properties (chave MASTER_SHEET_ID). A planilha deve conter as abas
// RESP_DAILY, RESP_WEEKLY, etc., geradas pelo script de criação de
// formulários prefixados.
var MASTER_SHEET_ID = "17QcZhPSwT-7iEbx5MffEacmlPbpwUOImg7xxkwmhQRo";

// Mapeamento de tipos de questionário (kind) para o nome da aba. Esses
// valores devem coincidir com os nomes das abas de respostas.
var TAB = {
  daily: "RESP_DAILY",
  weekly: "RESP_WEEKLY",
  quarterly: "RESP_QUARTERLY",
  semiannual: "RESP_SEMIANNUAL",
  restq_trainer: "RESP_RESTQ_TRAINER",
  registration: "RESP_REGISTRATION",
  // Adicione mais se tiver outros formulários prefixados (ex.: construcional).
  construcional: "RESP_CONSTRUCIONAL"
};

// Cabeçalhos comuns. ATHLETE_ID deve estar em todos os formulários como
// “ATHLETE_ID | ...” para possibilitar o roteamento por atleta.
var COL = {
  timestamp: "Carimbo de data/hora",
  athleteId: "ATHLETE_ID"
};

/* =========================
   SUPABASE CONFIG / HELPERS
========================= */

/**
 * Lê as configurações do Supabase em Script Properties. Espera as
 * chaves SUPABASE_URL e SUPABASE_KEY. Também permite customizar os
 * nomes das tabelas via SUPABASE_TABLE_METRICS e SUPABASE_TABLE_ROSTER.
 */
function supaCfg_() {
  var props = PropertiesService.getScriptProperties();
  return {
    url: String(props.getProperty("SUPABASE_URL") || "").trim(),
    key: String(props.getProperty("SUPABASE_KEY") || "").trim(),
    tableMetrics: String(props.getProperty("SUPABASE_TABLE_METRICS") || "athlete_questionnaire_metrics").trim(),
    tableRoster: String(props.getProperty("SUPABASE_TABLE_ROSTER") || "athlete_roster").trim()
  };
}

/**
 * Garante que as configurações do Supabase estejam preenchidas. Se
 * SUPABASE_URL ou SUPABASE_KEY estiverem vazios, lança erro.
 */
function assertSupa_() {
  var cfg = supaCfg_();
  if (!cfg.url || !cfg.key) {
    throw new Error("Defina SUPABASE_URL e SUPABASE_KEY em Script Properties para usar as funções Supabase.");
  }
  return cfg;
}

/**
 * Realiza um UPSERT de um único registro de métricas no Supabase.
 * Usa on_conflict = athlete_id,kind,observed_at para evitar duplicar.
 */
function supaUpsertMetrics_(cfg, rec) {
  var url = cfg.url.replace(/\/$/, "") + "/rest/v1/" + encodeURIComponent(cfg.tableMetrics) +
    "?on_conflict=" + encodeURIComponent("athlete_id,kind,observed_at");
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify([rec]),
    muteHttpExceptions: true,
    headers: {
      apikey: cfg.key,
      Authorization: "Bearer " + cfg.key,
      Prefer: "resolution=merge-duplicates,return=minimal"
    }
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Supabase upsert metrics failed (" + code + "): " + res.getContentText());
  }
}

/**
 * Realiza um UPSERT para a tabela athlete_roster, usando on_conflict
 * = athlete_id. Atualiza telefones do atleta e treinador.
 */
function supaUpsertRoster_(cfg, rec) {
  var url = cfg.url.replace(/\/$/, "") + "/rest/v1/" + encodeURIComponent(cfg.tableRoster) +
    "?on_conflict=" + encodeURIComponent("athlete_id");
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify([rec]),
    muteHttpExceptions: true,
    headers: {
      apikey: cfg.key,
      Authorization: "Bearer " + cfg.key,
      Prefer: "resolution=merge-duplicates,return=minimal"
    }
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Supabase upsert roster failed (" + code + "): " + res.getContentText());
  }
}

/* =========================
   INTEGRAÇÃO n8n
========================= */

// URLs de webhooks do n8n. Ajuste para o seu ambiente.
var N8N_CONSTRUCIONAL_WEBHOOK_URL = "https://autowebhook.opingo.com.br/webhook/Construcional";
var N8N_RUNSCORING_WEBHOOK_URL   = "https://autowebhook.opingo.com.br/webhook/RunScoring";

/** Envia dados brutos do questionário construcional para o n8n. */
function sendConstrucionalToN8n(construcionalRawId, athleteId, texto) {
  var payload = { construcional_raw_id: construcionalRawId, athlete_id: athleteId, texto: texto };
  var options = { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true };
  var response = UrlFetchApp.fetch(N8N_CONSTRUCIONAL_WEBHOOK_URL, options);
  Logger.log("Construcional webhook status: " + response.getResponseCode());
}

/** Dispara o webhook de scoring. O n8n buscará dados no Supabase e calculará o score. */
function sendRunScoringToN8n(athleteId, referenceDate) {
  var payload = { athlete_id: athleteId };
  if (referenceDate) payload.reference_date = referenceDate;
  var options = { method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true };
  var response = UrlFetchApp.fetch(N8N_RUNSCORING_WEBHOOK_URL, options);
  Logger.log("RunScoring webhook status: " + response.getResponseCode());
}

/* =========================
   API HTTP (doGet)
========================= */

function doGet(e) {
  try {
    var action = String(e.parameter.action || "").trim();
    if (!action) return json_({ ok: false, error: "Missing action" });
    if (action === "health") return health_();
    if (action === "analyze_latest") return analyzeLatest_(e);
    if (action === "push_latest") return pushLatest_(e);
    if (action === "push_range") return pushRange_(e);
    if (action === "registration_upsert") return registrationUpsert_(e);
    return json_({ ok: false, error: "Unknown action", action: action });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* =========================
   ENDPOINT HANDLERS
========================= */

/** Retorna informações sobre a planilha e se Supabase está configurado. */
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

/** Calcula métricas do último registro de um atleta em determinado questionário. */
function analyzeLatest_(e) {
  var kind = reqKind_(e);
  var athlete = req_(e, "athlete");
  var row = latestRow_(kind, athlete);
  if (!row) return json_({ ok: true, kind: kind, athlete: athlete, found: false });
  var metrics = computeMetrics_(kind, row);
  return json_({ ok: true, kind: kind, athlete: athlete, found: true, observed_at: iso_(toDate_(row[COL.timestamp])), metrics: metrics });
}

/** Calcula métricas do último registro e upserteia no Supabase. */
function pushLatest_(e) {
  var cfg = assertSupa_();
  var kind = reqKind_(e);
  var athlete = req_(e, "athlete");
  if (kind === "registration") {
    return registrationUpsert_(e);
  }
  var row = latestRow_(kind, athlete);
  if (!row) return json_({ ok: true, kind: kind, athlete: athlete, found: false, pushed: false });
  var rec = buildRecord_(kind, athlete, row);
  supaUpsertMetrics_(cfg, rec);
  return json_({ ok: true, kind: kind, athlete: athlete, pushed: true });
}

/** Calcula e insere métricas dos últimos N dias. */
function pushRange_(e) {
  var cfg = assertSupa_();
  var kind = reqKind_(e);
  var athlete = req_(e, "athlete");
  var days = parseInt(e.parameter.days || "30", 10);
  if (!(days > 0)) days = 30;
  if (kind === "registration") {
    return registrationUpsert_(e);
  }
  var rows = rowsSince_(kind, athlete, days);
  if (!rows.length) return json_({ ok: true, kind: kind, athlete: athlete, days: days, found: false, pushed: 0 });
  var pushed = 0, errors = [];
  for (var i = 0; i < rows.length; i++) {
    try {
      var rec = buildRecord_(kind, athlete, rows[i]);
      supaUpsertMetrics_(cfg, rec);
      pushed++;
    } catch (err) {
      errors.push({ index: i, error: String(err && err.message ? err.message : err) });
    }
  }
  return json_({ ok: true, kind: kind, athlete: athlete, days: days, attempted: rows.length, pushed: pushed, errors: errors });
}

/** Atualiza telefones no roster com base no último formulário de cadastro. */
function registrationUpsert_(e) {
  var cfg = assertSupa_();
  var athlete = req_(e, "athlete");
  var row = latestRow_("registration", athlete);
  if (!row) return json_({ ok: true, athlete: athlete, found: false, updated: false });
  var athletePhone = normPhone_(pickByPrefix_(row, "REG_ATHLETE_PHONE"));
  var coachPhone = normPhone_(pickByPrefix_(row, "REG_COACH_PHONE"));
  var rec = {
    athlete_id: athlete,
    athlete_phone: athletePhone || null,
    coach_phone: coachPhone || null,
    updated_at: iso_(new Date())
  };
  supaUpsertRoster_(cfg, rec);
  return json_({ ok: true, athlete: athlete, found: true, updated: true });
}

/* =========================
   CÁLCULO DE MÉTRICAS
========================= */

/**
 * Seleciona a função de cálculo adequada para o tipo de questionário.
 */
function computeMetrics_(kind, row) {
  if (kind === "daily") return dailyMetrics_(row);
  if (kind === "weekly") return weeklyMetrics_(row);
  if (kind === "quarterly") return quarterlyMetrics_(row);
  if (kind === "semiannual") return semiannualMetrics_(row);
  if (kind === "restq_trainer") return restqTrainerMetrics_(row);
  if (kind === "registration") return registrationMetrics_(row);
  throw new Error("Unhandled kind: " + kind);
}

/** Cria o registro a ser gravado no Supabase a partir das métricas. */
function buildRecord_(kind, athlete, row) {
  var observedAt = iso_(toDate_(row[COL.timestamp]));
  return {
    athlete_id: athlete,
    kind: kind,
    observed_at: observedAt,
    source: "apps_script",
    metrics: computeMetrics_(kind, row)
  };
}

/* ----- DAILY METRICS ----- */

function dailyMetrics_(row) {
  var ts = iso_(toDate_(row[COL.timestamp]));
  // Carga de treino
  var rpe = n_(pickByPrefix_(row, "DAILY_RPE"));
  var dur = n_(pickByPrefix_(row, "DAILY_DUR"));
  var load = (isFinite(rpe) && isFinite(dur)) ? rpe * dur : null;
  // Nutrição
  var adherence = n_(pickByPrefix_(row, "DAILY_ADH"));
  var gi = n_(pickByPrefix_(row, "DAILY_GI"));
  var missed = String(pickByPrefix_(row, "DAILY_MISSED") || "");
  var lowEnergy = String(pickByPrefix_(row, "DAILY_LOW") || "");
  // Vigor momentâneo (4 itens)
  var vigorVals = [];
  for (var i = 1; i <= 4; i++) {
    var v = n_(pickByPrefix_(row, "VIGOR_Q" + String(i).padStart(2, '0')));
    if (isFinite(v)) vigorVals.push(v);
  }
  var vigorMean = vigorVals.length ? vigorVals.reduce(function(a,b){ return a+b; }, 0) / vigorVals.length : null;
  // BRUMS 24 itens
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
  // GSES – 10 itens (1–5)
  var gsesVals = [];
  for (var i = 1; i <= 10; i++) {
    var v = n_(pickByPrefix_(row, "GSES_Q" + String(i).padStart(2, '0')));
    if (isFinite(v)) gsesVals.push(v);
  }
  var gsesSum = gsesVals.reduce(function(a,b){ return a + b; }, 0);
  var gsesMean = gsesVals.length ? gsesSum / gsesVals.length : null;
  // ACSI-28 – 7 subescalas de 4 itens cada (itens 7,12,19,23 invertidos)【936767469737001†L226-L319】.
  var acsiVals = [];
  for (var j = 1; j <= 28; j++) {
    var val = n_(pickByPrefix_(row, "ACSI_Q" + String(j).padStart(2, '0')));
    if (isFinite(val)) {
      if (j === 7 || j === 12 || j === 19 || j === 23) {
        val = 3 - val;
      }
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
  // PMCSQ – 34 itens, divididos em clima de tarefa e ego
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
  // RESTQ-Sport (50 itens 0–6). Média geral
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
  if (!sid) {
    sid = String(PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID") || "").trim();
  }
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
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = values[i][c];
    }
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function latestRow_(kind, athlete) {
  var sh = sheet_(kind);
  var tbl = table_(sh);
  var rows = tbl.rows.filter(function(r){ return String(r[COL.athleteId] || "").trim() === athlete; }).sort(function(a,b){ return toDate_(b[COL.timestamp]) - toDate_(a[COL.timestamp]); });
  return rows.length ? rows[0] : null;
}

function rowsSince_(kind, athlete, days) {
  var sh = sheet_(kind);
  var since = new Date(); since.setDate(since.getDate() - days);
  var tbl = table_(sh);
  return tbl.rows.filter(function(r){ return String(r[COL.athleteId] || "").trim() === athlete && toDate_(r[COL.timestamp]) >= since; }).sort(function(a,b){ return toDate_(a[COL.timestamp]) - toDate_(b[COL.timestamp]); });
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

/**
 * Instala o gatilho onFormSubmit para a planilha mãe. Rode apenas
 * uma vez. Após instalado, qualquer submissão de qualquer aba
 * dispara onFormSubmitMaster_.
 */
function installOnFormSubmitTrigger() {
  var ss = openMaster_();
  ScriptApp.newTrigger("onFormSubmitMaster_")
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
}

/** Roteia cada resposta conforme o tipo de aba e dispara scoring quando necessário. */
function onFormSubmitMaster_(e) {
  try {
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    var rowIndex = e.range.getRow();
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var values = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
    var rowObj = {};
    for (var i = 0; i < headers.length; i++) {
      rowObj[headers[i].trim()] = values[i];
    }
    var athlete = String(rowObj[COL.athleteId] || "").trim();
    if (!athlete) return;
    // Determine tipo pelo nome da aba
    if (sheetName === TAB.daily) {
      handleKindAndMaybeScore_("daily", rowObj, true);
    } else if (sheetName === TAB.weekly) {
      handleKindAndMaybeScore_("weekly", rowObj, true);
    } else if (sheetName === TAB.quarterly) {
      handleKindAndMaybeScore_("quarterly", rowObj, true);
    } else if (sheetName === TAB.semiannual) {
      handleKindAndMaybeScore_("semiannual", rowObj, true);
    } else if (sheetName === TAB.restq_trainer) {
      handleKindAndMaybeScore_("restq_trainer", rowObj, true);
    } else if (sheetName === TAB.registration) {
      handleRegistration_(rowObj);
    } else if (sheetName === TAB.construcional) {
      handleConstrucional_(rowObj);
    }
  } catch (err) {
    Logger.log("onFormSubmitMaster_ ERROR: " + err);
  }
}

/* =========================
   HANDLERS POR ABA
========================= */

function handleKindAndMaybeScore_(kind, rowObj, callScoring) {
  var cfg = assertSupa_();
  var athlete = String(rowObj[COL.athleteId] || "").trim();
  if (!athlete) return;
  // 1) calcula e upsert
  var rec = buildRecord_(kind, athlete, rowObj);
  supaUpsertMetrics_(cfg, rec);
  // 2) dispara scoring se requisitado
  if (callScoring) {
    var refDate = Utilities.formatDate(toDate_(rowObj[COL.timestamp]), Session.getScriptTimeZone(), "yyyy-MM-dd");
    sendRunScoringToN8n(athlete, refDate);
  }
}

function handleRegistration_(rowObj) {
  var cfg = assertSupa_();
  var athlete = String(rowObj[COL.athleteId] || "").trim();
  if (!athlete) return;
  // upsert metrics do registration
  var rec = buildRecord_("registration", athlete, rowObj);
  supaUpsertMetrics_(cfg, rec);
  // upsert roster (telefones)
  var athletePhone = normPhone_(pickByPrefix_(rowObj, "REG_ATHLETE_PHONE"));
  var coachPhone   = normPhone_(pickByPrefix_(rowObj, "REG_COACH_PHONE"));
  supaUpsertRoster_(cfg, {
    athlete_id: athlete,
    athlete_phone: athletePhone || null,
    coach_phone: coachPhone || null,
    updated_at: iso_(new Date())
  });
}

// Handler de construcional: salva raw e dispara classificações via n8n.
function handleConstrucional_(rowObj) {
  // Para construcional, considere criar tabela construcional_raw no Supabase
  var athlete = String(rowObj[COL.athleteId] || "").trim();
  if (!athlete) return;
  var texto = String(rowObj["CONS_TXT"] || "").trim(); // ajuste o prefixo conforme sua pergunta
  // Insira raw no Supabase, se desejar. Aqui apenas chamamos webhook:
  sendConstrucionalToN8n(null, athlete, texto);
  // O n8n lida com upsert de construcional_analysis e scoring posteriormente.
}

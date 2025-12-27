/**
 * MINDS Performance – API de Análise (versão com perguntas prefixadas)
 *
 * Este Apps Script expõe uma API HTTP para ler respostas dos formulários
 * prefixados (diário, semanal, trimestral, semestral, RESTQ treinador e
 * cadastro) armazenados em uma planilha “mãe”, calcular métricas
 * específicas de cada questionário e, opcionalmente, inserir estas
 * métricas em uma tabela JSON no Supabase. Também permite atualizar
 * telefones de atletas e treinadores a partir do formulário de cadastro.
 *
 * Para usar:
 * 1) Copie este arquivo para um projeto Apps Script.
 * 2) Defina o ID da planilha mãe em MASTER_SHEET_ID (ou deixe em branco
 *    e armazene em Script Properties sob a chave MASTER_SHEET_ID).
 * 3) Defina SUPABASE_URL e SUPABASE_KEY em Script Properties para
 *    habilitar a inserção no Supabase. Opcionalmente defina o nome
 *    das tabelas via SUPABASE_TABLE_METRICS e SUPABASE_TABLE_ROSTER.
 * 4) Implante como um Aplicativo da Web (Nova implantação > tipo
 *    Aplicativo da Web). Defina “Executar como” você mesmo e
 *    “Quem tem acesso” conforme necessário.
 * 5) Chame via URL: ?action=health, analyze_latest, push_latest,
 *    push_range ou registration_upsert. Veja os comentários em cada
 *    handler para detalhes.
 */

/* =========================
   CONFIGURAÇÃO BÁSICA
========================= */

// ID da planilha mãe (onde caem as respostas). Se ficar em branco,
// será lido de Script Properties (MASTER_SHEET_ID) ou criado
// automaticamente pela função createAllFormsLinkedPrefixed do forms.
var MASTER_SHEET_ID = "";

// Mapeamento do tipo de questionário (kind) para o nome da aba.
// Deve corresponder aos valores em TAB_NAMES no script de criação
// de formulários. Estes nomes serão usados para localizar a aba de
// respostas correspondente.
var TAB = {
  daily: "RESP_DAILY",
  weekly: "RESP_WEEKLY",
  quarterly: "RESP_QUARTERLY",
  semiannual: "RESP_SEMIANNUAL",
  restq_trainer: "RESP_RESTQ_TRAINER",
  registration: "RESP_REGISTRATION"
};

// Cabeçalhos comuns presentes em todas as respostas. O timestamp é
// gerado automaticamente pelo Google Forms; o athleteId deve ser
// incluído em todos os formulários como ATHLETE_ID | ...
var COL = {
  timestamp: "Carimbo de data/hora",
  athleteId: "ATHLETE_ID"
};

/* =========================
   CONFIGURAÇÃO DO SUPABASE
========================= */

/**
 * Lê as configurações do Supabase a partir de Script Properties.
 *
 * Espera as chaves SUPABASE_URL e SUPABASE_KEY. Você pode definir
 * SUPABASE_TABLE_METRICS (padrão: athlete_questionnaire_metrics) e
 * SUPABASE_TABLE_ROSTER (padrão: athlete_roster) para customizar
 * os nomes das tabelas. Se os parâmetros obrigatórios não estiverem
 * definidos, as funções push retornarão erro.
 *
 * @returns {{url: string, key: string, tableMetrics: string, tableRoster: string}}
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
 * Garante que as configurações do Supabase estejam definidas. Se
 * SUPABASE_URL ou SUPABASE_KEY estiverem vazios, lança erro.
 * @returns {{url: string, key: string, tableMetrics: string, tableRoster: string}}
 */
function assertSupa_() {
  var cfg = supaCfg_();
  if (!cfg.url || !cfg.key) {
    throw new Error("Defina SUPABASE_URL e SUPABASE_KEY em Script Properties para usar as funções push.");
  }
  return cfg;
}

/* =========================
   PONTO DE ENTRADA DA API
========================= */

/**
 * Manipulador principal para requisições GET. Use o parâmetro "action"
 * para escolher a operação desejada.
 *
 * - health: retorna informações básicas sobre a planilha e supabase.
 * - analyze_latest: calcula métricas do último registro de um atleta em
 *   um questionário específico (kind=daily|weekly|quarterly|semiannual|restq_trainer|registration).
 * - push_latest: calcula métricas do último registro e insere no Supabase.
 * - push_range: calcula métricas de todos os registros nos últimos N dias
 *   e insere no Supabase (parâmetro days, default=30).
 * - registration_upsert: para kind=registration, atualiza telefones
 *   (athlete/coch) na tabela roster do Supabase com base no último
 *   formulário de cadastro.
 *
 * Parâmetros comuns: athlete (ID do atleta), kind (tipo de formulário).
 */
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
   ENDPOINTS
========================= */

/** Retorna informações básicas sobre a planilha e se o Supabase está configurado. */
function health_() {
  var ss = openMaster_();
  return json_({
    ok: true,
    masterSheetId: ss.getId(),
    masterSheetUrl: ss.getUrl(),
    tabs: TAB,
    supabaseConfigured: !!(supaCfg_().url && supaCfg_().key)
  });
}

/**
 * Lê o último registro de um atleta em um questionário e calcula as
 * métricas correspondentes sem inserir no Supabase.
 */
function analyzeLatest_(e) {
  var kind = reqKind_(e);
  var athlete = req_(e, "athlete");
  var row = latestRow_(kind, athlete);
  if (!row) return json_({ ok: true, kind: kind, athlete: athlete, found: false });
  var metrics = computeMetrics_(kind, row);
  return json_({ ok: true, kind: kind, athlete: athlete, found: true, observed_at: iso_(toDate_(row[COL.timestamp])), metrics: metrics });
}

/**
 * Calcula as métricas do último registro e insere no Supabase. Requer
 * SUPABASE_URL e SUPABASE_KEY configurados em Script Properties.
 */
function pushLatest_(e) {
  var cfg = assertSupa_();
  var kind = reqKind_(e);
  var athlete = req_(e, "athlete");
  if (kind === "registration") {
    // Para cadastro, delegue ao registration_upsert
    return registrationUpsert_(e);
  }
  var row = latestRow_(kind, athlete);
  if (!row) return json_({ ok: true, kind: kind, athlete: athlete, found: false, pushed: false });
  var rec = buildRecord_(kind, athlete, row);
  var out = supaInsert_(cfg, cfg.tableMetrics, rec);
  return json_({ ok: true, kind: kind, athlete: athlete, pushed: true, inserted: out });
}

/**
 * Calcula e insere no Supabase as métricas de todos os registros do
 * atleta nos últimos N dias (parâmetro days, default=30). Retorna
 * contagem de inserções e possíveis erros.
 */
function pushRange_(e) {
  var cfg = assertSupa_();
  var kind = reqKind_(e);
  var athlete = req_(e, "athlete");
  var days = parseInt(e.parameter.days || "30", 10);
  if (!(days > 0)) days = 30;
  if (kind === "registration") {
    // Para cadastro, apenas atualize a linha mais recente
    return registrationUpsert_(e);
  }
  var rows = rowsSince_(kind, athlete, days);
  if (!rows.length) return json_({ ok: true, kind: kind, athlete: athlete, days: days, found: false, pushed: 0 });
  var pushed = 0, errors = [];
  for (var i = 0; i < rows.length; i++) {
    try {
      var rec = buildRecord_(kind, athlete, rows[i]);
      supaInsert_(cfg, cfg.tableMetrics, rec);
      pushed++;
    } catch (err) {
      errors.push({ index: i, error: String(err && err.message ? err.message : err) });
    }
  }
  return json_({ ok: true, kind: kind, athlete: athlete, days: days, attempted: rows.length, pushed: pushed, errors: errors });
}

/**
 * Atualiza (upsert) a tabela athlete_roster no Supabase com os
 * telefones do atleta e do treinador a partir do último formulário de
 * cadastro (registration). Usa o ID de atleta passado em athlete.
 */
function registrationUpsert_(e) {
  var cfg = assertSupa_();
  var athlete = req_(e, "athlete");
  var row = latestRow_("registration", athlete);
  if (!row) return json_({ ok: true, athlete: athlete, found: false, updated: false });
  // Extrai telefones prefixados
  var athletePhone = normPhone_(pickByPrefix_(row, "REG_ATHLETE_PHONE"));
  var coachPhone = normPhone_(pickByPrefix_(row, "REG_COACH_PHONE"));
  var rec = {
    athlete_id: athlete,
    athlete_phone: athletePhone || null,
    coach_phone: coachPhone || null,
    updated_at: iso_(new Date())
  };
  var out = supaInsert_(cfg, cfg.tableRoster, rec);
  return json_({ ok: true, athlete: athlete, found: true, updated: true, saved: out });
}

/* =========================
   CÁLCULO DE MÉTRICAS
========================= */

/**
 * Dispatcher principal de cálculo. Seleciona a função correta
 * dependendo do kind. Cada função deve retornar um objeto JSON
 * serializável com os resultados das métricas. Campos textuais
 * opcionais são mantidos (por exemplo, comentários).
 *
 * @param {string} kind tipo de questionário
 * @param {Object} row linha completa com cabeçalhos
 * @returns {Object} objeto de métricas
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

/**
 * Constrói o objeto a ser inserido no Supabase a partir das métricas
 * geradas. Campos fixed: athlete_id, kind, observed_at, source,
 * metrics (JSON). O observed_at é derivado do timestamp (data/hora)
 * da resposta.
 */
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

/* ----- DAILY ----- */

/**
 * Calcula métricas do formulário diário (BRUMS, carga de treino, nutrição).
 * Assume que as perguntas estão prefixadas como BRUMS_Q01..24, DAILY_RPE,
 * DAILY_DUR, DAILY_ADH, DAILY_MISSED, DAILY_LOW, DAILY_GI, VIGOR_Q01..04.
 */
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
  // Vigor momentâneo (quatro itens, média)
  var vigorVals = [];
  for (var i = 1; i <= 4; i++) {
    var v = n_(pickByPrefix_(row, "VIGOR_Q" + String(i).padStart(2, '0')));
    if (isFinite(v)) vigorVals.push(v);
  }
  var vigorMean = vigorVals.length ? vigorVals.reduce(function(a,b){return a+b;}, 0) / vigorVals.length : null;
  // BRUMS – 24 itens (6 subescalas de 4 itens cada)
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
  var vigor = sumRange(br, 12, 15);
  var fatigue = sumRange(br, 16, 19);
  var confusion = sumRange(br, 20, 23);
  var tmd = null;
  if ([tension, depression, anger, vigor, fatigue, confusion].every(function(x){ return x !== null; })) {
    tmd = (tension + depression + anger + fatigue + confusion) - vigor;
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
      vigor: vigor,
      fatigue: fatigue,
      confusion: confusion,
      tmd: tmd
    }
  };
}

/* ----- WEEKLY ----- */

/**
 * Calcula métricas do formulário semanal. Espera campos prefixados
 * WEEK_START, WEEK_PERF, WEEK_RECOVERY (texto), WEEK_COMMENTS (texto),
 * WEEK_ADH, WEEK_NUTR_COMMENTS (texto), WEEK_EVENTS (texto).
 */
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

/* ----- QUARTERLY ----- */

/**
 * Calcula métricas do formulário trimestral (GSES, ACSI, PMCSQ e RESTQ-sport).
 * Assume que os itens estão prefixados como GSES_Q01..10 (1–5),
 * ACSI_Q01..28 (0–3), PMCSQ_Q01..34 (1–5) e RESTQA_Q01..50 (0–6).
 * Computa médias/somas para cada domínio.
 */
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
  // ACSI-28 – 7 subescalas de 4 itens cada. Itens 7, 12, 19, 23 são reversos.
  // Mapeamento baseado em referência【936767469737001†L226-L319】. Índices 1..28.
  var acsiVals = [];
  for (var j = 1; j <= 28; j++) {
    var v = n_(pickByPrefix_(row, "ACSI_Q" + String(j).padStart(2, '0')));
    if (isFinite(v)) {
      // aplica reverso para itens 7, 12, 19, 23 (escala 0–3)
      if (j === 7 || j === 12 || j === 19 || j === 23) {
        v = 3 - v;
      }
      acsiVals[j] = v; // 1-indexed for mapping below
    } else {
      acsiVals[j] = null;
    }
  }
  function acsiSub(ids) {
    var arr = ids.map(function(idx){ return acsiVals[idx]; });
    if (arr.some(function(x){ return !isFinite(x); })) return { sum: null, mean: null };
    var s = arr.reduce(function(a,b){ return a + b; }, 0);
    return { sum: s, mean: s / arr.length };
  }
  var acsi = {
    goal_setting: acsiSub([1, 8, 13, 20]),
    confidence: acsiSub([2, 9, 14, 26]),
    coachability: acsiSub([3, 10, 15, 27]),
    concentration: acsiSub([4, 11, 16, 25]),
    coping_adversity: acsiSub([5, 17, 21, 24]),
    peaking_pressure: acsiSub([6, 18, 22, 28]),
    freedom_worry: acsiSub([7, 12, 19, 23])
  };
  // ACSI total (soma de todos os 28 itens)
  var acsiTotal = null;
  if (acsiVals.slice(1).every(function(x){ return isFinite(x); })) {
    acsiTotal = acsiVals.slice(1).reduce(function(a,b){ return a + b; }, 0);
  }
  // PMCSQ – 34 itens (1–5). Estimamos que itens 1–16 são clima de tarefa
  // (mastery) e itens 17–34 são clima de ego (performance). Esta
  // divisão é aproximada – ajuste conforme necessário.
  var pmcVals = [];
  for (var k = 1; k <= 34; k++) {
    var vpm = n_(pickByPrefix_(row, "PMCSQ_Q" + String(k).padStart(2, '0')));
    if (isFinite(vpm)) pmcVals[k] = vpm; else pmcVals[k] = null;
  }
  function pmcSub(start, end) {
    var subset = [];
    for (var t = start; t <= end; t++) {
      if (!isFinite(pmcVals[t])) return { mean: null, sum: null };
      subset.push(pmcVals[t]);
    }
    var s = subset.reduce(function(a,b){ return a + b; }, 0);
    return { sum: s, mean: s / subset.length };
  }
  var pmcsq = {
    mastery: pmcSub(1, 16),
    performance: pmcSub(17, 34)
  };
  // RESTQ-Sport (atleta) – 50 itens (0–6). Calcula média geral.
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

/* ----- SEMIANNUAL ----- */

/**
 * Calcula métricas do formulário semestral (CBAS/LSS). Espera
 * campos: SEMI_TECH_Q01.., SEMI_PLAN_Q01.., SEMI_MOTIV_Q01..,
 * SEMI_REL_Q01.., SEMI_AVERS_Q01.. com escala 1–5. Retorna a média
 * para cada bloco.
 */
function semiannualMetrics_(row) {
  var ts = iso_(toDate_(row[COL.timestamp]));
  function blockMean(prefix, count) {
    var vals = [];
    for (var i = 1; i <= count; i++) {
      var v = n_(pickByPrefix_(row, prefix + '_Q' + String(i).padStart(2, '0')));
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

/* ----- RESTQ TRAINER ----- */

/**
 * Calcula métricas do formulário RESTQ-Sport do treinador. Assume
 * prefixo TR_RESTQ_Q01..32 (0–6). Retorna média geral.
 */
function restqTrainerMetrics_(row) {
  var ts = iso_(toDate_(row[COL.timestamp]));
  var vals = [];
  for (var i = 1; i <= 32; i++) {
    var v = n_(pickByPrefix_(row, 'TR_RESTQ_Q' + String(i).padStart(2, '0')));
    if (isFinite(v)) vals.push(v);
  }
  var mean = vals.length ? vals.reduce(function(a,b){ return a + b; }, 0) / vals.length : null;
  return {
    timestamp: ts,
    trainer_id: pickByPrefix_(row, "TR_ID") || null,
    trainer_name: pickByPrefix_(row, "TR_NAME") || null,
    mean: mean
  };
}

/* ----- REGISTRATION ----- */

/**
 * Gera métricas básicas a partir do formulário de cadastro. Retorna
 * telefones normalizados (athlete_phone, coach_phone). Estes campos
 * também são salvos na tabela roster via registration_upsert.
 */
function registrationMetrics_(row) {
  return {
    timestamp: iso_(toDate_(row[COL.timestamp])),
    athlete_phone: normPhone_(pickByPrefix_(row, "REG_ATHLETE_PHONE")),
    coach_phone: normPhone_(pickByPrefix_(row, "REG_COACH_PHONE"))
  };
}

/* =========================
   SHEETS: ACESSO E LEITURA
========================= */

/** Abre a planilha mãe. Tenta usar MASTER_SHEET_ID ou Script Properties. */
function openMaster_() {
  var sid = (MASTER_SHEET_ID || "").trim();
  if (!sid) {
    sid = String(PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID") || "").trim();
  }
  if (!sid) throw new Error("Defina MASTER_SHEET_ID ou armazene MASTER_SHEET_ID em Script Properties.");
  return SpreadsheetApp.openById(sid);
}

/** Obtém a aba (Sheet) correspondente ao kind informado. */
function sheet_(kind) {
  var ss = openMaster_();
  var name = TAB[kind];
  if (!name) throw new Error("Invalid kind: " + kind);
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error("Tab not found for kind=" + kind + ": " + name);
  return sh;
}

/**
 * Lê todas as linhas da aba e retorna um objeto com headers e rows.
 * O cabeçalho é a primeira linha; cada row é um objeto com as
 * chaves igual ao cabeçalho.
 */
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

/** Retorna a linha mais recente para um atleta em determinado kind. */
function latestRow_(kind, athlete) {
  var sh = sheet_(kind);
  var tbl = table_(sh);
  var rows = tbl.rows
    .filter(function(r){ return String(r[COL.athleteId] || "").trim() === athlete; })
    .sort(function(a,b){ return toDate_(b[COL.timestamp]) - toDate_(a[COL.timestamp]); });
  return rows.length ? rows[0] : null;
}

/** Retorna todas as linhas nos últimos N dias para um atleta em um kind. */
function rowsSince_(kind, athlete, days) {
  var sh = sheet_(kind);
  var since = new Date(); since.setDate(since.getDate() - days);
  var tbl = table_(sh);
  return tbl.rows
    .filter(function(r){
      return String(r[COL.athleteId] || "").trim() === athlete && toDate_(r[COL.timestamp]) >= since;
    })
    .sort(function(a,b){ return toDate_(a[COL.timestamp]) - toDate_(b[COL.timestamp]); });
}

/* =========================
   SUPABASE REST
========================= */

/**
 * Realiza um insert simples em uma tabela via Supabase REST. Para
 * evitar conflitos de chave, não utiliza UPSERT. Se a política de
 * segurança (RLS) permitir, retornará os dados inseridos.
 */
function supaInsert_(cfg, table, row) {
  var url = cfg.url.replace(/\/$/, "") + "/rest/v1/" + encodeURIComponent(table);
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(row),
    muteHttpExceptions: true,
    headers: {
      apikey: cfg.key,
      Authorization: "Bearer " + cfg.key,
      Prefer: "return=representation"
    }
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error("Supabase insert failed (" + code + "): " + text);
  }
  try { return JSON.parse(text); } catch (_) { return text; }
}

/* =========================
   UTILITÁRIOS
========================= */

/** Gera um JSON serializável a partir de objeto e define o tipo. */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj, null, 2)).setMimeType(ContentService.MimeType.JSON);
}

/** Obtém parâmetro obrigatório; lança erro se vazio. */
function req_(e, name) {
  var v = String(e.parameter[name] || "").trim();
  if (!v) throw new Error("Missing param: " + name);
  return v;
}

/** Obtém kind e valida com TAB. */
function reqKind_(e) {
  var k = String(e.parameter.kind || "").trim();
  if (!k || !TAB[k]) throw new Error("Missing or invalid kind");
  return k;
}

/** Converte entrada numérica de string/number para float; retorna NaN se inválido. */
function n_(x) {
  if (x === null || x === undefined) return NaN;
  if (typeof x === 'number') return x;
  var s = String(x).trim().replace(',', '.');
  var n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

/** Converte valor para número ou retorna null se NaN. */
function nn_(x) {
  var v = n_(x);
  return isFinite(v) ? v : null;
}

/** Converte diversas representações para Date. Se inválido, retorna epoch. */
function toDate_(x) {
  if (x instanceof Date) return x;
  var d = new Date(x);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

/** Formata data ISO 8601 com timezone do script. */
function iso_(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** Procura o primeiro valor de uma coluna cujo cabeçalho começa com prefixo. */
function pickByPrefix_(row, prefix) {
  var keys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var k = String(keys[i] || "");
    if (k.indexOf(prefix + ' |') === 0 || k === prefix) return row[keys[i]];
  }
  return "";
}

/** Normaliza telefones brasileiros: remove não dígitos, adiciona +55. */
function normPhone_(raw) {
  if (!raw) return "";
  var d = String(raw).replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) return "+55" + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return "+" + d;
  return d.startsWith("55") ? "+" + d : "+55" + d;
}

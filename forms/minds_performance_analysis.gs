/**
 * MINDS Performance – API de Análise (Apps Script Web App)
 *
 * Como publicar:
 * 1) Apps Script > Implantar > Nova implantação > Tipo: "Aplicativo da Web"
 * 2) Executar como: você
 * 3) Quem tem acesso: "Qualquer pessoa" (ou "Qualquer pessoa com o link")
 *
 * Depois use:
 *  https://script.google.com/macros/s/SEU_DEPLOYMENT_ID/exec?action=health
 */

/* =========================
   CONFIG
========================= */
var MASTER_SHEET_ID = ""; // cole aqui o ID da planilha mãe
var TAB_NAMES = {
  DAILY: "RESP_DAILY",
  WEEKLY: "RESP_WEEKLY",
  QUARTERLY: "RESP_QUARTERLY",
  SEMIANNUAL: "RESP_SEMIANNUAL",
  RESTQ_TRAINER: "RESP_RESTQ_TRAINER",
  REGISTRATION: "RESP_REGISTRATION"
};

// Se suas colunas mudarem, ajuste aqui
// (nomes EXATOS como aparecem no cabeçalho da aba)
var COL = {
  // comuns
  timestamp: "Carimbo de data/hora",
  athleteId: "ID do atleta (código interno ou CPF)",

  // diário
  evalDate: "Data da avaliação",
  rpe: "Percepção subjetiva de esforço (RPE) da sessão",
  durationMin: "Duração da sessão (minutos)",
  adherence: "Hoje, o quanto você conseguiu seguir o plano alimentar combinado?",
  missedMeals: "Hoje você deixou de fazer alguma refeição importante (café, almoço, jantar ou lanche pré/pós)?",
  lowEnergy: "Hoje você sentiu que comeu menos do que precisava para treinar/recuperar bem?",
  gi: "Hoje, qual foi o nível de desconforto gastrointestinal (estômago/intestino)?"
};

/* =========================
   WEB APP ENTRY
========================= */
function doGet(e) {
  try {
    var action = (e.parameter.action || "").trim();
    if (!action) return json_({ ok:false, error:"Missing action" }, 400);

    if (action === "health") return health_();
    if (action === "daily_summary") return dailySummary_(e);
    if (action === "daily_timeseries") return dailyTimeseries_(e);
    if (action === "weekly_summary") return weeklySummary_(e);
    if (action === "roster_latest") return rosterLatest_(e);

    return json_({ ok:false, error:"Unknown action", action: action }, 400);
  } catch (err) {
    return json_({ ok:false, error:String(err && err.message ? err.message : err) }, 500);
  }
}

/* =========================
   ENDPOINTS
========================= */

function health_() {
  var ss = openMaster_();
  var sheets = ss.getSheets().map(function(s){ return s.getName(); });
  return json_({
    ok: true,
    masterSheetId: ss.getId(),
    masterSheetUrl: ss.getUrl(),
    sheets: sheets,
    tabsExpected: TAB_NAMES
  });
}

function dailySummary_(e) {
  var athlete = requiredParam_(e, "athlete");
  var ss = openMaster_();
  var sh = ss.getSheetByName(TAB_NAMES.DAILY);
  if (!sh) return json_({ ok:false, error:"Tab not found: " + TAB_NAMES.DAILY }, 404);

  var table = readTable_(sh);
  var rows = table.rows
    .filter(function(r){ return String(r[COL.athleteId] || "").trim() === athlete; })
    .sort(function(a,b){
      return toDate_(b[COL.timestamp]) - toDate_(a[COL.timestamp]);
    });

  if (!rows.length) return json_({ ok:true, athlete: athlete, found:false }, 200);

  var last = rows[0];
  var metrics = computeDailyMetrics_(last);

  return json_({
    ok: true,
    athlete: athlete,
    found: true,
    lastResponse: pick_(last, [COL.timestamp, COL.evalDate, COL.rpe, COL.durationMin, COL.adherence, COL.missedMeals, COL.lowEnergy, COL.gi]),
    dailyMetrics: metrics
  });
}

function dailyTimeseries_(e) {
  var athlete = requiredParam_(e, "athlete");
  var days = parseInt(e.parameter.days || "30", 10);
  if (!(days > 0)) days = 30;

  var ss = openMaster_();
  var sh = ss.getSheetByName(TAB_NAMES.DAILY);
  if (!sh) return json_({ ok:false, error:"Tab not found: " + TAB_NAMES.DAILY }, 404);

  var since = new Date();
  since.setDate(since.getDate() - days);

  var table = readTable_(sh);
  var series = table.rows
    .filter(function(r){
      return String(r[COL.athleteId] || "").trim() === athlete
        && toDate_(r[COL.timestamp]) >= since;
    })
    .sort(function(a,b){
      return toDate_(a[COL.timestamp]) - toDate_(b[COL.timestamp]);
    })
    .map(function(r){
      var m = computeDailyMetrics_(r);
      return {
        timestamp: iso_(toDate_(r[COL.timestamp])),
        evalDate: iso_(toDate_(r[COL.evalDate])),
        sRPE_load: m.sRPE_load,
        nutrition_adherence_1_5: m.nutrition_adherence_1_5,
        gi_0_10: m.gi_0_10,
        lowEnergyRisk: m.lowEnergyRisk,
        missedMealsFlag: m.missedMealsFlag,
        brums: m.brums // inclui subescalas + TMD (se conseguir ler)
      };
    });

  return json_({ ok:true, athlete: athlete, days: days, points: series.length, series: series });
}

function weeklySummary_(e) {
  var athlete = requiredParam_(e, "athlete");
  var weeks = parseInt(e.parameter.weeks || "8", 10);
  if (!(weeks > 0)) weeks = 8;

  var ss = openMaster_();
  var sh = ss.getSheetByName(TAB_NAMES.WEEKLY);
  if (!sh) return json_({ ok:false, error:"Tab not found: " + TAB_NAMES.WEEKLY }, 404);

  var since = new Date();
  since.setDate(since.getDate() - (weeks * 7));

  var table = readTable_(sh);
  var rows = table.rows
    .filter(function(r){
      return String(r[COL.athleteId] || "").trim() === athlete
        && toDate_(r[COL.timestamp]) >= since;
    })
    .sort(function(a,b){ return toDate_(a[COL.timestamp]) - toDate_(b[COL.timestamp]); })
    .map(function(r){
      return {
        timestamp: iso_(toDate_(r[COL.timestamp])),
        weekStart: iso_(toDate_(r["Data de início da semana (segunda-feira)"])),
        performance_1_5: num_(r["Nesta semana, como você avalia seu desempenho considerando dieta, sono, treinos e competições?"]),
        adherence_1_5: num_(r["Nesta semana, avalie sua adesão ao plano nutricional"])
      };
    });

  return json_({ ok:true, athlete: athlete, weeks: weeks, points: rows.length, series: rows });
}

function rosterLatest_(e) {
  var tab = (e.parameter.tab || TAB_NAMES.DAILY).trim();
  var limit = parseInt(e.parameter.limit || "50", 10);
  if (!(limit > 0)) limit = 50;

  var ss = openMaster_();
  var sh = ss.getSheetByName(tab);
  if (!sh) return json_({ ok:false, error:"Tab not found: " + tab }, 404);

  var table = readTable_(sh);
  var rows = table.rows
    .slice()
    .sort(function(a,b){ return toDate_(b[COL.timestamp]) - toDate_(a[COL.timestamp]); })
    .slice(0, limit)
    .map(function(r){
      return {
        timestamp: iso_(toDate_(r[COL.timestamp])),
        athlete: String(r[COL.athleteId] || "").trim()
      };
    });

  return json_({ ok:true, tab: tab, limit: limit, rows: rows });
}

/* =========================
   ANALYTICS (BRUMS + carga + flags)
========================= */

/**
 * Calcula métricas do diário.
 * - sRPE_load = RPE * duração(min)
 * - flags simples de nutrição
 * - BRUMS: tenta detectar colunas "Nas últimas horas eu me senti... X"
 *   e computa subescalas (Tensão, Depressão, Raiva, Vigor, Fadiga, Confusão)
 *   e TMD = (Tensão+Depressão+Raiva+Fadiga+Confusão) - Vigor
 */
function computeDailyMetrics_(row) {
  var rpe = num_(row[COL.rpe]);
  var dur = num_(row[COL.durationMin]);
  var load = (isFinite(rpe) && isFinite(dur)) ? rpe * dur : null;

  var adherence = num_(row[COL.adherence]); // 1–5
  var missed = String(row[COL.missedMeals] || "");
  var lowEnergy = String(row[COL.lowEnergy] || "");
  var gi = num_(row[COL.gi]);

  var brums = computeBrums_(row);

  return {
    sRPE_load: load,
    nutrition_adherence_1_5: isFinite(adherence) ? adherence : null,
    missedMealsFlag: (/Sim/i).test(missed),
    lowEnergyRisk: (/Sim/i).test(lowEnergy),
    gi_0_10: isFinite(gi) ? gi : null,
    brums: brums
  };
}

function computeBrums_(row) {
  // mapeamento BRUMS -> subescalas
  var TENSION = ['Tenso(a)', 'Nervoso(a)', 'Ansioso(a)', 'Estressado(a)'];
  var DEPRESSION = ['Triste', 'Deprimido(a)', 'Miserável', 'Desanimado(a)'];
  var ANGER = ['Furioso(a)', 'Irritado(a)', 'Incomodado(a)', 'Mal-humorado(a)'];
  var VIGOR = ['Energético(a)', 'Alerta', 'Desperto(a)', 'Vivo(a)'];
  var FATIGUE = ['Cansado(a)', 'Exausto(a)', 'Sem energia', 'Letárgico(a)'];
  var CONFUSION = ['Confuso(a)', 'Desorientado(a)', 'Em dúvida', 'Esquecido(a)'];

  function valOf(itemLabel) {
    // coluna típica: "Nas últimas horas eu me senti... X"
    var key = "Nas últimas horas eu me senti... " + itemLabel;
    var v = num_(row[key]);
    return isFinite(v) ? v : null;
  }
  function sum(arr) {
    var s = 0, ok = 0;
    arr.forEach(function(x){
      var v = valOf(x);
      if (v !== null) { s += v; ok++; }
    });
    return (ok === arr.length) ? s : null; // só retorna se tiver completo
  }

  var t = sum(TENSION);
  var d = sum(DEPRESSION);
  var a = sum(ANGER);
  var v = sum(VIGOR);
  var f = sum(FATIGUE);
  var c = sum(CONFUSION);

  var tmd = null;
  if ([t,d,a,v,f,c].every(function(x){ return x !== null; })) {
    tmd = (t + d + a + f + c) - v;
  }

  return {
    tension: t,
    depression: d,
    anger: a,
    vigor: v,
    fatigue: f,
    confusion: c,
    tmd: tmd
  };
}

/* =========================
   SHEETS HELPERS
========================= */

function openMaster_() {
  var sid = (MASTER_SHEET_ID || "").trim();
  if (!sid) throw new Error("Defina MASTER_SHEET_ID com o ID da planilha mãe.");
  return SpreadsheetApp.openById(sid);
}

function readTable_(sheet) {
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

/* =========================
   UTILS
========================= */

function json_(obj, status) {
  status = status || 200;
  var out = ContentService
    .createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
  // Apps Script não permite setar status code no TextOutput diretamente.
  // (Em geral, você sinaliza via "ok" e "error".)
  return out;
}

function requiredParam_(e, name) {
  var v = (e.parameter[name] || "").trim();
  if (!v) throw new Error("Missing required param: " + name);
  return v;
}

function num_(x) {
  if (x === null || x === undefined) return NaN;
  if (typeof x === "number") return x;
  var s = String(x).trim().replace(",", ".");
  var n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

function toDate_(x) {
  if (x instanceof Date) return x;
  // tenta converter strings
  var d = new Date(x);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function iso_(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function pick_(obj, keys) {
  var out = {};
  keys.forEach(function(k){ out[k] = obj[k]; });
  return out;
}

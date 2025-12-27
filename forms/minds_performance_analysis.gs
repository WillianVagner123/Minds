/**
 * MINDS Performance – Script de Análise de Questionários
 *
 * Este arquivo contém funções para analisar as respostas dos formulários
 * criados pelo script minds_performance_forms.gs. Cada função aceita
 * o ID de uma planilha vinculada ao formulário correspondente,
 * processa os dados e grava os resultados em uma nova aba com
 * métricas, somatórios, z‑scores e destaques de perguntas-chave.
 *
 * Como utilizar:
 *   1. Em um projeto Apps Script conectado à planilha de respostas,
 *      copie este arquivo e ajuste o ID da planilha nas chamadas de
 *      análise (ou passe como argumento).
 *   2. Execute a função desejada (por exemplo, analyzeDailyResponses)
 *      para gerar uma aba de análise. É necessário que a planilha
 *      contenha as colunas geradas pelos formulários criados em
 *      minds_performance_forms.gs.
 *
 * Observações:
 *   - Este script assume que as perguntas nos formulários não foram
 *     alteradas manualmente. Se houver alterações, ajuste os nomes
 *     de colunas nos arrays correspondentes.
 *   - Para facilitar, funções auxiliares são fornecidas para cálculo
 *     de médias, desvio‑padrão e z‑scores.
 */

// ⚠️ Em produção, guarde esta chave em PropertiesService!
var SUPABASE_URL = 'https://laznibyvpxpkhvbdelft.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxhem5pYnl2cHhwa2h2YmRlbGZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2ODA3NTUsImV4cCI6MjA3OTI1Njc1NX0.RQBVNArcbtQXAH9P1eyoq55sp0609iwZaXJQLSF1KPk';

/**
 * Envia um registro (row) para uma tabela do Supabase via REST.
 * tableName → nome da tabela (ex.: 'brums_analysis')
 * payload   → objeto JS com os campos (será enviado como JSON)
 */
function sendToSupabase_(tableName, payload) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    Logger.log('Supabase não configurado. Verifique SUPABASE_URL/SUPABASE_KEY.');
    return;
  }
  var url = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/' + encodeURIComponent(tableName);
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=minimal'
    },
    payload: JSON.stringify([payload]),
    muteHttpExceptions: true
  };
  try {
    var resp = UrlFetchApp.fetch(url, options);
    var code = resp.getResponseCode();
    if (code >= 300) {
      Logger.log('Erro Supabase (' + tableName + '): ' + code + ' / ' + resp.getContentText());
    } else {
      Logger.log('Supabase OK (' + tableName + ')');
    }
  } catch (e) {
    Logger.log('Erro ao enviar para Supabase: ' + e);
  }
}

/**
 * Normaliza CPF:
 * - Remove tudo que não é dígito
 * - Mantém zeros à esquerda
 * - Se tiver 11 dígitos, devolve no formato 000.000.000-00
 * - Se não tiver 11 dígitos, devolve o texto original (trimado)
 */
function normalizeCPF_(raw) {
  if (!raw) return '';
  var s = String(raw).replace(/\D/g, '');
  if (s.length === 11) {
    return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  return String(raw).trim();
}

/** Função de utilidade: calcula média de um vetor numérico */
function mean(values) {
  var sum = 0;
  var count = 0;
  values.forEach(function(v) {
    if (typeof v === 'number' && !isNaN(v)) {
      sum += v;
      count++;
    }
  });
  return count > 0 ? sum / count : 0;
}

/** Função de utilidade: calcula desvio‑padrão de um vetor numérico */
function stddev(values) {
  var m = mean(values);
  var variance = 0;
  var count = 0;
  values.forEach(function(v) {
    if (typeof v === 'number' && !isNaN(v)) {
      variance += Math.pow(v - m, 2);
      count++;
    }
  });
  return count > 1 ? Math.sqrt(variance / (count - 1)) : 0;
}

/**
 * Analisa o formulário diário (BRUMS, carga de treino, vigor). Calcula
 * DTH (soma de escalas negativas), Vigor, DTH–Vigor e gera z‑scores a
 * partir das respostas existentes. Também calcula a carga de treino
 * diária. Os resultados são gravados em uma nova aba chamada
 * "Daily_Analysis".
 *
 * @param {string} sheetId ID da planilha de respostas do formulário diário
 */
function analyzeDailyResponses(sheetId) {
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActive();
  var formSheet = ss.getSheets()[0];
  var data = formSheet.getDataRange().getValues();
  var headers = data[0];

  // Encontrar índices de colunas específicas por nome parcial
  function findIndex(name) {
    for (var i = 0; i < headers.length; i++) {
      if (headers[i] && headers[i].toString().indexOf(name) !== -1) {
        return i;
      }
    }
    return -1;
  }

  // Listas de itens negativos e de vigor para BRUMS
  var negativeNames = [
    'Tenso(a)', 'Nervoso(a)', 'Ansioso(a)', 'Estressado(a)',
    'Triste', 'Deprimido(a)', 'Miserável', 'Desanimado(a)',
    'Furioso(a)', 'Irritado(a)', 'Incomodado(a)', 'Mal‑humorado(a)',
    'Cansado(a)', 'Exausto(a)', 'Sem energia', 'Letárgico(a)',
    'Confuso(a)', 'Desorientado(a)', 'Em dúvida', 'Esquecido(a)'
  ];
  var vigorNames = ['Energético(a)', 'Alerta', 'Desperto(a)', 'Vivo(a)'];

  var negativeIdx = negativeNames.map(findIndex);
  var vigorIdx = vigorNames.map(findIndex);
  var rpeIdx = findIndex('Percepção subjetiva de esforço');
  var durationIdx = findIndex('Duração da sessão');
  var dateIdx = findIndex('Data da avaliação');
  // Campos adicionais (peso e detalhes de treino) provenientes do formulário diário
  var weightIdx = findIndex('Peso corporal');
  var momentIdx = findIndex('Você está preenchendo');
  var modalityIdx = findIndex('Modalidade do treino');
  var trainTimeIdx = findIndex('Tempo de treino');

  var dthArray = [];
  var vigorArray = [];
  var dthMinusArray = [];
  var loadArray = [];
  var weightArray = [];
  var trainingTimeArray = [];
  var result = [];
  result.push([
    'ID', 'Data',
    'DTH (soma escalas negativas)',
    'Vigor (soma escalas de energia)',
    'DTH – Vigor',
    'RPE', 'Duração (min)', 'Carga (RPE×min)',
    'Peso (kg)', 'Momento (Pré/Pós/Outro)', 'Modalidade', 'Tempo de treino (min)',
    'DTH z‑score', 'Vigor z‑score', 'DTH–Vigor z‑score',
    'Peso z‑score', 'Tempo de treino z‑score'
  ]);

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = row[0];
    var dateVal = dateIdx >= 0 ? row[dateIdx] : '';
    var dth = 0;
    negativeIdx.forEach(function(idx) {
      var v = parseFloat(row[idx]);
      if (!isNaN(v)) dth += v;
    });
    var vig = 0;
    vigorIdx.forEach(function(idx) {
      var v = parseFloat(row[idx]);
      if (!isNaN(v)) vig += v;
    });
    var dthMinus = dth - vig;
    var rpeVal = rpeIdx >= 0 ? parseFloat(row[rpeIdx]) : NaN;
    var durVal = durationIdx >= 0 ? parseFloat(row[durationIdx]) : NaN;
    var load = (!isNaN(rpeVal) && !isNaN(durVal)) ? rpeVal * durVal : NaN;

    // Peso e detalhes de treino
    var weightVal = weightIdx >= 0 ? parseFloat(row[weightIdx]) : NaN;
    var momentVal = momentIdx >= 0 ? row[momentIdx] : '';
    var modalityVal = modalityIdx >= 0 ? row[modalityIdx] : '';
    var trainVal = trainTimeIdx >= 0 ? parseFloat(row[trainTimeIdx]) : NaN;

    // Armazenar valores para cálculo de médias e desvios padrão
    dthArray.push(dth);
    vigorArray.push(vig);
    dthMinusArray.push(dthMinus);
    loadArray.push(load);
    if (!isNaN(weightVal)) weightArray.push(weightVal);
    if (!isNaN(trainVal)) trainingTimeArray.push(trainVal);

    result.push([
      id, dateVal,
      dth, vig, dthMinus,
      rpeVal, durVal, load,
      weightVal, momentVal, modalityVal, trainVal,
      '', '', '', '', ''
    ]);

    // Enviar para Supabase
    var normId = normalizeCPF_(id);
    var payload = {
      athlete_id: normId,
      data: dateVal instanceof Date ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd') : dateVal,
      dth: dth,
      vigor: vig,
      dth_minus: dthMinus,
      carga: load,
      weight_kg: isNaN(weightVal) ? null : weightVal,
      pre_post_moment: momentVal || null,
      training_modality: modalityVal || null,
      training_time: isNaN(trainVal) ? null : trainVal
    };
    sendToSupabase_('brums_analysis', payload);
  }
  var dthMean = mean(dthArray);
  var dthStd = stddev(dthArray);
  var vigMean = mean(vigorArray);
  var vigStd = stddev(vigorArray);
  var dthMinusMean = mean(dthMinusArray);
  var dthMinusStd = stddev(dthMinusArray);
  // Medidas adicionais
  var weightMean = mean(weightArray);
  var weightStd = stddev(weightArray);
  var trainMean = mean(trainingTimeArray);
  var trainStd = stddev(trainingTimeArray);

  for (var j = 1; j < result.length; j++) {
    var dVal = result[j][2];
    var vVal = result[j][3];
    var diffVal = result[j][4];
    // Índices: 12 = DTH z, 13 = Vigor z, 14 = DTH-Vigor z, 15 = Peso z, 16 = Tempo de treino z
    result[j][12] = dthStd > 0 ? (dVal - dthMean) / dthStd : 0;
    result[j][13] = vigStd > 0 ? (vVal - vigMean) / vigStd : 0;
    result[j][14] = dthMinusStd > 0 ? (diffVal - dthMinusMean) / dthMinusStd : 0;
    var wVal = result[j][8];
    var tVal = result[j][11];
    result[j][15] = weightStd > 0 && !isNaN(wVal) ? (wVal - weightMean) / weightStd : '';
    result[j][16] = trainStd > 0 && !isNaN(tVal) ? (tVal - trainMean) / trainStd : '';
  }
  var analysisSheetName = 'Daily_Analysis';
  var analysisSheet = ss.getSheetByName(analysisSheetName);
  if (!analysisSheet) analysisSheet = ss.insertSheet(analysisSheetName);
  analysisSheet.clearContents();
  analysisSheet.getRange(1, 1, result.length, result[0].length).setValues(result);
  Logger.log('Análise diária concluída. Resultados gravados em "Daily_Analysis".');

  /**
   * Cálculo de carga de treino e indicadores de periodização
   * Agrupa cargas por atleta e por semana (início na segunda‑feira) para calcular:
   * - weekly_load: soma das cargas da semana
   * - monotonia: média diária ÷ desvio-padrão das cargas da semana
   * - strain: weekly_load × monotonia
   * - readiness: weekly_load − strain
   * - acwr: weekly_load ÷ média das 4 semanas anteriores
   * Os resultados são gravados em uma nova aba "Load_Analysis" e enviados ao Supabase.
   */
  try {
    var trainingData = [];
    // Construir lista de entradas com id, data e carga válida
    for (var iRow = 1; iRow < result.length; iRow++) {
      var rId = result[iRow][0];
      var rDate = result[iRow][1];
      var rLoad = result[iRow][7];
      if (rId && rDate && !isNaN(rLoad)) {
        var dt = rDate instanceof Date ? rDate : new Date(rDate);
        if (!isNaN(dt)) {
          trainingData.push({athlete: normalizeCPF_(rId), date: dt, load: rLoad});
        }
      }
    }
    // Agrupar por atleta
    var groups = {};
    trainingData.forEach(function(entry) {
      if (!groups[entry.athlete]) groups[entry.athlete] = [];
      groups[entry.athlete].push(entry);
    });
    var loadResult = [];
    loadResult.push(['ID','Início da semana','Carga semanal','Monotonia','Strain','Readiness','ACWR']);
    for (var ath in groups) {
      var entries = groups[ath].sort(function(a,b){ return a.date - b.date; });
      // Mapear cargas por data (YYYY-MM-DD)
      var byDate = {};
      entries.forEach(function(e){
        var key = Utilities.formatDate(e.date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        if (!byDate[key]) byDate[key] = 0;
        byDate[key] += e.load;
      });
      // Determinar semanas
      var weekMap = {};
      var dates = Object.keys(byDate);
      dates.forEach(function(dstr){
        var dObj = new Date(dstr);
        // Calcular início da semana (segunda‑feira)
        var day = dObj.getDay();
        var diff = dObj.getDate() - day + (day === 0 ? -6 : 1);
        var monday = new Date(dObj);
        monday.setDate(diff);
        var weekKey = Utilities.formatDate(monday, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        if (!weekMap[weekKey]) weekMap[weekKey] = [];
        weekMap[weekKey].push(byDate[dstr]);
      });
      // Calcular métricas por semana
      var weekKeys = Object.keys(weekMap).sort();
      var previousLoads = [];
      weekKeys.forEach(function(weekKey) {
        var loads = weekMap[weekKey];
        var weeklyLoad = loads.reduce(function(sum, v){ return sum + v; }, 0);
        var meanLoad = weeklyLoad / loads.length;
        var sdLoad = stddev(loads);
        var monotoniaVal = sdLoad > 0 ? meanLoad / sdLoad : 0;
        var strainVal = weeklyLoad * monotoniaVal;
        var readinessVal = weeklyLoad - strainVal;
        // Calcular ACWR
        var acwrVal = null;
        if (previousLoads.length >= 4) {
          var sumPrev = 0;
          for (var iPrev = previousLoads.length - 4; iPrev < previousLoads.length; iPrev++) {
            sumPrev += previousLoads[iPrev];
          }
          var avgPrev = sumPrev / 4;
          acwrVal = avgPrev > 0 ? weeklyLoad / avgPrev : null;
        }
        previousLoads.push(weeklyLoad);
        loadResult.push([ath, weekKey, weeklyLoad, monotoniaVal, strainVal, readinessVal, acwrVal]);
        // Enviar para Supabase
        var pl = {
          athlete_id: ath,
          week_start: weekKey,
          weekly_load: weeklyLoad,
          monotonia: monotoniaVal,
          strain: strainVal,
          readiness: readinessVal,
          acwr: acwrVal
        };
        sendToSupabase_('training_load_analysis', pl);
      });
    }
    // Registrar em planilha
    var loadSheetName = 'Load_Analysis';
    var loadSheet = ss.getSheetByName(loadSheetName);
    if (!loadSheet) loadSheet = ss.insertSheet(loadSheetName);
    loadSheet.clearContents();
    loadSheet.getRange(1,1,loadResult.length,loadResult[0].length).setValues(loadResult);
    Logger.log('Análise de carga de treino concluída. Resultados gravados em "Load_Analysis".');
  } catch (e) {
    Logger.log('Erro ao calcular carga de treino: ' + e);
  }
}

/**
 * Analisa o formulário ACSI‑28BR. Gera a média geral das respostas,
 * calcula z‑scores e destaca as perguntas-chave. Os resultados são
 * gravados na aba "ACSI_Analysis".
 * Perguntas-chave: 1,3,4,9,6,10,16,15,18,23,27 (0‑based no array original).
 * @param {string} sheetId ID da planilha de respostas do ACSI‑28BR
 */
function analyzeACSIResponses(sheetId) {
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActive();
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var keyIndices = [0,2,3,8,5,9,15,14,17,22,26];
  var scores = [];
  var result = [];
  result.push(['ID','Data','Média ACSI','z‑score','Média Perguntas-chave']);
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = row[0];
    var dateVal = row[1];
    var vals = [];
    for (var c = 2; c < row.length; c++) {
      var v = parseFloat(row[c]);
      if (!isNaN(v)) vals.push(v);
    }
    var avg = mean(vals);
    scores.push(avg);
    var keyVals = [];
    keyIndices.forEach(function(idx) {
      var v = parseFloat(row[2 + idx]);
      if (!isNaN(v)) keyVals.push(v);
    });
    var keyAvg = mean(keyVals);
    result.push([id, dateVal, avg, '', keyAvg]);

    // Calcular subcategorias das perguntas-chave
    var metasPreparacao = parseFloat(row[2 + 0]);
    // Relação treinador: perguntas 3,10,16,27 -> índices 2,9,14,26
    var relacaoVals = [];
    [2,9,14,26].forEach(function(idx) {
      var v = parseFloat(row[2 + idx]);
      if (!isNaN(v)) relacaoVals.push(v);
    });
    var relacaoTreinador = mean(relacaoVals);
    var concentracao = parseFloat(row[2 + 3]);
    var confiancaMotivacao = parseFloat(row[2 + 8]);
    // Pico sob pressão: perguntas 6 e 18 -> índices 5 e 17
    var picoVals = [];
    [5,17].forEach(function(idx) {
      var v = parseFloat(row[2 + idx]);
      if (!isNaN(v)) picoVals.push(v);
    });
    var picoPressao = mean(picoVals);
    var adversidade = parseFloat(row[2 + 15]);
    var ausenciaPreocupacao = parseFloat(row[2 + 22]);
    // Normalizar ID/CPF
    var normId = normalizeCPF_(id);
    var payloadACSI = {
      athlete_id: normId,
      data: dateVal instanceof Date ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd') : dateVal,
      media: avg,
      metas_preparacao: metasPreparacao,
      relacao_treinador: relacaoTreinador,
      concentracao: concentracao,
      confianca_motivacao: confiancaMotivacao,
      pico_pressao: picoPressao,
      adversidade: adversidade,
      ausencia_preocupacao: ausenciaPreocupacao
    };
    sendToSupabase_('acsi_analysis', payloadACSI);
  }
  var m = mean(scores);
  var sd = stddev(scores);
  for (var r = 1; r < result.length; r++) {
    var z = sd > 0 ? (result[r][2] - m) / sd : 0;
    result[r][3] = z;
  }
  var analysisSheetName = 'ACSI_Analysis';
  var aSheet = ss.getSheetByName(analysisSheetName);
  if (!aSheet) aSheet = ss.insertSheet(analysisSheetName);
  aSheet.clearContents();
  aSheet.getRange(1,1,result.length,result[0].length).setValues(result);
  Logger.log('Análise ACSI concluída. Resultados em "ACSI_Analysis".');
}

/**
 * Analisa o formulário GSES‑12. Calcula a média das respostas, z‑scores
 * e reporta as perguntas-chave (itens 5 e 9). Os resultados são
 * gravados em "GSES_Analysis".
 * @param {string} sheetId ID da planilha de respostas do GSES‑12
 */
function analyzeGSESResponses(sheetId) {
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActive();
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var scores = [];
  var result = [];
  result.push(['ID','Data','Média GSES','z‑score','Média Perguntas-chave']);
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = row[0];
    var dateVal = row[1];
    var vals = [];
    for (var j = 2; j < row.length; j++) {
      var v = parseFloat(row[j]);
      if (!isNaN(v)) vals.push(v);
    }
    var avg = mean(vals);
    scores.push(avg);
    // Perguntas-chave: itens 5 e 9 (índices 4 e 8) -> colunas 2+4 e 2+8
    var p5 = parseFloat(row[2 + 4]);
    var p9 = parseFloat(row[2 + 8]);
    var keyAvg = mean([p5, p9]);
    result.push([id, dateVal, avg, '', keyAvg]);

    // Supabase payload
    var normId = normalizeCPF_(id);
    var payloadGSES = {
      athlete_id: normId,
      data: dateVal instanceof Date ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd') : dateVal,
      media: avg,
      autorregulacao: keyAvg
    };
    sendToSupabase_('gses_analysis', payloadGSES);
  }
  var m = mean(scores);
  var sd = stddev(scores);
  for (var r = 1; r < result.length; r++) {
    result[r][3] = sd > 0 ? (result[r][2] - m) / sd : 0;
  }
  var sheetName = 'GSES_Analysis';
  var gSheet = ss.getSheetByName(sheetName);
  if (!gSheet) gSheet = ss.insertSheet(sheetName);
  gSheet.clearContents();
  gSheet.getRange(1,1,result.length,result[0].length).setValues(result);
  Logger.log('Análise GSES concluída. Resultados em "GSES_Analysis".');
}

/**
 * Analisa as respostas do PMCSQ‑2. Agrupa os itens de clima de tarefa e
 * clima de ego, calcula médias e z‑scores e destaca perguntas-chave.
 * Perguntas-chave: 1,23,12,17,27 (índices 0,22,11,16,26). Os resultados
 * vão para "PMCSQ_Analysis".
 * @param {string} sheetId ID da planilha de respostas do PMCSQ‑2
 */
function analyzePMCSQResponses(sheetId) {
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActive();
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var taskMeans = [];
  var egoMeans = [];
  var result = [];
  result.push(['ID','Data','Média Clima Tarefa','Média Clima Ego','z‑score Tarefa','z‑score Ego','Média Perguntas-chave']);
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = row[0];
    var dateVal = row[1];
    var tVals = [];
    var eVals = [];
    // 16 itens de tarefa
    for (var c = 2; c < 2 + 16; c++) {
      var v = parseFloat(row[c]);
      if (!isNaN(v)) tVals.push(v);
    }
    // restantes de ego
    for (var c = 2 + 16; c < row.length; c++) {
      var v = parseFloat(row[c]);
      if (!isNaN(v)) eVals.push(v);
    }
    var mTask = mean(tVals);
    var mEgo = mean(eVals);
    taskMeans.push(mTask);
    egoMeans.push(mEgo);
    // Perguntas-chave
    var keyIdxs = [0,22,11,16,26];
    var keyVals = [];
    keyIdxs.forEach(function(idx) {
      var val = parseFloat(row[2 + idx]);
      if (!isNaN(val)) keyVals.push(val);
    });
    var keyAvg = mean(keyVals);
    result.push([id, dateVal, mTask, mEgo, '', '', keyAvg]);

    // Subcategorias
    var coletivoVals = [];
    [0,22].forEach(function(idx) {
      var v = parseFloat(row[2 + idx]);
      if (!isNaN(v)) coletivoVals.push(v);
    });
    var coletivo = mean(coletivoVals);
    var climaTreinoDesafiador = parseFloat(row[2 + 11]);
    var climaEgoPreferido = parseFloat(row[2 + 16]);
    var punicaoErros = parseFloat(row[2 + 26]);
    var normId = normalizeCPF_(id);
    var payloadPMCSQ = {
      athlete_id: normId,
      data: dateVal instanceof Date ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd') : dateVal,
      clima_tarefa: mTask,
      clima_ego: mEgo,
      coletivo: coletivo,
      clima_treino_desafiador: climaTreinoDesafiador,
      clima_ego_preferido: climaEgoPreferido,
      punicao_erros: punicaoErros
    };
    sendToSupabase_('pmcsq_analysis', payloadPMCSQ);
  }
  var mTaskAll = mean(taskMeans);
  var sdTask = stddev(taskMeans);
  var mEgoAll = mean(egoMeans);
  var sdEgo = stddev(egoMeans);
  for (var r = 1; r < result.length; r++) {
    var t = result[r][2];
    var e = result[r][3];
    result[r][4] = sdTask > 0 ? (t - mTaskAll) / sdTask : 0;
    result[r][5] = sdEgo > 0 ? (e - mEgoAll) / sdEgo : 0;
  }
  var analysisSheetName = 'PMCSQ_Analysis';
  var pSheet = ss.getSheetByName(analysisSheetName);
  if (!pSheet) pSheet = ss.insertSheet(analysisSheetName);
  pSheet.clearContents();
  pSheet.getRange(1,1,result.length,result[0].length).setValues(result);
  Logger.log('Análise PMCSQ concluída. Resultados em "PMCSQ_Analysis".');
}

/**
 * Analisa o questionário RESTQ‑Sport (Atleta). Calcula a média geral e
 * destaca perguntas-chave relacionadas a bem‑estar e preocupações com
 * treino. Os resultados são gravados em "RESTQ_Analysis".
 * @param {string} sheetId ID da planilha de respostas do RESTQ atleta
 */
function analyzeRESTQResponses(sheetId) {
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActive();
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  // Ajuste estes títulos se tiverem sido renomeados no formulário
  var keyNames = [
    'Estou descansado e pronto para treinar',
    'Estou preocupado com problemas de treino'
  ];
  var keyIdxs = keyNames.map(function(name) {
    return headers.findIndex(function(h) {
      return h && h.toString().indexOf(name) !== -1;
    });
  });
  var means = [];
  var result = [];
  result.push(['ID','Data','Média RESTQ','z‑score','Média Perguntas-chave']);
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = row[0];
    var dateVal = row[1];
    var vals = [];
    for (var c = 2; c < row.length; c++) {
      var v = parseFloat(row[c]);
      if (!isNaN(v)) vals.push(v);
    }
    var avg = mean(vals);
    means.push(avg);
    var keyVals = [];
    keyIdxs.forEach(function(idx) {
      if (idx >= 0) {
        var v = parseFloat(row[idx]);
        if (!isNaN(v)) keyVals.push(v);
      }
    });
    var keyAvg = mean(keyVals);
    result.push([id, dateVal, avg, '', keyAvg]);

    // Supabase payload
    var normId = normalizeCPF_(id);
    var payloadRESTQ = {
      athlete_id: normId,
      data: dateVal instanceof Date ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd') : dateVal,
      media: avg,
      sono_bemestar: keyVals.length > 0 ? keyVals[0] : null,
      problemas_treino: keyVals.length > 1 ? keyVals[1] : null
    };
    sendToSupabase_('restq_analysis', payloadRESTQ);
  }
  var m = mean(means);
  var sd = stddev(means);
  for (var r = 1; r < result.length; r++) {
    result[r][3] = sd > 0 ? (result[r][2] - m) / sd : 0;
  }
  var analysisSheetName = 'RESTQ_Analysis';
  var rSheet = ss.getSheetByName(analysisSheetName);
  if (!rSheet) rSheet = ss.insertSheet(analysisSheetName);
  rSheet.clearContents();
  rSheet.getRange(1,1,result.length,result[0].length).setValues(result);
  Logger.log('Análise RESTQ concluída. Resultados em "RESTQ_Analysis".');
}

/**
 * Analisa o questionário CBAS/LSS. Calcula a média de cada dimensão
 * (Técnica, Planejamento, Motivacional, Relação e Aversivos) para cada
 * respondente e gera z‑scores. Os resultados são gravados em
 * "CBAS_Analysis".
 * @param {string} sheetId ID da planilha de respostas do CBAS/LSS
 */
function analyzeCBASResponses(sheetId) {
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActive();
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var dims = {
    'Técnica': 7,
    'Planejamento': 7,
    'Motivacional': 7,
    'Relação': 9,
    'Aversivos': 10
  };
  var dimNames = Object.keys(dims);
  var dimValues = {};
  dimNames.forEach(function(n) { dimValues[n] = []; });
  var result = [];
  var headerRow = ['ID','Data'];
  dimNames.forEach(function(n) { headerRow.push('Média ' + n); });
  dimNames.forEach(function(n) { headerRow.push('z‑score ' + n); });
  result.push(headerRow);
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var id = row[0];
    var dateVal = row[1];
    var idx = 2;
    var values = {};
    dimNames.forEach(function(name) {
      var count = dims[name];
      var vals = [];
      for (var c = 0; c < count; c++) {
        var v = parseFloat(row[idx + c]);
        if (!isNaN(v)) vals.push(v);
      }
      var avg = mean(vals);
      values[name] = avg;
      dimValues[name].push(avg);
      idx += count;
    });
    var rowOut = [id, dateVal];
    dimNames.forEach(function(n) { rowOut.push(values[n]); });
    dimNames.forEach(function() { rowOut.push(''); });
    result.push(rowOut);

    // Perguntas-chave por dimensão (primeiro item de cada bloco)
    var offset = 2; // primeira coluna após ID e Data
    var tecnica_chave = parseFloat(row[offset]);
    var planejamento_chave = parseFloat(row[offset + dims['Técnica']]);
    var motivacional_chave = parseFloat(row[offset + dims['Técnica'] + dims['Planejamento']]);
    var relacao_chave = parseFloat(row[offset + dims['Técnica'] + dims['Planejamento'] + dims['Motivacional']]);
    var aversivos_chave = parseFloat(row[offset + dims['Técnica'] + dims['Planejamento'] + dims['Motivacional'] + dims['Relação']]);
    // Enviar para Supabase
    var normId = normalizeCPF_(id);
    var payloadCBAS = {
      athlete_id: normId,
      data: dateVal instanceof Date ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd') : dateVal,
      tecnica: values['Técnica'],
      planejamento: values['Planejamento'],
      motivacional: values['Motivacional'],
      relacao: values['Relação'],
      aversivos: values['Aversivos'],
      tecnica_chave: tecnica_chave,
      planejamento_chave: planejamento_chave,
      motivacional_chave: motivacional_chave,
      relacao_chave: relacao_chave,
      aversivos_chave: aversivos_chave
    };
    sendToSupabase_('cbas_analysis', payloadCBAS);
  }
  // Calcular z‑scores
  dimNames.forEach(function(name, idxDim) {
    var m = mean(dimValues[name]);
    var sd = stddev(dimValues[name]);
    for (var r = 1; r < result.length; r++) {
      var val = result[r][2 + idxDim];
      var z = sd > 0 ? (val - m) / sd : 0;
      var zCol = 2 + dimNames.length + idxDim;
      result[r][zCol] = z;
    }
  });
  var analysisSheetName = 'CBAS_Analysis';
  var cSheet = ss.getSheetByName(analysisSheetName);
  if (!cSheet) cSheet = ss.insertSheet(analysisSheetName);
  cSheet.clearContents();
  cSheet.getRange(1,1,result.length,result[0].length).setValues(result);
  Logger.log('Análise CBAS concluída. Resultados em "CBAS_Analysis".');
}

/**
 * Analisa as respostas do formulário semanal reestruturado. Extrai peso, momento do preenchimento (pré/pós),
 * modalidade, duração do treino, avaliação de desempenho, adesão nutricional e comentários qualitativos.
 * Os resultados são enviados para Supabase (weekly_analysis) e uma aba "Weekly_Analysis" é criada na planilha.
 *
 * @param {string} sheetId ID da planilha de respostas do formulário semanal
 */
function analyzeWeeklyResponses(sheetId) {
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActive();
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log('Nenhuma resposta encontrada para análise semanal.');
    return;
  }
  var headers = data[0];
  function findIndex(sub) {
    for (var i = 0; i < headers.length; i++) {
      if (headers[i] && headers[i].toString().indexOf(sub) !== -1) {
        return i;
      }
    }
    return -1;
  }
  var idIdx = findIndex('ID do atleta');
  var dateIdx = findIndex('Data de início da semana');
  // Índices dos campos do formulário semanal. Não há mais perguntas de peso ou detalhes de treino.
  var desempenhoIdx = findIndex('como você avalia seu desempenho');
  var cansacoIdx = findIndex('Se esteve cansado');
  var comentariosIdx = findIndex('Outros comentários sobre sua semana');
  var adesaoIdx = findIndex('avalie sua adesão ao plano nutricional');
  var dietaComentIdx = findIndex('Comentários sobre sua alimentação');
  var eventosIdx = findIndex('Descreva brevemente eventos marcantes');
  var desempenhoVals = [];
  var adesaoVals = [];
  var result = [];
  result.push(['ID','Data início','Desempenho (1–5)','Adesão Nutricional (1–5)','Z-score desempenho','Z-score adesão']);
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var id = row[idIdx];
    var dateVal = row[dateIdx];
    var desempenho = desempenhoIdx >= 0 ? parseFloat(row[desempenhoIdx]) : NaN;
    var adesao = adesaoIdx >= 0 ? parseFloat(row[adesaoIdx]) : NaN;
    var cansaco = cansacoIdx >= 0 ? row[cansacoIdx] : '';
    var comentarios = comentariosIdx >= 0 ? row[comentariosIdx] : '';
    var dietaComent = dietaComentIdx >= 0 ? row[dietaComentIdx] : '';
    var eventos = eventosIdx >= 0 ? row[eventosIdx] : '';
    desempenhoVals.push(isNaN(desempenho) ? null : desempenho);
    adesaoVals.push(isNaN(adesao) ? null : adesao);
    result.push([id, dateVal, desempenho, adesao, '', '']);
    // Enviar para Supabase
    var payload = {
      athlete_id: normalizeCPF_(id),
      start_date: dateVal instanceof Date ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd') : dateVal,
      desempenho: isNaN(desempenho) ? null : desempenho,
      adesao_nutricional: isNaN(adesao) ? null : adesao,
      cansaco_acao: cansaco,
      semana_comentarios: comentarios,
      dieta_comentarios: dietaComent,
      eventos: eventos
    };
    sendToSupabase_('weekly_analysis', payload);
  }
  // Calcular z-scores para desempenho e adesão
  var despMean = mean(desempenhoVals.filter(function(v) { return typeof v === 'number'; }));
  var despStd = stddev(desempenhoVals.filter(function(v) { return typeof v === 'number'; }));
  var adMean = mean(adesaoVals.filter(function(v) { return typeof v === 'number'; }));
  var adStd = stddev(adesaoVals.filter(function(v) { return typeof v === 'number'; }));
  for (var i = 1; i < result.length; i++) {
    var d = result[i][2];
    var a = result[i][3];
    result[i][4] = (despStd > 0 && typeof d === 'number') ? (d - despMean) / despStd : 0;
    result[i][5] = (adStd > 0 && typeof a === 'number') ? (a - adMean) / adStd : 0;
  }
  var analysisName = 'Weekly_Analysis';
  var analysisSheet = ss.getSheetByName(analysisName);
  if (!analysisSheet) analysisSheet = ss.insertSheet(analysisName);
  analysisSheet.clearContents();
  analysisSheet.getRange(1,1,result.length,result[0].length).setValues(result);
  Logger.log('Análise semanal concluída. Resultados em "' + analysisName + '".');
}

/**
 * Analisa as respostas do formulário de cadastro do atleta. Cada linha é transformada em um objeto
 * JSON contendo todas as colunas e enviado ao Supabase na tabela athlete_registration. Os dados
 * são armazenados em um campo JSONB para facilitar consultas flexíveis. Uma aba "Athlete_Registration" é
 * gerada com as informações brutas para consulta local.
 *
 * @param {string} sheetId ID da planilha de respostas do cadastro do atleta
 */
function analyzeAthleteRegistrationResponses(sheetId) {
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActive();
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log('Nenhuma resposta encontrada para análise de cadastro.');
    return;
  }
  var headers = data[0];
  // Encontrar índice do ID interno e timestamp se existir
  var idIdx = headers.findIndex(function(h) { return h && h.toString().indexOf('ID interno do atleta') !== -1; });
  var timestampIdx = headers.findIndex(function(h) { return h && h.toString().toLowerCase().indexOf('timestamp') !== -1; });
  var result = [];
  result.push(headers);
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    var athleteId = '';
    if (idIdx >= 0) athleteId = normalizeCPF_(row[idIdx]);
    var dateVal = '';
    if (timestampIdx >= 0) {
      var ts = row[timestampIdx];
      if (ts instanceof Date) {
        dateVal = Utilities.formatDate(ts, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      } else {
        dateVal = ts;
      }
    }
    // Extrair peso ideal para a modalidade
    var idealWeightIdx = headers.findIndex(function(h) { return h && h.toString().indexOf('Peso ideal') !== -1; });
    var idealWeight = idealWeightIdx >= 0 ? parseFloat(row[idealWeightIdx]) : NaN;
    // Enviar para Supabase
    var payload = {
      athlete_id: athleteId,
      data: dateVal,
      payload: obj,
      ideal_weight_kg: isNaN(idealWeight) ? null : idealWeight
    };
    sendToSupabase_('athlete_registration', payload);
    result.push(row);
  }
  // Gravar na planilha uma aba de backup
  var analysisName = 'Athlete_Registration';
  var analysisSheet = ss.getSheetByName(analysisName);
  if (!analysisSheet) analysisSheet = ss.insertSheet(analysisName);
  analysisSheet.clearContents();
  analysisSheet.getRange(1,1,result.length,result[0].length).setValues(result);
  Logger.log('Análise de cadastro concluída. Dados enviados ao Supabase e armazenados em "' + analysisName + '".');
}
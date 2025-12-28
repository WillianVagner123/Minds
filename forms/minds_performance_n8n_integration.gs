/**
 * MINDS Performance – Integração com n8n e Webhooks
 *
 * Este arquivo mostra como integrar o pipeline de análise do Apps Script
 * com os webhooks utilizados pelo n8n para processar o questionário
 * construcional e para acionar o motor de scoring. Essas funções são
 * exemplos de como você pode disparar as requisições HTTP no momento
 * adequado (por exemplo, logo após salvar o raw do questionário ou
 * após gravar métricas diárias). Ajuste as URLs e payloads conforme
 * necessário.
 */

// Configurações das URLs dos webhooks. Ajuste conforme o seu ambiente.
var N8N_CONSTRUCIONAL_WEBHOOK_URL = 'https://autowebhook.opingo.com.br/webhook/Construcional';
var N8N_RUNSCORING_WEBHOOK_URL   = 'https://autowebhook.opingo.com.br/webhook/RunScoring';

/**
 * Envia o questionário construcional bruto para o n8n. O n8n irá
 * classificar o texto e, por meio do seu workflow, gravar o
 * resultado no Supabase usando a RPC upsert_construcional_analysis.
 *
 * @param {number} construcionalRawId ID do registro na tabela construcional_raw
 * @param {string} athleteId Identificador do atleta
 * @param {string} texto Texto completo da resposta do questionário
 */
function sendConstrucionalToN8n(construcionalRawId, athleteId, texto) {
  var payload = {
    construcional_raw_id: construcionalRawId,
    athlete_id: athleteId,
    texto: texto
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  try {
    var response = UrlFetchApp.fetch(N8N_CONSTRUCIONAL_WEBHOOK_URL, options);
    Logger.log('Construcional webhook status: ' + response.getResponseCode());
  } catch (err) {
    Logger.log('Erro ao enviar para o webhook construcional: ' + err);
  }
}

/**
 * Dispara o webhook de scoring para o n8n. O n8n buscará as
 * entradas consolidadas (view pingo_scoring_inputs_view) no Supabase,
 * aplicará as regras de scoring e gravará o resultado em
 * pingo_scoring_output. Se necessário, passamos a data de referência.
 *
 * @param {string} athleteId Identificador do atleta
 * @param {string} referenceDate Data de referência (yyyy-mm-dd), opcional
 */
function sendRunScoringToN8n(athleteId, referenceDate) {
  var payload = {
    athlete_id: athleteId
  };
  if (referenceDate) payload.reference_date = referenceDate;

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  try {
    var response = UrlFetchApp.fetch(N8N_RUNSCORING_WEBHOOK_URL, options);
    Logger.log('RunScoring webhook status: ' + response.getResponseCode());
  } catch (err) {
    Logger.log('Erro ao enviar para o webhook RunScoring: ' + err);
  }
}

/**
 * Exemplo de uso integrado: após processar o formulário diário e
 * gravar as métricas no Supabase, você pode chamar esta função
 * para disparar o motor de scoring para o atleta.
 *
 * @param {string} athleteId Identificador do atleta
 */
function processDailyAndScore(athleteId) {
  // Aqui você chamaria suas funções de análise para salvar
  // brums_analysis, diet_daily, etc., com base nas respostas do
  // formulário. Após a gravação, acione o motor de scoring:

  var today = new Date();
  var refDate = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  sendRunScoringToN8n(athleteId, refDate);
}

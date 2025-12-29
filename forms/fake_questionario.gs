/**
 * Preenche TUDO o que tiver em cada formulário (valores padrão)
 * e envia 1 resposta por formulário.
 *
 * Suporta:
 * TEXT, PARAGRAPH_TEXT, MULTIPLE_CHOICE, LIST, CHECKBOX, SCALE, DATE, TIME,
 * GRID (MultipleChoiceGrid), CHECKBOX_GRID
 *
 * Não suporta:
 * FILE_UPLOAD (Google não permite via Apps Script)
 */

const FIXED_PHONE = "5561999094945";
const FIXED_CPF   = "03696973183";
const FIXED_TR_ID = "TR_TESTE_001";

/**
 * ✅ FORM IDs ATUALIZADOS (a partir dos links que você mandou)
 */
const FORM_IDS = {
  // Cadastro
  registration:  "1INcR66zUK0DZaxAAvxS5LVP5UcZvxZUN7IkSfU5c5FE",

  // Diária / Semanal
  daily:         "1YS1ysW2yMxj5ql2f0JTt25BRsSaC-oNLJoArjCn1NGA",
  weekly:        "1kJt4GVkgJnu54KYAUTfZ9f7hmLTGv70W-mpQabWGtT4",

  // Trimestral / Semestral
  quarterly:     "11NhuV6QEOiT8ge1ww-9RjDM-E3aYuBKvmlgcnDHKfmk",
  semiannual:    "1NEwKXf7aj49xKxkRDj1TScLRxRRBvtOa9HuuhqnYVYg",

  // RESTQ Treinador
  restq_trainer: "1sNl76o3CkJt00rtic_8OyddUlyK1L3gKe-Dyk-y2WYg",

  // ✅ Construcional (novo)
  construcional: "13O-c_tJ66wTPmUrnoMB4cslecJd3zwitBse3ggPEaho",
};

function submitAllForms_FillEverything() {
  const tz = Session.getScriptTimeZone();
  const stamp = Utilities.formatDate(new Date(), tz, "yyyyMMdd_HHmmss");

  const results = {};
  for (const [key, id] of Object.entries(FORM_IDS)) {
    try {
      const form = FormApp.openById(id);
      const out = submitOneFullResponse_(form, { key, stamp, now: new Date() });

      results[key] = {
        ok: true,
        formId: id,
        responseId: out.responseId,
        warnings: out.warnings,
      };

      Logger.log(`[OK] ${key} -> responseId=${out.responseId}`);
      if (out.warnings.length) Logger.log(`[WARN] ${key} -> ${JSON.stringify(out.warnings, null, 2)}`);

    } catch (e) {
      results[key] = { ok: false, formId: id, error: String(e && e.message ? e.message : e) };
      Logger.log(`[ERRO] ${key} (${id}): ${String(e)}`);
    }
  }

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

/* =========================
   CORE: 1 resposta completa
========================= */

function submitOneFullResponse_(form, ctx) {
  const items = form.getItems();
  let response = form.createResponse();
  const warnings = [];

  for (const it of items) {
    const type = it.getType();
    const title = (it.getTitle() || "").trim();

    // Ignora itens sem resposta (page break, section header etc.)
    if (!title && type !== FormApp.ItemType.GRID && type !== FormApp.ItemType.CHECKBOX_GRID) continue;

    const itemResp = createAutoResponseForItem_(it, type, title, ctx, warnings);

    // Se o tipo não permite automação, registra aviso
    if (!itemResp) continue;

    response = response.withItemResponse(itemResp);
  }

  const submitted = response.submit();
  return { responseId: submitted.getId(), warnings };
}

/* =========================
   AUTO-RESPOSTAS POR TIPO
========================= */

function createAutoResponseForItem_(it, type, title, ctx, warnings) {
  const now = ctx.now;

  try {
    switch (type) {
      case FormApp.ItemType.TEXT: {
        const t = it.asTextItem();
        return t.createResponse(defaultText_(title, ctx));
      }

      case FormApp.ItemType.PARAGRAPH_TEXT: {
        const p = it.asParagraphTextItem();
        return p.createResponse(defaultParagraph_(title, ctx));
      }

      case FormApp.ItemType.MULTIPLE_CHOICE: {
        const mc = it.asMultipleChoiceItem();
        const choices = mc.getChoices();
        if (!choices.length) return null;
        const pick = pickFirstNonOther_(choices);
        return mc.createResponse(pick);
      }

      case FormApp.ItemType.LIST: {
        const li = it.asListItem();
        const choices = li.getChoices();
        if (!choices.length) return null;
        const pick = pickFirstNonOther_(choices);
        return li.createResponse(pick);
      }

      case FormApp.ItemType.CHECKBOX: {
        const cb = it.asCheckboxItem();
        const choices = cb.getChoices();
        if (!choices.length) return null;
        const vals = pickSomeNonOther_(choices, 2);
        return cb.createResponse(vals);
      }

      case FormApp.ItemType.SCALE: {
        const sc = it.asScaleItem();
        const low = sc.getLowerBound();
        const high = sc.getUpperBound();
        const mid = Math.round((low + high) / 2);
        return sc.createResponse(mid);
      }

      case FormApp.ItemType.DATE: {
        const d = it.asDateItem();
        return d.createResponse(now);
      }

      case FormApp.ItemType.TIME: {
        const tm = it.asTimeItem();
        return tm.createResponse(now);
      }

      case FormApp.ItemType.GRID: {
        // MultipleChoiceGrid: 1 coluna por linha
        const g = it.asGridItem();
        const rows = g.getRows();
        const cols = g.getColumns();
        if (!rows.length || !cols.length) return null;

        const colPick = cols[0];
        const answers = rows.map(() => colPick);
        return g.createResponse(answers);
      }

      case FormApp.ItemType.CHECKBOX_GRID: {
        // CheckboxGrid: lista de colunas por linha
        const cg = it.asCheckboxGridItem();
        const rows = cg.getRows();
        const cols = cg.getColumns();
        if (!rows.length || !cols.length) return null;

        const pick = [cols[0]];
        const answers = rows.map(() => pick);
        return cg.createResponse(answers);
      }

      case FormApp.ItemType.FILE_UPLOAD: {
        warnings.push({ title, type: String(type), reason: "FILE_UPLOAD não pode ser automatizado via Apps Script." });
        return null;
      }

      default: {
        warnings.push({ title, type: String(type), reason: "Tipo não tratado ainda." });
        return null;
      }
    }
  } catch (e) {
    warnings.push({ title, type: String(type), reason: "Erro criando resposta: " + String(e) });
    return null;
  }
}

/* =========================
   HELPERS
========================= */

function defaultText_(title, ctx) {
  const s = ctx.stamp;
  const t = (title || "").toLowerCase();

  // força o telefone em qualquer campo “cara de telefone”
  if (t.includes("telefone") || t.includes("whatsapp") || t.includes("celular") || t.includes("contato") || t.includes("phone")) {
    return FIXED_PHONE;
  }

  // ✅ treinador: TR_ID / id do treinador
  if (t.includes("tr_id") || (t.includes("id") && t.includes("treinador")) || (t.includes("trainer") && t.includes("id"))) {
    return FIXED_TR_ID;
  }

  // ✅ nome do treinador
  if ((t.includes("nome") && t.includes("treinador")) || (t.includes("trainer") && t.includes("name"))) {
    return "Treinador Teste " + s;
  }

  // força CPF/ID do atleta
  // cobre títulos como: "ATHLETE_ID | ...", "ID do atleta", "CPF", "Documento"
  if (t.includes("athlete_id") || (t.includes("id") && t.includes("atleta")) || t.includes("cpf") || t.includes("documento")) {
    return FIXED_CPF;
  }

  if (t.includes("nome")) return "Teste " + s;
  if (t.includes("email")) return "teste+" + s + "@example.com";
  if (t.includes("peso") || t.includes("weight")) return "70";
  if (t.includes("idade") || t.includes("age")) return "18";
  if (t.includes("minuto") || t.includes("duração") || t.includes("duracao") || t.includes("duration")) return "60";

  return "Teste " + s;
}

function defaultParagraph_(title, ctx) {
  return "Resposta automática para teste de triggers. Ref: " + ctx.stamp;
}

function pickFirstNonOther_(choices) {
  for (const c of choices) {
    const v = c.getValue();
    if (!String(v).toLowerCase().includes("outro")) return v;
  }
  return choices[0].getValue();
}

function pickSomeNonOther_(choices, maxN) {
  const vals = [];
  for (const c of choices) {
    const v = c.getValue();
    if (String(v).toLowerCase().includes("outro")) continue;
    vals.push(v);
    if (vals.length >= maxN) break;
  }
  if (!vals.length) vals.push(choices[0].getValue());
  return vals;
}

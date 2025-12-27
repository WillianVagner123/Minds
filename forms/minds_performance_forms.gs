/**
 * MINDS Performance – Construção de Formulários (com prefixos nas perguntas)
 *
 * Este script recria todos os formulários utilizados no fluxo MINDS
 * adicionando um prefixo de código único a cada pergunta. O objetivo
 * principal é tornar cada campo estável para mapeamento posterior
 * (análises no Supabase, n8n, etc.).
 *
 * Como usar:
 * 1) Cole este código em um projeto Apps Script (script.google.com)
 * 2) Ajuste as variáveis no topo conforme necessário (ID da planilha mãe,
 *    nome dos formulários, prefixos, etc.)
 * 3) Execute createAllFormsLinkedPrefixed() para criar ou atualizar todos
 *    os formulários de uma vez e vinculá‑los à planilha mãe.
 */

/* =========================
   VARIÁVEIS GLOBAIS
========================= */

// Se já existir uma planilha mãe para respostas, cole aqui o ID.
// Deixe em branco para criar uma nova planilha automaticamente.
var MASTER_SHEET_ID = "";

// Nome padrão da planilha mãe (usado caso seja criada automaticamente)
var MASTER_SHEET_NAME = "MINDS – Respostas (Mãe)";

// Prefixo de organização para os formulários (aparecerá no título de cada form)
var FORMS_PREFIX = "MINDS Performance – ";

// Nomes fixos das abas de respostas na planilha mãe (uma aba por formulário)
var TAB_NAMES = {
  DAILY: "RESP_DAILY",
  WEEKLY: "RESP_WEEKLY",
  QUARTERLY: "RESP_QUARTERLY",
  SEMIANNUAL: "RESP_SEMIANNUAL",
  RESTQ_TRAINER: "RESP_RESTQ_TRAINER",
  REGISTRATION: "RESP_REGISTRATION"
};

/* =========================
   FUNÇÕES AUXILIARES: PLANILHA MÃE E VÍNCULO
========================= */

/**
 * Garante a existência da planilha mãe de respostas.
 * Se MASTER_SHEET_ID estiver vazio, tenta ler de ScriptProperties.
 * Caso não exista, cria uma nova planilha e salva o ID em ScriptProperties.
 * @returns {Spreadsheet} instância da planilha mãe
 */
function ensureMasterSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var sid = (MASTER_SHEET_ID || "").trim();
  if (!sid) sid = (props.getProperty("MASTER_SHEET_ID") || "").trim();
  var ss;
  if (sid) {
    ss = SpreadsheetApp.openById(sid);
  } else {
    ss = SpreadsheetApp.create(MASTER_SHEET_NAME);
    sid = ss.getId();
    props.setProperty("MASTER_SHEET_ID", sid);
  }
  MASTER_SHEET_ID = sid;
  return ss;
}

/**
 * Vincula um Google Form à planilha mãe e renomeia a aba de respostas.
 * Baseado no script original: detecta a nova aba criada após setDestination
 * e renomeia para o nome definido em TAB_NAMES.
 * @param {FormApp.Form} form instância do formulário a ser vinculado
 * @param {Spreadsheet} masterSs planilha mãe já aberta
 * @param {string} tabName nome desejado da aba
 */
function linkFormToMasterAndRenameTab_(form, masterSs, tabName) {
  if (!form) throw new Error("Form inválido.");
  if (!masterSs) throw new Error("Planilha mãe inválida.");
  if (!tabName) throw new Error("Nome da aba não pode ser vazio.");
  // Snapshot dos IDs de abas antes do vínculo
  var beforeIds = masterSs.getSheets().map(function(sh){ return sh.getSheetId(); });
  // Define a planilha de destino para o Form
  form.setDestination(FormApp.DestinationType.SPREADSHEET, masterSs.getId());
  // Aguarda a criação da nova aba (máx 12 tentativas com sleep de ~0.7s)
  var newSheet = waitForNewResponseSheet_(masterSs, beforeIds, 12, 700);
  // Renomeia a aba nova para evitar conflito com nomes antigos
  renameSheetSafely_(masterSs, newSheet, tabName);
  return newSheet;
}

/**
 * Espera a criação de uma nova aba de respostas, comparando IDs de abas antes e depois.
 * Tenta algumas vezes até encontrar uma aba diferente. Se falhar, tenta achar
 * uma aba que contenha "Form Responses" no nome.
 * @param {Spreadsheet} ss planilha mãe
 * @param {number[]} beforeIds lista de IDs antes do vínculo
 * @param {number} attempts número de tentativas
 * @param {number} sleepMs intervalo em milissegundos entre tentativas
 * @returns {Sheet} a aba recém criada
 */
function waitForNewResponseSheet_(ss, beforeIds, attempts, sleepMs) {
  attempts = attempts || 10;
  sleepMs = sleepMs || 600;
  for (var i = 0; i < attempts; i++) {
    var sheets = ss.getSheets();
    var afterIds = sheets.map(function(sh){ return sh.getSheetId(); });
    var created = [];
    afterIds.forEach(function(id) {
      if (beforeIds.indexOf(id) === -1) created.push(id);
    });
    if (created.length > 0) {
      var createdId = created[0];
      for (var s = 0; s < sheets.length; s++) {
        if (sheets[s].getSheetId() === createdId) return sheets[s];
      }
    }
    Utilities.sleep(sleepMs);
    SpreadsheetApp.flush();
  }
  // Fallback: tenta encontrar uma aba com "form responses" no nome
  var fallback = ss.getSheets().filter(function(sh){
    var n = sh.getName();
    return n && n.toLowerCase().indexOf("form responses") !== -1;
  });
  if (fallback.length) return fallback[fallback.length - 1];
  throw new Error("Não foi possível detectar a aba de respostas criada pelo vínculo do Form.");
}

/**
 * Renomeia uma aba. Se já existir uma aba com o nome desejado e não for a mesma aba,
 * renomeia a existente para backup antes de renomear a nova.
 * @param {Spreadsheet} ss planilha onde renomear
 * @param {Sheet} sheet aba a ser renomeada
 * @param {string} desiredName nome desejado
 */
function renameSheetSafely_(ss, sheet, desiredName) {
  var existing = ss.getSheetByName(desiredName);
  if (existing && existing.getSheetId() !== sheet.getSheetId()) {
    var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");
    existing.setName(desiredName + "_OLD_" + ts);
  }
  sheet.setName(desiredName);
}

/* =========================
   CRIAÇÃO DE FORMULÁRIOS COM PREFIXO
========================= */

/**
 * Cria o formulário diário (BRUMS, carga de treino e nutrição) com prefixos nas perguntas.
 * @returns {FormApp.Form} o formulário criado
 */
function createDailyFormPrefixed() {
  var form = FormApp.create(FORMS_PREFIX + "Avaliação Diária");
  form.setDescription(
    'Formulário diário com prefixos em cada pergunta. Inclui: (1) BRUMS – Escala de Humor, ' +
    '(2) Carga de treino (RPE × duração), (3) Check‑in rápido de energia/vigor, (4) Nutrição, ' +
    'e (5) Detalhes sobre o treino. Tempo estimado: ~5 minutos.'
  );

  // Identificação
  form.addTextItem().setTitle('ATHLETE_ID | ID do atleta (código interno ou CPF)').setRequired(true);
  form.addDateItem().setTitle('DAILY_DATE | Data da avaliação').setRequired(true);

  // BRUMS – 24 itens (0–4)
  form.addPageBreakItem().setTitle('BRUMS – Escala de Humor');
  var brumsItems = [
    'Tenso(a)', 'Nervoso(a)', 'Ansioso(a)', 'Estressado(a)',
    'Triste', 'Deprimido(a)', 'Miserável', 'Desanimado(a)',
    'Furioso(a)', 'Irritado(a)', 'Incomodado(a)', 'Mal-humorado(a)',
    'Energético(a)', 'Alerta', 'Desperto(a)', 'Vivo(a)',
    'Cansado(a)', 'Exausto(a)', 'Sem energia', 'Letárgico(a)',
    'Confuso(a)', 'Desorientado(a)', 'Em dúvida', 'Esquecido(a)'
  ];
  brumsItems.forEach(function(item, idx) {
    var code = 'BRUMS_Q' + String(idx + 1).padStart(2, '0');
    form.addScaleItem()
      .setTitle(code + ' | Nas últimas horas eu me senti... ' + item)
      .setBounds(0, 4)
      .setLabels('Nada', 'Extremamente')
      .setRequired(true);
  });

  // Carga de treino
  form.addPageBreakItem().setTitle('Carga de Treino');
  form.addScaleItem()
    .setTitle('DAILY_RPE | Percepção subjetiva de esforço (RPE) da sessão')
    .setBounds(0, 10)
    .setLabels('Muito fácil', 'Máximo')
    .setRequired(true);
  form.addTextItem()
    .setTitle('DAILY_DUR | Duração da sessão (minutos)')
    .setHelpText('Somente números. Ex.: 60')
    .setRequired(true);

  // Vigor momentâneo (4 itens) – escala 0–4
  form.addPageBreakItem().setTitle('Check‑in de Energia / Vigor');
  var vigorItems = ['Energético(a)', 'Alerta', 'Desperto(a)', 'Vivo(a)'];
  vigorItems.forEach(function(item, idx) {
    var code = 'VIGOR_Q' + String(idx + 1).padStart(2, '0');
    form.addScaleItem()
      .setTitle(code + ' | No momento, eu me sinto... ' + item)
      .setBounds(0, 4)
      .setLabels('Nada', 'Extremamente')
      .setRequired(true);
  });

  // Nutrição (adesão, missed meals, low energy, GI)
  form.addPageBreakItem().setTitle('Nutrição – Check‑in Diário');
  form.addScaleItem()
    .setTitle('DAILY_ADH | Hoje, o quanto você conseguiu seguir o plano alimentar combinado?')
    .setBounds(1, 5)
    .setLabels('Muito pouco', 'Quase tudo / totalmente')
    .setRequired(true);
  var missedMeals = form.addMultipleChoiceItem();
  missedMeals.setTitle('DAILY_MISSED | Hoje você deixou de fazer alguma refeição importante (café, almoço, jantar ou lanche pré/pós)?')
    .setChoices([
      missedMeals.createChoice('Não'),
      missedMeals.createChoice('Sim, 1 refeição'),
      missedMeals.createChoice('Sim, 2 ou mais')
    ])
    .setRequired(true);
  var lowEnergy = form.addMultipleChoiceItem();
  lowEnergy.setTitle('DAILY_LOW | Hoje você sentiu que comeu menos do que precisava para treinar/recuperar bem?')
    .setChoices([
      lowEnergy.createChoice('Não'),
      lowEnergy.createChoice('Sim')
    ])
    .setRequired(true);
  form.addScaleItem()
    .setTitle('DAILY_GI | Hoje, qual foi o nível de desconforto gastrointestinal (estômago/intestino)?')
    .setBounds(0, 10)
    .setLabels('Nenhum', 'Muito alto')
    .setRequired(true);

  // Peso e detalhes de treino
  form.addPageBreakItem().setTitle('Peso e Detalhes de Treino');
  form.addTextItem()
    .setTitle('DAILY_WEIGHT | Peso corporal (kg)')
    .setHelpText('Em kg. Use ponto para decimais.')
    .setRequired(false);
  var prePost = form.addMultipleChoiceItem();
  prePost.setTitle('DAILY_MOMENT | Você está preenchendo este questionário em qual momento?')
    .setChoices([
      prePost.createChoice('Pré‑treino'),
      prePost.createChoice('Pós‑treino'),
      prePost.createChoice('Nenhum / Outro')
    ])
    .setRequired(true);
  form.addTextItem()
    .setTitle('DAILY_MODALITY | Modalidade do treino')
    .setHelpText('Ex.: corrida, musculação, ciclismo…')
    .setRequired(false);
  form.addTextItem()
    .setTitle('DAILY_TIME | Tempo de treino (minutos)')
    .setHelpText('Pré: estimativa. Pós: duração real.')
    .setRequired(false);

  return form;
}

/**
 * Cria o formulário semanal com prefixos nas perguntas.
 * @returns {FormApp.Form} o formulário criado
 */
function createWeeklyFormPrefixed() {
  var form = FormApp.create(FORMS_PREFIX + "Avaliação Semanal");
  form.setDescription(
    'Formulário semanal com prefixos. Avalia a percepção do atleta sobre a semana (desempenho, sono, treinos), ' +
    'adesão ao plano nutricional e eventos marcantes.'
  );
  form.addTextItem().setTitle('ATHLETE_ID | ID do atleta (código interno ou CPF)').setRequired(true);
  form.addDateItem().setTitle('WEEK_START | Data de início da semana (segunda‑feira)').setRequired(true);
  form.addPageBreakItem().setTitle('Autopercepção Semanal');
  form.addScaleItem()
    .setTitle('WEEK_PERF | Nesta semana, como você avalia seu desempenho considerando dieta, sono, treinos e competições?')
    .setBounds(1, 5)
    .setLabels('Muito ruim', 'Excelente')
    .setRequired(true);
  form.addParagraphTextItem()
    .setTitle('WEEK_RECOVERY | Se esteve cansado(a) esta semana, o que você fez para se recuperar ou lidar com o cansaço?')
    .setRequired(false);
  form.addParagraphTextItem()
    .setTitle('WEEK_COMMENTS | Outros comentários sobre sua semana (sentimentos, percepções, etc.)')
    .setRequired(false);
  form.addPageBreakItem().setTitle('Adesão ao Plano Nutricional');
  form.addScaleItem()
    .setTitle('WEEK_ADH | Nesta semana, avalie sua adesão ao plano nutricional')
    .setBounds(1, 5)
    .setLabels('Muito baixa', 'Excelente')
    .setRequired(true);
  form.addParagraphTextItem()
    .setTitle('WEEK_NUTR_COMMENTS | Comentários sobre sua alimentação nesta semana (opcional)')
    .setRequired(false);
  form.addPageBreakItem().setTitle('Eventos Marcantes de Treino/Competição');
  form.addParagraphTextItem()
    .setTitle('WEEK_EVENTS | Descreva eventos marcantes ou incomuns nos treinos/competições da semana (opcional)')
    .setHelpText('Resultados importantes, lesões, mudanças de rotina etc.')
    .setRequired(false);
  return form;
}

/**
 * Cria o formulário trimestral (GSES, ACSI, PMCSQ, RESTQ) com prefixos nas perguntas.
 * @returns {FormApp.Form} o formulário criado
 */
function createQuarterlyFormPrefixed() {
  var form = FormApp.create(FORMS_PREFIX + "Avaliação Trimestral");
  form.setDescription(
    'Formulário trimestral com prefixos, incluindo GSES, ACSI, PMCSQ e RESTQ-Sport (atleta). Tempo estimado: ~25 minutos.'
  );
  form.addTextItem().setTitle('ATHLETE_ID | ID do atleta (código interno ou CPF)').setRequired(true);
  form.addDateItem().setTitle('QUART_DATE | Data da avaliação').setRequired(true);

  // GSES – Itens de autoeficácia (original tem 10 itens)
  form.addPageBreakItem().setTitle('GSES – Autoeficácia Geral');
  var gsesItems = [
    'Se estou com problemas, geralmente encontro uma saída.',
    'Mesmo que alguém se oponha, eu encontro maneiras e formas de alcançar o que quero.',
    'Tenho confiança para me sair bem em situações inesperadas.',
    'Eu posso resolver a maioria dos problemas, se fizer o esforço necessário.',
    'Quando enfrento um problema, geralmente consigo encontrar diversas soluções.',
    'Consigo sempre resolver os problemas difíceis quando me esforço bastante.',
    'Tenho facilidade para persistir em minhas intenções e alcançar meus objetivos.',
    'Devido às minhas capacidades, sei como lidar com situações imprevistas.',
    'Eu me mantenho calmo mesmo enfrentando dificuldades porque confio na minha capacidade de resolver problemas.',
    'Eu geralmente consigo enfrentar qualquer adversidade.'
  ];
  gsesItems.forEach(function(text, idx) {
    var code = 'GSES_Q' + String(idx + 1).padStart(2, '0');
    form.addScaleItem()
      .setTitle(code + ' | ' + text)
      .setBounds(1, 5)
      .setLabels('Discordo totalmente', 'Concordo totalmente')
      .setRequired(true);
  });

  // ACSI – 28 itens (coping skills)
  form.addPageBreakItem().setTitle('ACSI – Habilidades de Enfrentamento');
  var acsiItems = [
    'Diariamente ou semanalmente eu estabeleço metas muito específicas que me guiam no que fazer.',
    'Eu tiro o maior proveito dos meus talentos e habilidades.',
    'Quando o treinador ou técnico me diz como corrigir um erro que eu tenha cometido eu tenho tendência a ficar aborrecido/incomodado.',
    'Quando estou praticando esportes, eu consigo focar minha atenção e bloquear distrações.',
    'Eu permaneço positivo e entusiasmado durante a competição, não importa quão ruim a situação esteja.',
    'Minha tendência é competir melhor sob pressão, pois eu penso mais claramente.',
    'Eu me preocupo um pouco sobre o que as pessoas pensam sobre meu desempenho.',
    'Tenho tendência a fazer muitos planos sobre como atingir minhas metas.',
    'Eu sinto confiante de que eu irei competir bem.',
    'Quando um técnico ou treinador me critica, eu fico aborrecido/incomodado ao invés de me sentir ajudado.',
    'É fácil me manter concentrado em uma tarefa mesmo quando estou assistindo ou ouvindo algo.',
    'Eu me pressiono muito ao me preocupar como será meu desempenho.',
    'Eu estabeleço minhas próprias metas de desempenho para cada prática.',
    'Eu não necessito que me recomendem a praticar ou competir duro; eu dou 100%.',
    'Se um técnico me criticar ou gritar comigo, eu corrijo o erro sem ficar aborrecido/incomodado com isso.',
    'Eu lido com situações inesperadas no meu esporte muito bem.',
    'Quando as coisas estão ruins, eu digo a mim mesmo para ficar calmo e isso funciona para mim.',
    'Eu me sinto melhor quanto mais pressão houver na competição.',
    'Durante as competições eu me preocupo se vou cometer erros ou não vou conseguir ir até o fim.',
    'Eu tenho meu plano de competição completamente estruturado na minha mente muito antes de começar.',
    'Quando eu sinto que estou ficando muito tenso, eu posso rapidamente relaxar meu corpo e me acalmar.',
    'Para mim, situações sob pressão são desafios que eu recebo bem.',
    'Eu penso e imagino sobre o que irá acontecer se eu falhar ou estragar tudo.',
    'Eu mantenho o controle emocional, não importa como as coisas estão indo comigo.',
    'Para mim é fácil direcionar minha atenção e focar em um único objeto ou pessoa.',
    'Quando falho em minhas metas, isso me faz tentar mais ainda.',
    'Eu aperfeiçoo minhas habilidades escutando cuidadosamente aos conselhos e instruções dos técnicos e treinadores.',
    'Eu cometo menos erros quando estou sob pressão porque me concentro melhor.'
  ];
  acsiItems.forEach(function(text, idx) {
    var code = 'ACSI_Q' + String(idx + 1).padStart(2, '0');
    form.addScaleItem()
      .setTitle(code + ' | ' + text)
      .setBounds(0, 3)
      .setLabels('Quase nunca', 'Quase sempre')
      .setRequired(true);
  });

  // PMCSQ – Clima Motivacional (tarefas x ego) – 34 itens (lista completa)
  form.addPageBreakItem().setTitle('PMCSQ – Clima Motivacional no Esporte');
  form.addSectionHeaderItem().setTitle('Instruções: Responda de 1 (Discordo totalmente) a 5 (Concordo totalmente).');
  var pmcsqItems = [
    'Os jogadores/atletas trabalham muito para aprender novas habilidades.',
    'O treinador dá atenção quando um jogador melhora alguma habilidade.',
    'Os jogadores/atletas ajudam uns aos outros a aprender.',
    'Os jogadores/atletas são encorajados a tentar tarefas difíceis.',
    'O esforço é recompensado.',
    'Os jogadores/atletas recebem elogios quando melhoram.',
    'Os jogadores/atletas são incentivados a ajudar seus companheiros.',
    'Os jogadores/atletas realmente trabalham juntos como equipe.',
    'Os jogadores/atletas sentem que todos têm um papel importante.',
    'O foco é melhorar em cada treino.',
    'Os jogadores/atletas são reconhecidos por demonstrar esforço.',
    'Os jogadores/atletas são encorajados a trabalhar nas próprias fraquezas.',
    'O treinador enfatiza que tentar o seu melhor é importante.',
    'Cada jogador/atleta é tratado como membro importante da equipe.',
    'Os jogadores/atletas se ajudam a melhorar e se destacar.',
    'O treinador encoraja os jogadores/atletas a se ajudarem.',
    'Apenas os jogadores/atletas com as melhores estatísticas são elogiados.',
    'Os jogadores/atletas são punidos quando cometem um erro.',
    'Cada jogador/atleta tem um papel importante.',
    'O esforço é recompensado.',
    'O treinador encoraja os jogadores/atletas a se ajudarem.',
    'O treinador deixa claro quem ele acha que são os melhores jogadores/atletas.',
    'Os jogadores/atletas ficam “empolgados” quando se saem melhor do que seus companheiros de equipe.',
    'Se você quer jogar em um jogo, você deve ser um dos melhores jogadores/atletas.',
    'O treinador enfatiza tentar sempre o seu melhor.',
    'Apenas os melhores jogadores/atletas são notados pelo treinador.',
    'Os jogadores/atletas têm medo de cometer erros.',
    'Os jogadores/atletas são encorajados a trabalhar em suas fraquezas.',
    'O treinador favorece alguns jogadores/atletas mais do que outros.',
    'O foco é melhorar a cada jogo/treino.',
    'Os jogadores/atletas realmente trabalham juntos como uma equipe.',
    'Cada jogador/atleta se sente como se fosse um membro importante da equipe.',
    'Os jogadores/atletas se ajudam a melhorar e a se destacar.'
  ];
  pmcsqItems.forEach(function(text, idx) {
    var code = 'PMCSQ_Q' + String(idx + 1).padStart(2, '0');
    form.addScaleItem()
      .setTitle(code + ' | ' + text)
      .setBounds(1, 5)
      .setLabels('Discordo totalmente', 'Concordo totalmente')
      .setRequired(true);
  });

  // RESTQ-Sport (Atleta) – escala 0–6
  form.addPageBreakItem().setTitle('RESTQ-Sport – Estresse e Recuperação (Atleta)');
  var restqAthleteItems = [
    'Eu assisti televisão.',
    'Eu não dormi o suficiente.',
    'Eu terminei tarefas importantes.',
    'Eu não consegui me concentrar bem.',
    'Tudo me aborrecia.',
    'Eu ri.',
    'Eu me senti fisicamente mal.',
    'Eu estava de mal humor.',
    'Eu me senti fisicamente relaxado.',
    'Eu estava de bom humor (alegre).',
    'Eu tive dificuldades de me concentrar.',
    'Eu me preocupei com problemas não resolvidos.',
    'Eu me senti à vontade (relaxado).',
    'Eu passei bons momentos com amigos.',
    'Eu tive dor de cabeça.',
    'Eu estava cansado por causa do trabalho.',
    'Eu tive sucesso no que eu fiz.',
    'Eu não consegui desligar a minha mente.',
    'Eu caí no sono, satisfeito e relaxado.',
    'Eu me senti desconfortável.',
    'Eu fui aborrecido pelos outros.',
    'Eu me senti para baixo.',
    'Eu visitei alguns amigos próximos.',
    'Eu me senti deprimido.',
    'Eu estava morto de cansaço após o trabalho.',
    'Outras pessoas me irritaram.',
    'Eu tive um sono satisfatório.',
    'Eu me sentia ansioso ou inibido.',
    'Eu me senti em boa forma física.',
    'Eu estava chateado com tudo.',
    'Eu estava letárgico (sem reação).',
    'Eu senti que tinha que desempenhar bem na frente dos outros.',
    'Eu me diverti.',
    'Eu estava de bom humor.',
    'Eu estava muito cansado.',
    'Eu dormi inquietamente (sono agitado).',
    'Eu fiquei aborrecido.',
    'Eu me senti que poderia fazer tudo.',
    'Eu estava aflito.',
    'Eu parei de tomar decisões.',
    'Eu tomei decisões importantes.',
    'Eu me senti fisicamente exausto.',
    'Eu me senti feliz.',
    'Eu me senti pressionado.',
    'Tudo era demais para mim.',
    'Meu sono era interrompido facilmente.',
    'Eu me senti contente.',
    'Eu estava zangado com alguém.'
  ];
  restqAthleteItems.forEach(function(text, idx) {
    var code = 'RESTQA_Q' + String(idx + 1).padStart(2, '0');
    form.addScaleItem()
      .setTitle(code + ' | ' + text)
      .setBounds(0, 6)
      .setLabels('Nunca', 'Sempre')
      .setRequired(true);
  });
  return form;
}

/**
 * Cria o formulário semestral em que o atleta avalia o treinador (CBAS/LSS) com prefixos.
 * @returns {FormApp.Form} o formulário criado
 */
function createSemiannualFormPrefixed() {
  var form = FormApp.create(FORMS_PREFIX + "Avaliação Semestral – CBAS/LSS");
  form.setDescription('Formulário semestral em que o atleta avalia seu treinador. Tempo estimado: 5–7 minutos.');
  // Campos básicos
  form.addTextItem().setTitle('ATHLETE_ID | ID do atleta (código interno ou CPF)').setRequired(true);
  form.addTextItem().setTitle('SEMI_COACH_NAME | Nome do treinador avaliado').setRequired(true);
  form.addTextItem().setTitle('SEMI_TEAM | Categoria / Equipe (ex.: Sub-17, Adulto)').setRequired(false);
  form.addTextItem().setTitle('SEMI_PERIOD | Período avaliado (ex.: 1º semestre 2025)').setRequired(false);
  // Função auxiliar para adicionar um bloco de escala com prefixo
  function addBlock(prefix, title, items) {
    form.addPageBreakItem().setTitle(title);
    items.forEach(function(text, idx) {
      var code = prefix + '_Q' + String(idx + 1).padStart(2, '0');
      form.addScaleItem()
        .setTitle(code + ' | ' + text)
        .setBounds(1, 5)
        .setLabels('Quase nunca', 'Quase sempre')
        .setRequired(true);
    });
  }
  addBlock('SEMI_TECH', 'Técnica', [
    'O treinador fornece instruções claras.',
    'O treinador demonstra domínio técnico da modalidade.',
    'O treinador explica o porquê dos exercícios e tarefas.',
    'O treinador corrige erros de forma objetiva.',
    'O treinador ajuda o atleta a melhorar detalhes técnicos específicos.',
    'O treinador demonstra como realizar movimentos de forma eficaz.',
    'O treinador orienta sobre estratégias técnicas durante treinos e competições.'
  ]);
  addBlock('SEMI_PLAN', 'Planejamento', [
    'O treinador organiza bem as sessões de treino.',
    'Os treinos têm começo, meio e fim bem definidos.',
    'O treinador segue um plano estruturado ao longo do ciclo.',
    'As metas de treino são claras e comunicadas.',
    'O treinador ajusta o treino conforme a fase do calendário competitivo.',
    'O treinador demonstra preparo e conhecimento no planejamento físico‑técnico.',
    'O treinador dá feedback sobre o progresso do atleta em relação às metas do ciclo.'
  ]);
  addBlock('SEMI_MOTIV', 'Motivacional', [
    'O treinador incentiva o atleta a melhorar continuamente.',
    'O treinador mostra confiança na capacidade do atleta.',
    'O treinador reforça comportamentos positivos durante o treino.',
    'O treinador cria um ambiente motivador e encorajador.',
    'O treinador mantém a equipe unida e com propósito claro.',
    'O treinador comemora conquistas, mesmo que pequenas.',
    'O treinador ajuda o atleta a lidar com frustração em momentos críticos.'
  ]);
  addBlock('SEMI_REL', 'Relação (Suporte)', [
    'O treinador entende o atleta como pessoa.',
    'O treinador está disponível para ouvir o atleta.',
    'O treinador entende problemas pessoais do atleta.',
    'O treinador demonstra preocupação com a vida geral do atleta.',
    'O treinador é digno de confiança para assuntos sensíveis.',
    'O treinador mantém sigilo sobre a vida pessoal do atleta.',
    'O treinador respeita a opinião do atleta nas decisões.',
    'O treinador estabelece comunicação aberta e respeitosa.',
    'O treinador mostra empatia em momentos difíceis.'
  ]);
  addBlock('SEMI_AVERS', 'Práticas Aversivas', [
    'O treinador usa o medo como método de instrução.',
    'O treinador grita quando está com raiva.',
    'O treinador ignora a opinião do atleta.',
    'O treinador demonstra favoritismo entre atletas.',
    'O treinador intimida o atleta fisicamente.',
    'O treinador humilha ou ridiculariza o atleta.',
    'O treinador ameaça retirar oportunidades de participação.'
  ]);
  return form;
}

/**
 * Cria o formulário RESTQ-Sport para treinador com prefixos.
 * @returns {FormApp.Form} o formulário criado
 */
function createRESTQTrainerFormPrefixed() {
  var form = FormApp.create(FORMS_PREFIX + "RESTQ-Sport – Treinador");
  form.setDescription('Formulário separado para o bloco do treinador no RESTQ-Sport. Tempo estimado: 5–7 minutos.');
  // Identificação do treinador
  form.addTextItem().setTitle('TR_ID | ID do treinador (código interno)').setRequired(true);
  form.addTextItem().setTitle('TR_NAME | Nome completo do treinador').setRequired(true);
  form.addDateItem().setTitle('TR_DATE | Data da avaliação').setRequired(true);
  // Perguntas RESTQ do treinador (0–6)
  var restqCoachItems = [
    'Eu tive algumas boas ideias.',
    'Eu entendia como meus atletas se sentiam.',
    'Eu sentia meu corpo forte.',
    'Eu me preparei para todos os treinamentos.',
    'Meus esforços pessoais contribuíram para o sucesso de meus atletas.',
    'Eu me senti emocionalmente exausto pelo processo de treino (coaching).',
    'Eu estava convencido de que treinei bem os meus atletas.',
    'Eu não podia descansar durante os intervalos.',
    'Eu dei exercícios de concentração para os meus atletas.',
    'Eu motivei bem meus atletas.',
    'Eu estava em boa condição física.',
    'Meus atletas tiveram bons resultados.',
    'Eu estava convencido de que meus atletas poderiam alcançar seu melhor desempenho a qualquer momento.',
    'Eu realizei com mérito minhas tarefas como treinador.',
    'Eu tive a impressão de que os intervalos de descanso foram poucos.',
    'Eu tive vontade de deixar de ser treinador.',
    'Meus atletas e eu estabelecemos metas juntos.',
    'Eu tive novas ideias para o treinamento.',
    'Eu lidei com os problemas emocionais de meus atletas com muita calma.',
    'Eu me senti muito energético (cheio de energia).',
    'Eu tirei vantagens das oportunidades que foram oferecidas para mim.',
    'Eu estava convencido de que as metas de desempenho poderiam ser atingidas.',
    'Eu me senti exausto da carreira de treinador.',
    'Exigiram demais de mim durante os intervalos de descanso.',
    'Eu falei com meus atletas sobre as vantagens do treinamento mental.',
    'Eu estava motivado para dar o treino.',
    'Eu estava convencido de que preparei bem meus atletas.',
    'Eu me recuperei bem fisicamente.',
    'Eu tomei decisões certas no treinamento.',
    'Os intervalos de descanso não foram em momentos certos.',
    'Eu me senti frustrado ministrando o treinamento.',
    'Eu lidei efetivamente com os problemas de meus atletas.',
    'Eu falei com meus atletas sobre as técnicas de regulação do nível de ativação (por exemplo: relaxamento).'
  ];
  restqCoachItems.forEach(function(text, idx) {
    var code = 'TR_RESTQ_Q' + String(idx + 1).padStart(2, '0');
    form.addScaleItem()
      .setTitle(code + ' | ' + text)
      .setBounds(0, 6)
      .setLabels('Nunca', 'Sempre')
      .setRequired(true);
  });
  return form;
}

/**
 * Cria o formulário de cadastro do atleta com campos de telefone prefixados.
 * A maior parte dos campos continua sem prefixos, pois são textos longos
 * usados apenas para registro. Os campos de telefone ganham códigos
 * específicos (REG_ATHLETE_PHONE e REG_COACH_PHONE) para posterior extração.
 * @returns {FormApp.Form} o formulário criado
 */
function createRegistrationFormPrefixed() {
  var form = FormApp.create(FORMS_PREFIX + "Cadastro do Atleta");
  form.setDescription('Formulário completo de cadastro do atleta (dados pessoais, histórico esportivo, saúde, rotina, rede de apoio, objetivos e construcional).');
  // Identificação básica
  form.addTextItem().setTitle('REG_ID | ID interno do atleta (código MINDS)').setRequired(true);
  form.addTextItem().setTitle('REG_DOC | Documento (CPF)').setHelpText('Informe apenas números.').setRequired(false);
  form.addTextItem().setTitle('REG_NAME | Nome completo').setRequired(true);
  form.addTextItem().setTitle('REG_NICKNAME | Nome social / apelido esportivo').setRequired(false);
  form.addDateItem().setTitle('REG_DOB | Data de nascimento').setRequired(true);
  form.addTextItem().setTitle('REG_AGE | Idade').setRequired(false);
  // Sexo / gênero
  var gender = form.addMultipleChoiceItem();
  gender.setTitle('REG_GENDER | Sexo / gênero').setChoices([
    gender.createChoice('Masculino'),
    gender.createChoice('Feminino'),
    gender.createChoice('Outro'),
    gender.createChoice('Prefiro não informar')
  ]).setRequired(false);
  // Mão dominante
  var hand = form.addMultipleChoiceItem();
  hand.setTitle('REG_HAND | Mão dominante').setChoices([
    hand.createChoice('Direita'),
    hand.createChoice('Esquerda'),
    hand.createChoice('Ambidestro')
  ]).setRequired(false);
  // Dados de contato
  form.addPageBreakItem().setTitle('Dados de Contato e Responsáveis');
  form.addTextItem().setTitle('REG_ATHLETE_PHONE | Telefone do atleta (WhatsApp, com DDD)').setRequired(false);
  form.addTextItem().setTitle('REG_ATHLETE_EMAIL | E-mail do atleta').setRequired(false);
  form.addTextItem().setTitle('REG_ADDRESS | Endereço (cidade, bairro, UF)').setRequired(false);
  form.addTextItem().setTitle('REG_RESP_NAME | Nome do responsável (quando menor de idade)').setRequired(false);
  form.addTextItem().setTitle('REG_RESP_PHONE | Telefone do responsável').setRequired(false);
  form.addTextItem().setTitle('REG_COACH_PHONE | Telefone do treinador principal (WhatsApp, com DDD)').setRequired(false);
  form.addParagraphTextItem().setTitle('REG_CONTACT_PREF | Melhor forma/horário de contato').setRequired(false);
  // Demais seções permanecem iguais (sem prefixos, pois são textos longos)
  form.addPageBreakItem().setTitle('Dados Esportivos Atuais');
  form.addTextItem().setTitle('Modalidade esportiva principal').setRequired(true);
  form.addTextItem().setTitle('Categoria (sub-10, sub-12, sub-14, sub-17, adulto etc.)').setRequired(false);
  form.addTextItem().setTitle('Posição / função na equipe').setRequired(false);
  form.addTextItem().setTitle('Clube atual / equipe / centro de treinamento').setRequired(false);
  form.addTextItem().setTitle('Tempo de prática na modalidade atual (anos/meses)').setRequired(false);
  form.addParagraphTextItem().setTitle('Volume atual de treino (nº sessões/semana, duração média)').setRequired(false);
  form.addTextItem().setTitle('Peso ideal para a modalidade (kg)').setHelpText('Opcional. Use ponto para decimais.').setRequired(false);
  form.addParagraphTextItem().setTitle('Competições previstas nos próximos 3–6 meses').setRequired(false);
  form.addParagraphTextItem().setTitle('Outras modalidades praticadas').setRequired(false);
  form.addPageBreakItem().setTitle('Histórico Esportivo');
  form.addTextItem().setTitle('Idade em que começou a praticar esportes').setRequired(false);
  form.addParagraphTextItem().setTitle('Outras modalidades já praticadas').setRequired(false);
  form.addParagraphTextItem().setTitle('Clubes / equipes anteriores').setRequired(false);
  form.addParagraphTextItem().setTitle('Principais competições já disputadas').setRequired(false);
  form.addParagraphTextItem().setTitle('Maiores conquistas esportivas').setRequired(false);
  form.addParagraphTextItem().setTitle('Períodos de afastamento do esporte (motivo)').setRequired(false);
  form.addParagraphTextItem().setTitle('Treinadores marcantes na carreira (e por quê)').setRequired(false);
  form.addPageBreakItem().setTitle('Histórico de Lesões e Saúde Física');
  form.addParagraphTextItem().setTitle('Lesões prévias relevantes (tipo, data, tratamento)').setRequired(false);
  form.addParagraphTextItem().setTitle('Cirurgias importantes').setRequired(false);
  form.addParagraphTextItem().setTitle('Dores crônicas (onde, intensidade, frequência)').setRequired(false);
  form.addParagraphTextItem().setTitle('Doenças pré-existentes (asma, diabetes, etc.)').setRequired(false);
  form.addParagraphTextItem().setTitle('Uso atual de medicamentos (qual, dose, motivo)').setRequired(false);
  form.addParagraphTextItem().setTitle('Concussão/traumatismo craniano (quando, sintomas)').setRequired(false);
  form.addPageBreakItem().setTitle('Histórico de Saúde Mental e Suporte Psicológico');
  var terapia = form.addMultipleChoiceItem();
  terapia.setTitle('Já fez psicoterapia?').setChoices([
    terapia.createChoice('Sim'),
    terapia.createChoice('Não')
  ]).setRequired(false);
  form.addParagraphTextItem().setTitle('Se "Sim", há quanto tempo e quais abordagens?').setRequired(false);
  form.addParagraphTextItem().setTitle('Diagnósticos psicológicos/psiquiátricos conhecidos').setRequired(false);
  form.addParagraphTextItem().setTitle('Uso atual de medicação psiquiátrica (qual, dose)').setRequired(false);
  form.addParagraphTextItem().setTitle('Situações gatilho frequentes').setRequired(false);
  form.addParagraphTextItem().setTitle('Estratégias de enfrentamento que já utiliza').setRequired(false);
  form.addPageBreakItem().setTitle('Histórico Nutricional e Corporal');
  form.addParagraphTextItem().setTitle('Dietas anteriores relevantes').setRequired(false);
  form.addParagraphTextItem().setTitle('Restrições alimentares (intolerâncias, alergias, escolhas)').setRequired(false);
  form.addParagraphTextItem().setTitle('Suplementos em uso').setRequired(false);
  form.addParagraphTextItem().setTitle('Histórico de variação de peso').setRequired(false);
  form.addParagraphTextItem().setTitle('Autoimagem corporal').setRequired(false);
  form.addPageBreakItem().setTitle('Rotina e Contexto de Vida');
  form.addParagraphTextItem().setTitle('Rotina de estudos/trabalho (turno, carga horária)').setRequired(false);
  form.addTextItem().setTitle('Tempo médio de sono por noite (horas)').setRequired(false);
  form.addParagraphTextItem().setTitle('Horário típico de dormir e acordar').setRequired(false);
  form.addTextItem().setTitle('Tempo médio de deslocamento diário (minutos)').setRequired(false);
  form.addParagraphTextItem().setTitle('Responsabilidades familiares').setRequired(false);
  form.addParagraphTextItem().setTitle('Atividades de lazer preferidas').setRequired(false);
  form.addPageBreakItem().setTitle('Rede de Apoio');
  form.addParagraphTextItem().setTitle('Pessoas de confiança (casa, escola, clube)').setRequired(false);
  form.addParagraphTextItem().setTitle('Relação com pais/responsáveis').setRequired(false);
  form.addParagraphTextItem().setTitle('Relação com colegas de equipe').setRequired(false);
  form.addParagraphTextItem().setTitle('Principal fonte de apoio emocional').setRequired(false);
  form.addPageBreakItem().setTitle('Objetivos e Expectativas');
  form.addParagraphTextItem().setTitle('O que espera alcançar com o acompanhamento MINDS').setRequired(false);
  form.addParagraphTextItem().setTitle('Metas esportivas').setRequired(false);
  form.addParagraphTextItem().setTitle('Metas pessoais').setRequired(false);
  form.addScaleItem().setTitle('Nível de motivação atual').setBounds(0, 10).setLabels('Nada motivado', 'Extremamente motivado').setRequired(false);
  form.addScaleItem().setTitle('Nível de confiança em relação ao futuro no esporte').setBounds(0, 10).setLabels('Nada confiante', 'Extremamente confiante').setRequired(false);
  form.addPageBreakItem().setTitle('Consentimento e Privacidade');
  var consent = form.addMultipleChoiceItem();
  consent.setTitle('Você (ou seu responsável) concorda com o termo de consentimento livre e esclarecido?')
    .setChoices([consent.createChoice('Sim'), consent.createChoice('Não')])
    .setRequired(true);
  var research = form.addMultipleChoiceItem();
  research.setTitle('Autoriza o uso de seus dados em pesquisa (opcional)?')
    .setChoices([research.createChoice('Sim'), research.createChoice('Não')])
    .setRequired(false);
  form.addParagraphTextItem().setTitle('Preferências sobre compartilhamento de relatórios (quem pode receber o quê)').setRequired(false);
  // Deixa os blocos comportamentais e construcionais sem prefixos (texto livre)
  form.addPageBreakItem().setTitle('Bloco – Análise do Comportamento');
  form.addParagraphTextItem().setTitle('Descreva comportamentos‑problema (topografia, frequência, duração, intensidade)').setRequired(false);
  form.addParagraphTextItem().setTitle('Contexto típico e antecedentes (A)').setRequired(false);
  form.addParagraphTextItem().setTitle('Consequências (C) e possíveis consequências do comportamento').setRequired(false);
  form.addParagraphTextItem().setTitle('Função provável do comportamento').setRequired(false);
  form.addParagraphTextItem().setTitle('História de aprendizagem relevante').setRequired(false);
  form.addParagraphTextItem().setTitle('Recursos/repertórios já presentes (autorregulação, coping, etc.)').setRequired(false);
  form.addPageBreakItem().setTitle('Questionário Construcional – Bloco 1: O que você faz hoje');
  form.addParagraphTextItem().setTitle('O que você já faz que te ajuda nos treinos e competições?').setRequired(false);
  form.addParagraphTextItem().setTitle('O que você faz que às vezes atrapalha?').setRequired(false);
  form.addParagraphTextItem().setTitle('Em quais situações se sente mais confiante?').setRequired(false);
  form.addParagraphTextItem().setTitle('Em quais situações se sente inseguro(a) ou com dificuldade?').setRequired(false);
  form.addPageBreakItem().setTitle('Questionário Construcional – Bloco 2: O que acontece depois');
  form.addParagraphTextItem().setTitle('Quando você vai bem, o que costuma acontecer?').setRequired(false);
  form.addParagraphTextItem().setTitle('Quando você não vai tão bem, o que acontece?').setRequired(false);
  form.addParagraphTextItem().setTitle('O que mais te motiva a continuar treinando e competindo?').setRequired(false);
  form.addParagraphTextItem().setTitle('Existe algo difícil/negativo que às vezes pesa no esporte?').setRequired(false);
  form.addPageBreakItem().setTitle('Questionário Construcional – Bloco 3: O que gostaria de fazer');
  form.addParagraphTextItem().setTitle('O que você gostaria de mudar no treino/competição?').setRequired(false);
  form.addParagraphTextItem().setTitle('Algo que vê outros atletas fazendo e gostaria de aprender?').setRequired(false);
  form.addParagraphTextItem().setTitle('Quais habilidades gostaria de melhorar (técnica, foco, controle emocional…)?').setRequired(false);
  form.addParagraphTextItem().setTitle('O que poderia ajudar a lidar melhor com erros/frustrações/derrotas?').setRequired(false);
  form.addPageBreakItem().setTitle('Questionário Construcional – Bloco 4: Apoios e recursos');
  form.addParagraphTextItem().setTitle('O que no seu ambiente já ajuda você a ir melhor?').setRequired(false);
  form.addParagraphTextItem().setTitle('Que tipo de suporte você sente falta hoje?').setRequired(false);
  form.addParagraphTextItem().setTitle('Se pudesse montar o treino/competição dos sonhos, como seria?').setRequired(false);
  form.addParagraphTextItem().setTitle('Que pequenas mudanças já fariam diferença agora?').setRequired(false);
  return form;
}

/* =========================
   FUNÇÃO MESTRA: CRIAR E VINCULAR TODOS OS FORMULÁRIOS
========================= */

/**
 * Cria todos os formulários com prefixo, vincula cada um à planilha mãe
 * e renomeia as abas de respostas conforme TAB_NAMES. Reutiliza a
 * planilha mãe se já existir.
 */
function createAllFormsLinkedPrefixed() {
  var master = ensureMasterSpreadsheet_();
  // Criação dos formulários
  var daily = createDailyFormPrefixed();
  var weekly = createWeeklyFormPrefixed();
  var quarterly = createQuarterlyFormPrefixed();
  var semiannual = createSemiannualFormPrefixed();
  var restqTrainer = createRESTQTrainerFormPrefixed();
  var registration = createRegistrationFormPrefixed();
  // Vínculo e renomeação das abas
  linkFormToMasterAndRenameTab_(daily, master, TAB_NAMES.DAILY);
  linkFormToMasterAndRenameTab_(weekly, master, TAB_NAMES.WEEKLY);
  linkFormToMasterAndRenameTab_(quarterly, master, TAB_NAMES.QUARTERLY);
  linkFormToMasterAndRenameTab_(semiannual, master, TAB_NAMES.SEMIANNUAL);
  linkFormToMasterAndRenameTab_(restqTrainer, master, TAB_NAMES.RESTQ_TRAINER);
  linkFormToMasterAndRenameTab_(registration, master, TAB_NAMES.REGISTRATION);
  return {
    daily: daily.getId(),
    weekly: weekly.getId(),
    quarterly: quarterly.getId(),
    semiannual: semiannual.getId(),
    restq_trainer: restqTrainer.getId(),
    registration: registration.getId(),
    master_sheet_id: master.getId()
  };
}

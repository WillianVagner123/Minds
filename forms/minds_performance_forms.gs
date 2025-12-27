/**
 * MINDS Performance – Construção de Formulários (com PLANILHA MÃE automática)
 *
 * O que este script faz:
 * 1) Cria (ou reutiliza) uma PLANILHA MÃE de respostas
 * 2) Cria todos os formulários (diário, semanal, trimestral, semestral, RESTQ treinador, cadastro)
 * 3) Vincula automaticamente CADA formulário à MESMA planilha mãe
 * 4) Renomeia as abas de respostas na planilha mãe para nomes fixos (sem bagunça)
 *
 * Como usar:
 * 1) Cole este código em um projeto Apps Script (script.google.com)
 * 2) Ajuste as variáveis do topo
 * 3) Execute createAllFormsLinked()
 *
 * Observação importante:
 * - O Google Forms cria a aba de respostas automaticamente. Este script renomeia
 *   essa aba logo após o vínculo.
 */

/* =========================
   VARIÁVEIS NO TOPO
========================= */

// Se você já tem uma planilha mãe, cole o ID aqui.
// Se deixar vazio "", o script cria uma nova planilha e salva o ID no ScriptProperties.
var MASTER_SHEET_ID = ""; // ex: "1AbC...XYZ"

// Nome padrão da planilha mãe (usado só se for criar uma nova)
var MASTER_SHEET_NAME = "MINDS – Respostas (Mãe)";

// Prefixo opcional para os formulários (fica bonito pra organizar no Drive)
var FORMS_PREFIX = "MINDS Performance – ";

// Nomes “fixos” das abas (uma por formulário)
var TAB_NAMES = {
  DAILY: "RESP_DAILY",
  WEEKLY: "RESP_WEEKLY",
  QUARTERLY: "RESP_QUARTERLY",
  SEMIANNUAL: "RESP_SEMIANNUAL",
  RESTQ_TRAINER: "RESP_RESTQ_TRAINER",
  REGISTRATION: "RESP_REGISTRATION"
};


/* =========================
   CORE: Planilha mãe + vínculo + rename
========================= */

/**
 * Garante a existência da planilha mãe:
 * - Se MASTER_SHEET_ID estiver preenchido, usa ele.
 * - Se estiver vazio, tenta ScriptProperties.
 * - Se ainda não existir, cria uma nova planilha e salva o ID.
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

  // manter variável global atualizada (pra log e pra quem copiar depois)
  MASTER_SHEET_ID = sid;
  return ss;
}

/**
 * Vincula um Form à planilha mãe e renomeia a aba de respostas criada/atualizada.
 * Estratégia:
 * - Antes do setDestination, captura lista de abas existentes
 * - Faz setDestination
 * - Aguarda e identifica a(s) nova(s) aba(s) criada(s)
 * - Renomeia para tabName desejado
 */
function linkFormToMasterAndRenameTab_(form, masterSs, tabName) {
  if (!form) throw new Error("Form inválido.");
  if (!masterSs) throw new Error("Planilha mãe inválida.");
  if (!tabName) throw new Error("tabName vazio.");

  // 1) snapshot das abas antes
  var before = masterSs.getSheets().map(function(sh){ return sh.getSheetId(); });

  // 2) vínculo
  form.setDestination(FormApp.DestinationType.SPREADSHEET, masterSs.getId());

  // 3) esperar a aba aparecer (poll curto)
  var newSheet = waitForNewResponseSheet_(masterSs, before, 12, 700); // ~até 8s

  // 4) renomear com segurança
  renameSheetSafely_(masterSs, newSheet, tabName);

  return newSheet;
}

/**
 * Espera surgir uma nova aba na planilha (criada pelo vínculo do Form).
 */
function waitForNewResponseSheet_(ss, beforeIds, attempts, sleepMs) {
  attempts = attempts || 10;
  sleepMs = sleepMs || 600;

  for (var i = 0; i < attempts; i++) {
    var sheets = ss.getSheets();
    var afterIds = sheets.map(function(sh){ return sh.getSheetId(); });

    // acha IDs que não existiam antes
    var created = [];
    for (var a = 0; a < afterIds.length; a++) {
      if (beforeIds.indexOf(afterIds[a]) === -1) created.push(afterIds[a]);
    }

    if (created.length > 0) {
      // pega a primeira aba nova
      var createdId = created[0];
      for (var s = 0; s < sheets.length; s++) {
        if (sheets[s].getSheetId() === createdId) return sheets[s];
      }
    }

    Utilities.sleep(sleepMs);
    SpreadsheetApp.flush();
  }

  // fallback: se não achou pelo ID, tenta achar uma aba "Form Responses"
  var fallback = ss.getSheets().filter(function(sh){
    var n = sh.getName();
    return n && n.toLowerCase().indexOf("form responses") !== -1;
  });
  if (fallback.length) return fallback[fallback.length - 1];

  throw new Error("Não consegui detectar a aba de respostas criada pelo vínculo do Form.");
}

/**
 * Renomeia aba sem “bagunça”:
 * - Se já existe uma aba com tabName, ela é renomeada para backup com timestamp
 * - Depois renomeia a aba alvo para tabName
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
   SEUS FORMULÁRIOS (iguais ao seu)
   -> Só acrescentei prefixo no nome do Form pra organizar
========================= */

function createDailyForm() {
  var form = FormApp.create(FORMS_PREFIX + "Avaliação Diária");
  form.setDescription(
    'Formulário diário que reúne: (1) BRUMS – Escala de Humor, ' +
    '(2) Carga de treino (RPE × duração), (3) Check-in rápido de energia/vigor, ' +
    '(4) Nutrição (rápido) e (5) Peso e detalhes de treino. ' +
    'Tempo estimado: ~5 minutos.'
  );

  form.addTextItem().setTitle('ID do atleta (código interno ou CPF)').setRequired(true);
  form.addDateItem().setTitle('Data da avaliação').setRequired(true);

  form.addPageBreakItem().setTitle('BRUMS – Escala de Humor');
  var brumsItems = [
    'Tenso(a)', 'Nervoso(a)', 'Ansioso(a)', 'Estressado(a)',
    'Triste', 'Deprimido(a)', 'Miserável', 'Desanimado(a)',
    'Furioso(a)', 'Irritado(a)', 'Incomodado(a)', 'Mal-humorado(a)',
    'Energético(a)', 'Alerta', 'Desperto(a)', 'Vivo(a)',
    'Cansado(a)', 'Exausto(a)', 'Sem energia', 'Letárgico(a)',
    'Confuso(a)', 'Desorientado(a)', 'Em dúvida', 'Esquecido(a)'
  ];
  brumsItems.forEach(function(item) {
    form.addScaleItem()
      .setTitle('Nas últimas horas eu me senti... ' + item)
      .setBounds(0, 4)
      .setLabels('Nada', 'Extremamente')
      .setRequired(true);
  });

  form.addPageBreakItem().setTitle('Registro de Carga de Treino');
  form.addScaleItem()
    .setTitle('Percepção subjetiva de esforço (RPE) da sessão')
    .setBounds(0, 10)
    .setLabels('Muito fácil', 'Máximo')
    .setRequired(true);

  form.addTextItem()
    .setTitle('Duração da sessão (minutos)')
    .setHelpText('Somente números. Ex.: 60')
    .setRequired(true);

  form.addPageBreakItem().setTitle('Check-in de Energia / Vigor');
  var vigorItems = ['Energético(a)', 'Alerta', 'Desperto(a)', 'Vivo(a)'];
  vigorItems.forEach(function(item) {
    form.addScaleItem()
      .setTitle('No momento, eu me sinto... ' + item)
      .setBounds(0, 4)
      .setLabels('Nada', 'Extremamente')
      .setRequired(true);
  });

  form.addPageBreakItem().setTitle('Nutrição – Check-in Diário (rápido)');
  form.addScaleItem()
    .setTitle('Hoje, o quanto você conseguiu seguir o plano alimentar combinado?')
    .setBounds(1, 5)
    .setLabels('Muito pouco', 'Quase tudo / totalmente')
    .setRequired(true);

  var missedMeals = form.addMultipleChoiceItem();
  missedMeals
    .setTitle('Hoje você deixou de fazer alguma refeição importante (café, almoço, jantar ou lanche pré/pós)?')
    .setChoices([
      missedMeals.createChoice('Não'),
      missedMeals.createChoice('Sim, 1 refeição'),
      missedMeals.createChoice('Sim, 2 ou mais')
    ])
    .setRequired(true);

  var lowEnergyRisk = form.addMultipleChoiceItem();
  lowEnergyRisk
    .setTitle('Hoje você sentiu que comeu menos do que precisava para treinar/recuperar bem?')
    .setHelpText('É percepção do dia (não é diagnóstico).')
    .setChoices([lowEnergyRisk.createChoice('Não'), lowEnergyRisk.createChoice('Sim')])
    .setRequired(true);

  form.addScaleItem()
    .setTitle('Hoje, qual foi o nível de desconforto gastrointestinal (estômago/intestino)?')
    .setBounds(0, 10)
    .setLabels('Nenhum', 'Muito alto')
    .setRequired(true);

  form.addPageBreakItem().setTitle('Peso e Detalhes de Treino');
  form.addTextItem().setTitle('Peso corporal (kg)').setHelpText('Em kg. Use ponto para decimais.').setRequired(false);

  var prePostDaily = form.addMultipleChoiceItem();
  prePostDaily.setTitle('Você está preenchendo este questionário em qual momento?')
    .setChoices([
      prePostDaily.createChoice('Pré-treino'),
      prePostDaily.createChoice('Pós-treino'),
      prePostDaily.createChoice('Nenhum / Outro')
    ])
    .setRequired(true);

  form.addTextItem().setTitle('Modalidade do treino').setHelpText('Ex.: corrida, musculação, ciclismo…').setRequired(false);
  form.addTextItem().setTitle('Tempo de treino (minutos)').setHelpText('Pré: estimativa. Pós: duração real.').setRequired(false);

  return form;
}

function createWeeklyForm() {
  var form = FormApp.create(FORMS_PREFIX + "Avaliação Semanal");
  form.setDescription(
    'Formulário semanal para avaliar a percepção do atleta sobre a semana (dieta, sono, treinos e competições), ' +
    'acompanhar adesão ao plano nutricional e registrar eventos marcantes.'
  );

  form.addTextItem().setTitle('ID do atleta (código interno ou CPF)').setRequired(true);
  form.addDateItem().setTitle('Data de início da semana (segunda-feira)').setRequired(true);

  form.addPageBreakItem().setTitle('Autopercepção Semanal');
  form.addScaleItem()
    .setTitle('Nesta semana, como você avalia seu desempenho considerando dieta, sono, treinos e competições?')
    .setBounds(1, 5)
    .setLabels('Muito ruim', 'Excelente')
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('Se esteve cansado(a) esta semana, o que você fez para se recuperar ou lidar com o cansaço?')
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('Outros comentários sobre sua semana (sentimentos, percepções, etc.)')
    .setRequired(false);

  form.addPageBreakItem().setTitle('Adesão ao Plano Nutricional');
  form.addScaleItem()
    .setTitle('Nesta semana, avalie sua adesão ao plano nutricional')
    .setBounds(1, 5)
    .setLabels('Muito baixa', 'Excelente')
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('Comentários sobre sua alimentação nesta semana (opcional)')
    .setRequired(false);

  form.addPageBreakItem().setTitle('Eventos Marcantes de Treino/Competição');
  form.addParagraphTextItem()
    .setTitle('Descreva eventos marcantes ou incomuns nos treinos/competições da semana (opcional)')
    .setHelpText('Resultados importantes, lesões, mudanças de rotina etc.')
    .setRequired(false);

  return form;
}

function createQuarterlyForm() {
  var form = FormApp.create(FORMS_PREFIX + "Avaliação Trimestral");
  form.setDescription(
    'Formulário trimestral que reúne: GSES-12, ACSI-28BR, PMCSQ-2 e RESTQ-Sport (atleta). ' +
    'Tempo estimado: 20–25 minutos.'
  );

  form.addTextItem().setTitle('ID do atleta (código interno ou CPF)').setRequired(true);
  form.addDateItem().setTitle('Data da avaliação').setRequired(true);

  form.addPageBreakItem().setTitle('GSES-12 – Autoeficácia Geral');
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
  gsesItems.forEach(function(text) {
    form.addScaleItem()
      .setTitle(text)
      .setBounds(1, 5)
      .setLabels('Discordo totalmente', 'Concordo totalmente')
      .setRequired(true);
  });

  form.addPageBreakItem().setTitle('ACSI-28BR – Habilidades de Enfrentamento');
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
  acsiItems.forEach(function(text) {
    form.addScaleItem()
      .setTitle(text)
      .setBounds(0, 3)
      .setLabels('Quase nunca', 'Quase sempre')
      .setRequired(true);
  });

  form.addPageBreakItem().setTitle('PMCSQ-2 – Clima Motivacional no Esporte');
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
  pmcsqItems.forEach(function(text) {
    form.addScaleItem()
      .setTitle(text)
      .setBounds(1, 5)
      .setLabels('Discordo totalmente', 'Concordo totalmente')
      .setRequired(true);
  });

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
    'Eu cai no sono, satisfeito e relaxado.',
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
  restqAthleteItems.forEach(function(text) {
    form.addScaleItem()
      .setTitle(text)
      .setBounds(0, 6)
      .setLabels('Nunca', 'Sempre')
      .setRequired(true);
  });

  return form;
}

function createSemiannualForm() {
  var form = FormApp.create(FORMS_PREFIX + "Avaliação Semestral – CBAS/LSS");
  form.setDescription('Formulário semestral em que o atleta avalia seu treinador. Tempo estimado: 5–7 minutos.');

  form.addTextItem().setTitle('ID do atleta (código interno ou CPF)').setRequired(true);
  form.addTextItem().setTitle('Nome do treinador avaliado').setRequired(true);
  form.addTextItem().setTitle('Categoria / Equipe (ex.: Sub-17, Adulto)').setRequired(false);
  form.addTextItem().setTitle('Período avaliado (ex.: 1º semestre 2025)').setRequired(false);

  function addScaleBlock(sectionTitle, itemsArray) {
    form.addPageBreakItem().setTitle(sectionTitle);
    itemsArray.forEach(function(text) {
      form.addScaleItem()
        .setTitle(text)
        .setBounds(1, 5)
        .setLabels('Quase nunca', 'Quase sempre')
        .setRequired(true);
    });
  }

  addScaleBlock('Técnica', [
    'O treinador fornece instruções claras.',
    'O treinador demonstra domínio técnico da modalidade.',
    'O treinador explica o porquê dos exercícios e tarefas.',
    'O treinador corrige erros de forma objetiva.',
    'O treinador ajuda o atleta a melhorar detalhes técnicos específicos.',
    'O treinador demonstra como realizar movimentos de forma eficaz.',
    'O treinador orienta sobre estratégias técnicas durante treinos e competições.'
  ]);

  addScaleBlock('Planejamento', [
    'O treinador organiza bem as sessões de treino.',
    'Os treinos têm começo, meio e fim bem definidos.',
    'O treinador segue um plano estruturado ao longo do ciclo.',
    'As metas de treino são claras e comunicadas.',
    'O treinador ajusta o treino conforme a fase do calendário competitivo.',
    'O treinador demonstra preparo e conhecimento no planejamento físico-técnico.',
    'O treinador dá feedback sobre o progresso do atleta em relação às metas do ciclo.'
  ]);

  addScaleBlock('Motivacional', [
    'O treinador incentiva o atleta a melhorar continuamente.',
    'O treinador mostra confiança na capacidade do atleta.',
    'O treinador reforça comportamentos positivos durante o treino.',
    'O treinador cria um ambiente motivador e encorajador.',
    'O treinador mantém a equipe unida e com propósito claro.',
    'O treinador comemora conquistas, mesmo que pequenas.',
    'O treinador ajuda o atleta a lidar com frustração em momentos críticos.'
  ]);

  addScaleBlock('Relação (Suporte)', [
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

  addScaleBlock('Práticas Aversivas', [
    'O treinador usa o medo como método de instrução.',
    'O treinador grita quando está com raiva.',
    'O treinador ignora a opinião do atleta.',
    'O treinador demonstra favoritismo entre atletas.',
    'O treinador intimida o atleta fisicamente.',
    'O treinador usa o poder para manipular o atleta.',
    'O treinador faz comentários pessoais desagradáveis.',
    'O treinador coloca pressão excessiva e desnecessária.',
    'O treinador gasta muito tempo treinando somente os melhores atletas.',
    'O treinador ridiculariza erros ou falhas.'
  ]);

  return form;
}

function createRESTQTrainerForm() {
  var form = FormApp.create(FORMS_PREFIX + "RESTQ-Sport – Treinador");
  form.setDescription('Formulário separado para o bloco do treinador no RESTQ-Sport. Tempo estimado: 5–7 minutos.');

  form.addTextItem().setTitle('ID do treinador (código interno)').setRequired(true);
  form.addTextItem().setTitle('Nome completo do treinador').setRequired(true);
  form.addDateItem().setTitle('Data da avaliação').setRequired(true);

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

  restqCoachItems.forEach(function(text) {
    form.addScaleItem()
      .setTitle(text)
      .setBounds(0, 6)
      .setLabels('Nunca', 'Sempre')
      .setRequired(true);
  });

  return form;
}

function createAthleteRegistrationForm() {
  var form = FormApp.create(FORMS_PREFIX + "Cadastro do Atleta");
  form.setDescription('Formulário completo de cadastro do atleta (dados pessoais, histórico esportivo, saúde, rotina, rede de apoio, objetivos e construcional).');

  form.addTextItem().setTitle('ID interno do atleta (código MINDS)').setRequired(true);
  form.addTextItem().setTitle('Documento (CPF)').setHelpText('Informe apenas números.').setRequired(false);
  form.addTextItem().setTitle('Nome completo').setRequired(true);
  form.addTextItem().setTitle('Nome social / apelido esportivo').setRequired(false);
  form.addDateItem().setTitle('Data de nascimento').setRequired(true);
  form.addTextItem().setTitle('Idade').setRequired(false);

  var gender = form.addMultipleChoiceItem();
  gender.setTitle('Sexo / gênero').setChoices([
    gender.createChoice('Masculino'),
    gender.createChoice('Feminino'),
    gender.createChoice('Outro'),
    gender.createChoice('Prefiro não informar')
  ]).setRequired(false);

  var hand = form.addMultipleChoiceItem();
  hand.setTitle('Mão dominante').setChoices([
    hand.createChoice('Direita'),
    hand.createChoice('Esquerda'),
    hand.createChoice('Ambidestro')
  ]).setRequired(false);

  form.addPageBreakItem().setTitle('Dados de Contato e Responsáveis');
  form.addTextItem().setTitle('Telefone do atleta').setRequired(false);
  form.addTextItem().setTitle('E-mail do atleta').setRequired(false);
  form.addTextItem().setTitle('Endereço (cidade, bairro, UF)').setRequired(false);
  form.addTextItem().setTitle('Nome do responsável (quando menor de idade)').setRequired(false);
  form.addTextItem().setTitle('Telefone do responsável').setRequired(false);
  form.addParagraphTextItem().setTitle('Melhor forma/horário de contato').setRequired(false);

  form.addPageBreakItem().setTitle('Dados Esportivos Atuais');
  form.addTextItem().setTitle('Modalidade esportiva principal').setRequired(true);
  form.addTextItem().setTitle('Categoria (sub-10, sub-12, sub-14, sub-17, adulto etc.)').setRequired(false);
  form.addTextItem().setTitle('Posição / função na equipe').setRequired(false);
  form.addTextItem().setTitle('Clube atual / equipe / centro de treinamento').setRequired(false);
  form.addTextItem().setTitle('Tempo de prática na modalidade atual (anos/meses)').setRequired(false);
  form.addParagraphTextItem().setTitle('Volume atual de treino (nº sessões/semana, duração média)').setRequired(false);

  form.addTextItem()
    .setTitle('Peso ideal para a modalidade (kg)')
    .setHelpText('Opcional. Use ponto para decimais.')
    .setRequired(false);

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

  form.addParagraphTextItem()
    .setTitle('Preferências sobre compartilhamento de relatórios (quem pode receber o quê)')
    .setRequired(false);

  form.addPageBreakItem().setTitle('Bloco – Análise do Comportamento');
  form.addParagraphTextItem().setTitle('Descreva comportamentos-problema (topografia, frequência, duração, intensidade)').setRequired(false);
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
   FUNÇÃO MESTRA (ATUALIZADA)
========================= */

/**
 * Cria todos os formulários, vincula à planilha mãe e renomeia as abas.
 * Retorna um resumo no Logger com IDs/URLs.
 */
function createAllFormsLinked() {
  var masterSs = ensureMasterSpreadsheet_();

  Logger.log("✅ PLANILHA MÃE ID: " + masterSs.getId());
  Logger.log("✅ PLANILHA MÃE URL: " + masterSs.getUrl());

  // 1) criar forms
  var daily = createDailyForm();
  var weekly = createWeeklyForm();
  var quarterly = createQuarterlyForm();
  var semiannual = createSemiannualForm();
  var restqTrainer = createRESTQTrainerForm();
  var registration = createAthleteRegistrationForm();

  // 2) vincular + renomear abas
  linkFormToMasterAndRenameTab_(daily, masterSs, TAB_NAMES.DAILY);
  linkFormToMasterAndRenameTab_(weekly, masterSs, TAB_NAMES.WEEKLY);
  linkFormToMasterAndRenameTab_(quarterly, masterSs, TAB_NAMES.QUARTERLY);
  linkFormToMasterAndRenameTab_(semiannual, masterSs, TAB_NAMES.SEMIANNUAL);
  linkFormToMasterAndRenameTab_(restqTrainer, masterSs, TAB_NAMES.RESTQ_TRAINER);
  linkFormToMasterAndRenameTab_(registration, masterSs, TAB_NAMES.REGISTRATION);

  // 3) log final (edit + public)
  Logger.log("— — — LINKS DOS FORMULÁRIOS — — —");
  logForm_(daily, "DAILY");
  logForm_(weekly, "WEEKLY");
  logForm_(quarterly, "QUARTERLY");
  logForm_(semiannual, "SEMIANNUAL");
  logForm_(restqTrainer, "RESTQ_TRAINER");
  logForm_(registration, "REGISTRATION");

  Logger.log("✅ Tudo pronto: 1 planilha mãe + várias abas (renomeadas) + forms vinculados.");
}

function logForm_(form, label) {
  Logger.log(label + " | FormID: " + form.getId());
  Logger.log(label + " | Edit:  " + form.getEditUrl());
  Logger.log(label + " | Public:" + form.getPublishedUrl());
}


/* =========================
   UTIL: recuperar ID salvo no ScriptProperties
========================= */

/**
 * Se você deixou MASTER_SHEET_ID vazio e quer ver qual foi criado:
 */
function showMasterSheetId() {
  var sid = PropertiesService.getScriptProperties().getProperty("MASTER_SHEET_ID");
  Logger.log("MASTER_SHEET_ID (ScriptProperties): " + sid);
}

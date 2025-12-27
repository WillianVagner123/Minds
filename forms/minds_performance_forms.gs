/**
 * MINDS Performance – Construção de Formulários
 *
 * Este script cria uma coleção de formulários no Google Forms seguindo a nova
 * metodologia MINDS. Os formulários são organizados por periodicidade
 * (Diário, Semanal, Trimestral e Semestral) para que o atleta responda
 * diferentes blocos de perguntas em um único formulário, com seções
 * separadas e um tempo de preenchimento estimado. Um formulário
 * adicional é criado para o bloco treinador do RESTQ‑Sport.
 *
 * Para utilizar este script:
 * 1. Crie um novo projeto em https://script.google.com/ (Apps Script).
 * 2. Cole este código e execute as funções createAllForms() para
 *    gerar todos os formulários ou execute apenas as funções
 *    individuais conforme necessário.
 * 3. Conecte cada formulário a uma planilha de respostas para
 *    permitir análises posteriores.
 *
 * Observações importantes:
 * - Cada formulário solicita um identificador único do atleta (ID interno
 *   ou CPF). Este campo é fundamental para vincular as respostas às
 *   análises. Considere utilizar um código interno para maior
 *   confidencialidade.
 * - Apenas itens classificados como “questionário” foram incluídos. Itens
 *   como revisões de clima de equipe, metas ou avaliações físicas não
 *   possuem formulário neste script.
 */

/**
 * Cria o formulário diário. Este formulário reúne a escala BRUMS,
 * o registro da carga de treino (RPE × duração) e um check‑in rápido de
 * energia/vigor. O tempo estimado para preenchimento é de 3 a 4 minutos.
 */
function createDailyForm() {
  var form = FormApp.create('Avaliação Diária – MINDS Performance');
  form.setDescription(
    'Formulário diário que reúne quatro blocos: (1) BRUMS – Escala de Humor, ' +
    '(2) Carga de treino (RPE × duração), (3) Check‑in rápido de energia/vigor e ' +
    '(4) Peso e detalhes de treino (pré/pós, modalidade e duração). ' +
    'Tempo estimado de resposta: 4–5 minutos.'
  );

  // Identificação básica
  form.addTextItem()
      .setTitle('ID do atleta (código interno ou CPF)')
      .setRequired(true);
  form.addDateItem()
      .setTitle('Data da avaliação')
      .setRequired(true);

  // Bloco BRUMS – 24 itens (escala 0–4)
  form.addPageBreakItem().setTitle('BRUMS – Escala de Humor');
  var brumsItems = [
    'Tenso(a)', 'Nervoso(a)', 'Ansioso(a)', 'Estressado(a)',
    'Triste', 'Deprimido(a)', 'Miserável', 'Desanimado(a)',
    'Furioso(a)', 'Irritado(a)', 'Incomodado(a)', 'Mal‑humorado(a)',
    'Energético(a)', 'Alerta', 'Desperto(a)', 'Vivo(a)',
    'Cansado(a)', 'Exausto(a)', 'Sem energia', 'Letárgico(a)',
    'Confuso(a)', 'Desorientado(a)', 'Em dúvida', 'Esquecido(a)'
  ];
  brumsItems.forEach(function(item) {
    var scale = form.addScaleItem();
    scale.setTitle('Nas últimas horas eu me senti... ' + item)
         .setBounds(0, 4)
         .setLabels('Nada', 'Extremamente')
         .setRequired(true);
  });

  // Bloco Carga de Treino
  form.addPageBreakItem().setTitle('Registro de Carga de Treino');
  var rpe = form.addScaleItem();
  rpe.setTitle('Percepção subjetiva de esforço (RPE) da sessão')
     .setBounds(0, 10)
     .setLabels('Muito fácil', 'Máximo')
     .setRequired(true);
  form.addTextItem()
      .setTitle('Duração da sessão (minutos)')
      .setHelpText('Informe apenas números. Por exemplo: 60 para uma hora de treino.')
      .setRequired(true);

  // Bloco Check‑in de Energia/Vigor – 4 itens de vigor
  form.addPageBreakItem().setTitle('Check‑in de Energia / Vigor');
  var vigorItems = ['Energético(a)', 'Alerta', 'Desperto(a)', 'Vivo(a)'];
  vigorItems.forEach(function(item) {
    var scale = form.addScaleItem();
    scale.setTitle('No momento, eu me sinto... ' + item)
         .setBounds(0, 4)
         .setLabels('Nada', 'Extremamente')
         .setRequired(true);
  });

  // Bloco Peso e Detalhes de Treino – perguntas movidas do questionário semanal
  form.addPageBreakItem().setTitle('Peso e Detalhes de Treino');
  form.addTextItem()
      .setTitle('Peso corporal (kg)')
      .setHelpText('Informe seu peso em quilogramas. Utilize ponto para separar decimais, se necessário.')
      .setRequired(false);
  var prePostDaily = form.addMultipleChoiceItem();
  prePostDaily.setTitle('Você está preenchendo este questionário em qual momento?')
              .setChoices([
                prePostDaily.createChoice('Pré‑treino'),
                prePostDaily.createChoice('Pós‑treino'),
                prePostDaily.createChoice('Nenhum / Outro')
              ])
              .setRequired(true);
  form.addTextItem()
      .setTitle('Modalidade do treino')
      .setHelpText('Ex.: corrida, musculação, ciclismo, etc.')
      .setRequired(false);
  form.addTextItem()
      .setTitle('Tempo de treino (minutos)')
      .setHelpText('Se estiver preenchendo antes do treino, informe a estimativa de duração. Se for após o treino, informe a duração real.')
      .setRequired(false);

  Logger.log('Formulário diário criado: ' + form.getEditUrl());
  Logger.log('Link para respostas: ' + form.getPublishedUrl());
}

/**
 * Cria o formulário semanal. Este formulário inclui a verificação de
 * adesão ao plano nutricional e o registro de eventos marcantes de
 * treino/competição. Tempo estimado de resposta: 2–3 minutos.
 */
function createWeeklyForm() {
  var form = FormApp.create('Avaliação Semanal – MINDS Performance');
  // Nesta revisão, removemos o bloco de peso e detalhes de treino (agora presente no diário)
  // e adicionamos um bloco focado em autopercepção de desempenho da semana. O formulário
  // semanal deve capturar dados qualitativos e de aderência a dieta/sono, sem repetir
  // medidas objetivas que já aparecem no diário.
  form.setDescription(
    'Formulário semanal para avaliar a percepção do atleta sobre a semana de treinos e competições, ' +
    'incluir fatores de desempenho (dieta, sono, treinos e competições) e coletar informações qualitativas. ' +
    'Também acompanha a adesão ao plano nutricional e registra eventos marcantes da semana.'
  );

  // Identificação básica
  form.addTextItem()
      .setTitle('ID do atleta (código interno ou CPF)')
      .setRequired(true);
  form.addDateItem()
      .setTitle('Data de início da semana (segunda‑feira)')
      .setRequired(true);

  // Bloco de autopercepção de desempenho (dieta, sono, treinos e competições)
  form.addPageBreakItem().setTitle('Autopercepção Semanal');
  var performance = form.addScaleItem();
  performance.setTitle('Nesta semana, como você avalia seu desempenho considerando dieta, sono, treinos e competições?')
             .setBounds(1, 5)
             .setLabels('Muito ruim', 'Excelente')
             .setRequired(true);
  // Pergunta qualitativa sobre cansaço e estratégia de enfrentamento
  form.addParagraphTextItem()
      .setTitle('Se esteve cansado(a) esta semana, o que você fez para se recuperar ou lidar com o cansaço?')
      .setRequired(false);
  // Pergunta livre para outros comentários qualitativos
  form.addParagraphTextItem()
      .setTitle('Outros comentários sobre sua semana de treinos e competições (sentimentos, percepções, etc.)')
      .setRequired(false);

  // Bloco adesão nutricional
  form.addPageBreakItem().setTitle('Adesão ao Plano Nutricional');
  var adherence = form.addScaleItem();
  adherence.setTitle('Nesta semana, avalie sua adesão ao plano nutricional')
           .setBounds(1, 5)
           .setLabels('Muito baixa', 'Excelente')
           .setRequired(true);
  form.addParagraphTextItem()
      .setTitle('Comentários sobre sua alimentação nesta semana (opcional)')
      .setRequired(false);

  // Bloco eventos marcantes
  form.addPageBreakItem().setTitle('Eventos Marcantes de Treino/Competição');
  form.addParagraphTextItem()
      .setTitle('Descreva brevemente eventos marcantes ou incomuns ocorridos nos treinos ou competições da semana')
      .setHelpText('Considere resultados importantes, lesões, mudanças de rotina ou qualquer fato que possa influenciar seu rendimento.')
      .setRequired(false);

  Logger.log('Formulário semanal criado: ' + form.getEditUrl());
  Logger.log('Link para respostas: ' + form.getPublishedUrl());
}

/**
 * Cria o formulário trimestral. Este formulário agrupa quatro questionários: GSES‑12,
 * ACSI‑28BR, PMCSQ‑2 e RESTQ‑Sport (bloco atleta). Tempo estimado de
 * resposta: 20–25 minutos, pois o número total de itens é grande. Cada
 * questionário é separado por um divisor (page break) para organizar o
 * preenchimento.
 */
function createQuarterlyForm() {
  var form = FormApp.create('Avaliação Trimestral – MINDS Performance');
  form.setDescription(
    'Formulário trimestral que reúne os questionários GSES‑12 (autoeficácia geral), ' +
    'ACSI‑28BR (habilidades de enfrentamento), PMCSQ‑2 (clima motivacional) e ' +
    'RESTQ‑Sport (estresse e recuperação – bloco atleta). Tempo estimado de resposta: 20–25 minutos.'
  );

  // Identificação
  form.addTextItem().setTitle('ID do atleta (código interno ou CPF)').setRequired(true);
  form.addDateItem().setTitle('Data da avaliação').setRequired(true);

  // --- Seção GSES‑12 ---
  form.addPageBreakItem().setTitle('GSES‑12 – Autoeficácia Geral');
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
    var scale = form.addScaleItem();
    scale.setTitle(text)
         .setBounds(1, 5)
         .setLabels('Discordo totalmente', 'Concordo totalmente')
         .setRequired(true);
  });

  // --- Seção ACSI‑28BR ---
  form.addPageBreakItem().setTitle('ACSI‑28BR – Habilidades de Enfrentamento');
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
    var scale = form.addScaleItem();
    scale.setTitle(text)
         .setBounds(0, 3)
         .setLabels('Quase nunca', 'Quase sempre')
         .setRequired(true);
  });

  // --- Seção PMCSQ‑2 ---
  form.addPageBreakItem().setTitle('PMCSQ‑2 – Clima Motivacional no Esporte');
  form.addSectionHeaderItem().setTitle('Instruções: Responda usando 1 (Discordo totalmente) a 5 (Concordo totalmente).');
  var pmcsqItems = [
    // Clima de Tarefa
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
    // Clima de Ego
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
    var scale = form.addScaleItem();
    scale.setTitle(text)
         .setBounds(1, 5)
         .setLabels('Discordo totalmente', 'Concordo totalmente')
         .setRequired(true);
  });

  // --- Seção RESTQ‑Sport – Bloco Atleta (1–48) ---
  form.addPageBreakItem().setTitle('RESTQ‑Sport – Estresse e Recuperação (Atleta)');
  var restqAthleteItems = [
    // 1–24
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
    // 25–48
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
    var scale = form.addScaleItem();
    scale.setTitle(text)
         .setBounds(0, 6)
         .setLabels('Nunca', 'Sempre')
         .setRequired(true);
  });

  Logger.log('Formulário trimestral criado: ' + form.getEditUrl());
  Logger.log('Link para respostas: ' + form.getPublishedUrl());
}

/**
 * Cria o formulário semestral. Esse formulário contém a escala CBAS/LSS
 * para avaliação do treinador pelo atleta. Itens que não se tratam de
 * questionário (revisão de metas, de plano alimentar, etc.) não foram
 * incluídos. Tempo estimado de resposta: 5–7 minutos.
 */
function createSemiannualForm() {
  var form = FormApp.create('Avaliação Semestral – CBAS/LSS');
  form.setDescription(
    'Formulário semestral em que o atleta avalia seu treinador em diferentes dimensões ' +
    '(Técnica, Planejamento, Motivacional, Relação/ Suporte e Práticas Aversivas). ' +
    'Tempo estimado de resposta: 5–7 minutos.'
  );

  // Identificação do atleta e treinador
  form.addTextItem()
      .setTitle('ID do atleta (código interno ou CPF)')
      .setRequired(true);
  form.addTextItem()
      .setTitle('Nome do treinador avaliado')
      .setRequired(true);
  form.addTextItem()
      .setTitle('Categoria / Equipe (ex.: Sub‑17, Adulto)')
      .setRequired(false);
  form.addTextItem()
      .setTitle('Período avaliado (ex.: 1º semestre 2025)')
      .setRequired(false);

  // Função auxiliar para criar blocos de escala 1–5
  function addScaleBlock(sectionTitle, itemsArray) {
    form.addPageBreakItem().setTitle(sectionTitle);
    itemsArray.forEach(function(text) {
      var scale = form.addScaleItem();
      scale.setTitle(text)
           .setBounds(1, 5)
           .setLabels('Quase nunca', 'Quase sempre')
           .setRequired(true);
    });
  }

  // Dimensões conforme o CBAS/LSS
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
    'O treinador demonstra preparo e conhecimento no planejamento físico‑técnico.',
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

  Logger.log('Formulário semestral criado: ' + form.getEditUrl());
  Logger.log('Link para respostas: ' + form.getPublishedUrl());
}

/**
 * Cria um formulário separado para o RESTQ‑Sport destinado ao treinador. Esse
 * formulário contém apenas as questões 49–81 do questionário RESTQ e deve
 * ser respondido pelo próprio treinador para autoavaliação ou pelo
 * avaliador responsável pela equipe técnica. Tempo estimado de
 * resposta: 5–7 minutos.
 */
function createRESTQTrainerForm() {
  var form = FormApp.create('RESTQ‑Sport – Estresse e Recuperação (Treinador)');
  form.setDescription(
    'Formulário separado para o bloco de itens do treinador no RESTQ‑Sport. ' +
    'Destina‑se à autoavaliação do treinador ou avaliação por parte do staff. ' +
    'Tempo estimado de resposta: 5–7 minutos.'
  );
  // Identificação do treinador
  form.addTextItem()
      .setTitle('ID do treinador (código interno)')
      .setRequired(true);
  form.addTextItem()
      .setTitle('Nome completo do treinador')
      .setRequired(true);
  form.addDateItem()
      .setTitle('Data da avaliação')
      .setRequired(true);

  // Itens 49–81 do RESTQ‑Sport
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
    var scale = form.addScaleItem();
    scale.setTitle(text)
         .setBounds(0, 6)
         .setLabels('Nunca', 'Sempre')
         .setRequired(true);
  });

  Logger.log('Formulário RESTQ Treinador criado: ' + form.getEditUrl());
  Logger.log('Link para respostas: ' + form.getPublishedUrl());
}

/**
 * Cria o formulário de cadastro do atleta. Este formulário é extenso e
 * cobre identificação pessoal, dados de contato, histórico esportivo,
 * saúde física e mental, rotina de vida, rede de apoio, objetivos,
 * consentimento e um questionário construcional (quatro blocos).
 * Os itens são agrupados em seções (page breaks) para facilitar o
 * preenchimento.
 */
function createAthleteRegistrationForm() {
  var form = FormApp.create('Cadastro do Atleta – MINDS Performance');
  form.setDescription(
    'Formulário completo de cadastro do atleta utilizado pelo MINDS Performance para recolher informações pessoais, ' +
    'histórico esportivo, saúde física e mental, rotina de vida, rede de apoio, objetivos e expectativas, além de um questionário construcional. ' +
    'Os dados coletados serão utilizados para personalizar o acompanhamento e permanecem confidenciais.'
  );

  // Identificação básica
  form.addTextItem().setTitle('ID interno do atleta (código MINDS)').setRequired(true);
  form.addTextItem().setTitle('Documento (CPF)').setHelpText('Informe apenas números. O CPF será criptografado no banco.').setRequired(false);
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

  // Dados de contato e responsáveis
  form.addPageBreakItem().setTitle('Dados de Contato e Responsáveis');
  form.addTextItem().setTitle('Telefone do atleta').setRequired(false);
  form.addTextItem().setTitle('E-mail do atleta').setRequired(false);
  form.addTextItem().setTitle('Endereço (cidade, bairro, UF)').setRequired(false);
  form.addTextItem().setTitle('Nome do responsável (quando menor de idade)').setRequired(false);
  form.addTextItem().setTitle('Telefone do responsável').setRequired(false);
  form.addParagraphTextItem().setTitle('Melhor forma/horário de contato (WhatsApp, telefone, e-mail)').setRequired(false);

  // Dados esportivos atuais
  form.addPageBreakItem().setTitle('Dados Esportivos Atuais');
  form.addTextItem().setTitle('Modalidade esportiva principal').setRequired(true);
  form.addTextItem().setTitle('Categoria (sub-10, sub-12, sub-14, sub-17, adulto etc.)').setRequired(false);
  form.addTextItem().setTitle('Posição / função na equipe').setRequired(false);
  form.addTextItem().setTitle('Clube atual / equipe / centro de treinamento').setRequired(false);
  form.addTextItem().setTitle('Tempo de prática na modalidade atual (anos/meses)').setRequired(false);
  form.addParagraphTextItem().setTitle('Volume atual de treino (nº de sessões por semana, duração média)').setRequired(false);
  // Novo campo: peso ideal do atleta para sua modalidade. Este valor será usado para
  // monitorar variações de peso superiores a 5% como potencial red flag. O
  // campo é opcional, mas recomendado para atletas em categorias de peso.
  form.addTextItem()
      .setTitle('Peso ideal para a modalidade (kg)')
      .setHelpText('Informe o peso que você considera ideal para competir em sua modalidade. Utilize ponto para separar decimais.')
      .setRequired(false);
  form.addParagraphTextItem().setTitle('Competições previstas nos próximos 3–6 meses').setRequired(false);
  form.addParagraphTextItem().setTitle('Outras modalidades que esteja praticando além da principal (quais, por quanto tempo, carga semanal)').setRequired(false);

  // Histórico esportivo
  form.addPageBreakItem().setTitle('Histórico Esportivo');
  form.addTextItem().setTitle('Idade em que começou a praticar esportes').setRequired(false);
  form.addParagraphTextItem().setTitle('Outras modalidades já praticadas (quais, por quanto tempo)').setRequired(false);
  form.addParagraphTextItem().setTitle('Clubes / equipes anteriores').setRequired(false);
  form.addParagraphTextItem().setTitle('Principais competições já disputadas (regionais, nacionais, internacionais)').setRequired(false);
  form.addParagraphTextItem().setTitle('Maiores conquistas esportivas (títulos, medalhas, recordes pessoais)').setRequired(false);
  form.addParagraphTextItem().setTitle('Períodos de afastamento do esporte (motivo: lesão, estudos, trabalho, desmotivação etc.)').setRequired(false);
  form.addParagraphTextItem().setTitle('Treinadores marcantes na carreira (e por quê)').setRequired(false);

  // Histórico de lesões e saúde física
  form.addPageBreakItem().setTitle('Histórico de Lesões e Saúde Física');
  form.addParagraphTextItem().setTitle('Lesões prévias relevantes (tipo, lado, data aproximada, tratamento realizado)').setRequired(false);
  form.addParagraphTextItem().setTitle('Cirurgias ortopédicas ou outras cirurgias importantes').setRequired(false);
  form.addParagraphTextItem().setTitle('Presença de dores crônicas (onde, intensidade, frequência)').setRequired(false);
  form.addParagraphTextItem().setTitle('Doenças pré-existentes (asma, cardiopatias, diabetes, alergias etc.)').setRequired(false);
  form.addParagraphTextItem().setTitle('Uso atual de medicamentos (qual, dose, motivo)').setRequired(false);
  form.addParagraphTextItem().setTitle('Episódios prévios de concussão / traumatismo craniano (quando, sintomas)').setRequired(false);

  // Histórico de saúde mental e suporte psicológico
  form.addPageBreakItem().setTitle('Histórico de Saúde Mental e Suporte Psicológico');
  var terapia = form.addMultipleChoiceItem();
  terapia.setTitle('Já fez psicoterapia?')
        .setChoices([
          terapia.createChoice('Sim'),
          terapia.createChoice('Não')
        ])
        .setRequired(false);
  form.addParagraphTextItem().setTitle('Se respondeu "Sim", há quanto tempo e quais abordagens anteriores?').setRequired(false);
  form.addParagraphTextItem().setTitle('Diagnósticos psicológicos ou psiquiátricos conhecidos').setRequired(false);
  form.addParagraphTextItem().setTitle('Uso atual de medicação psiquiátrica (qual, dose)').setRequired(false);
  form.addParagraphTextItem().setTitle('Situações gatilho frequentes (provas, jogos decisivos, conflitos familiares, escola etc.)').setRequired(false);
  form.addParagraphTextItem().setTitle('Estratégias de enfrentamento que já utiliza (respiração, música, falar com alguém, isolamento etc.)').setRequired(false);

  // Histórico nutricional e corporal
  form.addPageBreakItem().setTitle('Histórico Nutricional e Corporal');
  form.addParagraphTextItem().setTitle('Dietas anteriores relevantes (restrições extremas, low-carb, jejum prolongado etc.)').setRequired(false);
  form.addParagraphTextItem().setTitle('Restrições alimentares (intolerâncias, alergias, escolhas éticas)').setRequired(false);
  form.addParagraphTextItem().setTitle('Suplementos em uso (whey, creatina, cafeína, multivitamínico etc.)').setRequired(false);
  form.addParagraphTextItem().setTitle('Histórico de variação de peso (ganhos/perdas rápidas, períodos de “corte” ou “bulking”)').setRequired(false);
  form.addParagraphTextItem().setTitle('Autoimagem corporal (como se vê; se sente bem com o próprio corpo?)').setRequired(false);

  // Rotina e contexto de vida
  form.addPageBreakItem().setTitle('Rotina e Contexto de Vida');
  form.addParagraphTextItem().setTitle('Rotina de estudos/trabalho (turno, carga horária)').setRequired(false);
  form.addTextItem().setTitle('Tempo médio de sono por noite (horas)').setRequired(false);
  form.addParagraphTextItem().setTitle('Horário típico de dormir e acordar').setRequired(false);
  form.addTextItem().setTitle('Tempo médio de deslocamento diário (minutos)').setRequired(false);
  form.addParagraphTextItem().setTitle('Responsabilidades familiares (ajuda em casa, cuidado de irmãos etc.)').setRequired(false);
  form.addParagraphTextItem().setTitle('Atividades de lazer preferidas (jogos, redes sociais, amigos, outras)').setRequired(false);

  // Rede de apoio
  form.addPageBreakItem().setTitle('Rede de Apoio');
  form.addParagraphTextItem().setTitle('Pessoas de confiança (em casa, na escola, no clube)').setRequired(false);
  form.addParagraphTextItem().setTitle('Como é a relação com os pais/responsáveis (boa, conflituosa, distante etc.)').setRequired(false);
  form.addParagraphTextItem().setTitle('Como é a relação com colegas de equipe').setRequired(false);
  form.addParagraphTextItem().setTitle('Principal fonte de apoio emocional (quem procura quando algo vai mal?)').setRequired(false);

  // Objetivos e expectativas
  form.addPageBreakItem().setTitle('Objetivos e Expectativas');
  form.addParagraphTextItem().setTitle('O que espera alcançar com o acompanhamento MINDS (curto, médio e longo prazo)').setRequired(false);
  form.addParagraphTextItem().setTitle('Metas esportivas (ex.: jogar X campeonato, subir de categoria, ser titular)').setRequired(false);
  form.addParagraphTextItem().setTitle('Metas pessoais (confiança, lidar com erro, foco, organização de rotina)').setRequired(false);
  var motivScale = form.addScaleItem();
  motivScale.setTitle('Nível de motivação atual')
           .setBounds(0, 10)
           .setLabels('Nada motivado', 'Extremamente motivado')
           .setRequired(false);
  var confScale = form.addScaleItem();
  confScale.setTitle('Nível de confiança em relação ao futuro no esporte')
           .setBounds(0, 10)
           .setLabels('Nada confiante', 'Extremamente confiante')
           .setRequired(false);

  // Consentimento e privacidade
  form.addPageBreakItem().setTitle('Consentimento e Privacidade');
  var consent = form.addMultipleChoiceItem();
  consent.setTitle('Você (ou seu responsável) concorda com o termo de consentimento livre e esclarecido?')
         .setChoices([
           consent.createChoice('Sim'),
           consent.createChoice('Não')
         ])
         .setRequired(true);
  var research = form.addMultipleChoiceItem();
  research.setTitle('Autoriza o uso de seus dados em pesquisa (opcional)?')
         .setChoices([
           research.createChoice('Sim'),
           research.createChoice('Não')
         ])
         .setRequired(false);
  form.addParagraphTextItem().setTitle('Preferências sobre compartilhamento de relatórios (quem pode receber o quê)').setRequired(false);

  // Bloco – Análise do Comportamento (Identificação de repertórios)
  form.addPageBreakItem().setTitle('Bloco – Análise do Comportamento');
  form.addParagraphTextItem().setTitle('Descreva os comportamentos-problema observados (topografia, frequência, duração, intensidade)').setRequired(false);
  form.addParagraphTextItem().setTitle('Contexto típico de ocorrência e eventos antecedentes (A)').setRequired(false);
  form.addParagraphTextItem().setTitle('Eventos consequentes (C) e possíveis consequências do comportamento').setRequired(false);
  form.addParagraphTextItem().setTitle('Função provável do comportamento (atenção, fuga, acesso, automanutenção)').setRequired(false);
  form.addParagraphTextItem().setTitle('História de aprendizagem relevante (práticas parentais, experiências escolares, influências de equipe)').setRequired(false);
  form.addParagraphTextItem().setTitle('Recursos, repertórios e comportamentos alternativos já presentes (repertórios sociais, estratégias de autorregulação, coping, resolução de problemas)').setRequired(false);

  // Questionário Construcional – Bloco 1
  form.addPageBreakItem().setTitle('Questionário Construcional – Bloco 1: O que você faz hoje');
  form.addParagraphTextItem().setTitle('O que você já faz que te ajuda nos treinos e nas competições?').setRequired(false);
  form.addParagraphTextItem().setTitle('O que você faz que às vezes atrapalha?').setRequired(false);
  form.addParagraphTextItem().setTitle('Quando você treina ou compete, em quais situações se sente mais confiante?').setRequired(false);
  form.addParagraphTextItem().setTitle('Em quais situações se sente inseguro ou com dificuldade?').setRequired(false);

  // Questionário Construcional – Bloco 2
  form.addPageBreakItem().setTitle('Questionário Construcional – Bloco 2: O que acontece depois');
  form.addParagraphTextItem().setTitle('Quando você vai bem, o que costuma acontecer?').setRequired(false);
  form.addParagraphTextItem().setTitle('Quando você não vai tão bem, o que acontece?').setRequired(false);
  form.addParagraphTextItem().setTitle('O que mais te motiva a continuar treinando e competindo?').setRequired(false);
  form.addParagraphTextItem().setTitle('Existe algo negativo ou difícil que às vezes pesa para você no esporte?').setRequired(false);

  // Questionário Construcional – Bloco 3
  form.addPageBreakItem().setTitle('Questionário Construcional – Bloco 3: O que gostaria de fazer');
  form.addParagraphTextItem().setTitle('O que você gostaria de mudar no seu treino ou competição?').setRequired(false);
  form.addParagraphTextItem().setTitle('Tem algo que você vê outros atletas fazendo e gostaria de aprender também?').setRequired(false);
  form.addParagraphTextItem().setTitle('Quais habilidades você gostaria de melhorar (força, técnica, foco, controle emocional…)').setRequired(false);
  form.addParagraphTextItem().setTitle('O que poderia te ajudar a lidar melhor com erros, frustrações ou derrotas?').setRequired(false);

  // Questionário Construcional – Bloco 4
  form.addPageBreakItem().setTitle('Questionário Construcional – Bloco 4: Apoios e recursos');
  form.addParagraphTextItem().setTitle('O que já existe no seu ambiente (equipe, técnico, família) que ajuda você a ir melhor?').setRequired(false);
  form.addParagraphTextItem().setTitle('Que tipo de ajuda ou suporte você sente falta hoje?').setRequired(false);
  form.addParagraphTextItem().setTitle('Se pudesse montar o treino ou competição dos sonhos, como seria?').setRequired(false);
  form.addParagraphTextItem().setTitle('Que pequenas mudanças já fariam diferença para você agora?').setRequired(false);

  Logger.log('Formulário de cadastro do atleta criado: ' + form.getEditUrl());
  Logger.log('Link para respostas: ' + form.getPublishedUrl());
}

/**
 * Função mestre que cria todos os formulários descritos acima. Execute
 * esta função para gerar todos os formulários de uma só vez.
 */
function createAllForms() {
  createDailyForm();
  createWeeklyForm();
  createQuarterlyForm();
  createSemiannualForm();
  createRESTQTrainerForm();
  createAthleteRegistrationForm();
}
# Regras de pontuação e dicionário de flags

A pasta **scoring** reúne todos os arquivos JSON que definem a lógica de pontuação do PINGO.  Essas regras são carregadas pelo n8n em tempo de execução para gerar **flags** (sinais de risco) e classificar cada atleta diariamente, sem codificar a lógica dentro do fluxo.  Como o PINGO é um motor **explicável** que não diagnostica nem prescreve, as regras aqui documentadas seguem princípios de transparência e podem ser auditadas e versionadas.

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| **scoring_engine.json** | Orquestração geral do motor de pontuação.  Define os princípios (sem diagnóstico/prescrição, foco intra‑individual), lista os inputs necessários (BRUMS, padrões de série temporal, contexto, construcional e dieta) e aponta para os arquivos de regras que derivam estados (por exemplo, `brums_state` via `brums_rules.json`).  Também especifica como os flags são agregados: 0 flags → nível 0 (verde), 1 flag → nível 1 (atenção), 2 flags → nível 2 (amarelo) e ≥3 flags → nível 3 (vermelho)【111214856191087†L10-L26】【111214856191087†L36-L59】. |
| **brums_rules.json** | Determina como classificar o questionário **BRUMS** (vigor e DTH) em estados alto/normal/baixo com base em z‑scores intra‑individuais.  Gera as flags **A1**–**A8** quando há combinações críticas, por exemplo: vigor baixo + DTH alto (fadiga/extremo)【876828957937634†L0-L20】. |
| **construcional_rules.json** | Mapeia as respostas qualitativas do construcional (repertório protetor, repertório risco, apoio ambiental, claridade de metas) para estados baixo/médio/alto.  Essas classificações influenciam flags da série C (contexto amplificador). |
| **diet_adherence_rules.json** | Classifica a adesão nutricional e o risco de disponibilidade energética com base nas respostas do diário de dieta.  Gera flags **D1**–**D3** relacionadas a baixa adesão, número de refeições perdidas e desconforto gastrointestinal. |
| **questionnaire_correlation_rules.json** | Define regras de correlação entre diferentes questionários (por exemplo, BRUMS, ACSI, PMCSQ) para identificar padrões compostos (série X).  São usadas para detectar cruzamentos como “BRUMS desfavorável + ACSI baixo” ou “BRUMS crítico + ego alto”【876828957937634†L0-L20】. |
| **red_flags.json** | Dicionário de todos os códigos de flags.  Explica cada abreviação: as séries **A** correspondem a estados agudos de humor (BRUMS), a série **B** a padrões temporais desfavoráveis, a série **C** ao contexto amplificador e a série **D** à dieta.  Também inclui as flags **X1**–**X7** que resultam de cruzamentos (X = cruzamento). |
| **attention_levels.json** | Tabela simples que mapeia o número de flags para um nível de atenção (0–3).  Embora a mesma lógica esteja definida em `scoring_engine.json`, este arquivo mantém o mapeamento separado para facilitar ajustes. |
| **pingo_scoring_output.schema.json** | Esquema JSON para validação da saída do motor.  Especifica campos obrigatórios (`athlete_id`, `reference_date`, `attention_level`, `flag_count`, `flags`) e os tipos de cada campo. |

## Como as regras se combinam

1. **Classificação de insumos**: cada conjunto de dados (BRUMS, construcional, dieta, etc.) é classificado individualmente conforme seus respectivos arquivos de regras.  Por exemplo, `brums_rules.json` usa z‑scores para identificar vigor baixo com DTH alto, enquanto `diet_adherence_rules.json` identifica energia disponível insuficiente.
2. **Geração de flags**: quando uma condição é satisfeita, o motor emite uma flag com código e descrição definidos em `red_flags.json`.  A flag inclui a série (A, B, C, D, X) e o número de referência (por exemplo, `A5` para fadiga severa).  Os arquivos `questionnaire_correlation_rules.json` introduzem flags de cruzamento (X) quando padrões compostos são observados.
3. **Agregação em nível de atenção**: o `scoring_engine.json` define a regra de agregação: conta‑se o número de flags emitidas para o atleta naquele dia.  Zero flags significa estado funcional normal (verde); uma flag requer atenção; duas flags indicam necessidade de ajuste; três ou mais flags desencadeiam escalonamento obrigatório e atenção vermelha【111214856191087†L36-L59】.
4. **Persistência e explicabilidade**: o motor grava os resultados em `pingo_scoring_output` (tabela no Supabase) juntamente com metadados que indicam quais regras dispararam e quais limiares foram usados.  Isso permite auditoria e melhoria das regras ao longo do tempo.

Todos os arquivos nesta pasta devem ser versionados cuidadosamente.  A alteração de um limiar ou a adição de uma nova flag impacta diretamente na sensibilidade do sistema.  Recomendamos revisar a documentação em `docs/` para compreender as bases psicológicas e fisiológicas que embasam cada regra.

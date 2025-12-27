# PINGO Agent Repository

Este repositório contém os artefatos essenciais para operacionalizar o **PINGO**, o agente de inteligência do sistema **MINDS Performance**.  Aqui estão os componentes técnicos que permitem coletar dados dos atletas, processá‑los com base em regras transparentes e acionar intervenções por meio de automações no n8n e armazenamento no Supabase.

## 🌐 Visão Geral

O objetivo do PINGO é transformar dados dispersos da rotina do atleta (humor, carga de treino, contexto, etc.) em **sinais acionáveis** e micro‑intervenções.  Ele faz isso aplicando regras de pontuação explicitadas em arquivos JSON versionados neste repositório, salvando métricas no Supabase e orquestrando notificações via n8n.  A lógica de decisão permanece em código aberto para facilitar auditoria e melhoria contínua.

## 📂 Estrutura do Projeto

```
pingo-agent/
├── README.md                # Este arquivo
├── schema/
│   └── supabase_schema.sql  # Definição de tabelas e views no Supabase
├── forms/
│   ├── minds_performance_forms.gs    # Script Apps Script para criar formulários Google
│   └── minds_performance_analysis.gs # Script Apps Script para analisar respostas e enviar ao Supabase
├── scoring/
│   ├── brums_rules.json     # Regras para classificar BRUMS (vigor e DTH) e gerar flags
│   ├── red_flags.json       # Tipos de red flags para comportamentos/emóções
│   └── attention_levels.json# Mapeamento de número de flags para nível de atenção (verde/amarelo/vermelho)
├── flows/
│   └── pingo_flow.yaml      # Exemplo de fluxo n8n para processar dados diários
└── docs/
    ├── manual_minds_performance.pdf  # Manual institucional (convertido do .docx)
    └── value_proposition.pdf         # Proposta de valor estratégica
```

### schema/supabase_schema.sql

Define todas as tabelas necessárias para armazenar cadastros de atletas, análises de questionários (BRUMS, ACSI‑28BR, GSES‑12, PMCSQ‑2, RESTQ‑Sport, CBAS/LSS), cargas de treino semanais, avaliações nutricionais e vistas calculadas (z‑scores e flags).  É possível importar este arquivo diretamente no Supabase para criar a base de dados.

### forms/

Contém scripts de **Google Apps Script** que automatizam a criação dos formulários e a análise das respostas:

- **minds_performance_forms.gs**: gera formulários diários, semanais e trimestrais no Google Forms. Os formulários incluem o BRUMS, carga de treino, check‑ins de vigor, questionários ACSI‑28BR, GSES‑12, PMCSQ‑2, RESTQ‑Sport e blocos qualitativos. Cada formulário solicita o identificador do atleta e organiza as perguntas em seções lógicas.
- **minds_performance_analysis.gs**: analisa as respostas dos formulários e grava métricas em novas abas do Google Sheets. Calcula somatórios, médias, desvio‑padrão, z‑scores e envia os dados para o Supabase via REST API.

### scoring/

Esta pasta concentra os arquivos JSON que definem as **regras de pontuação**.  Ao mantê‑los aqui, é possível versionar e auditar mudanças sem modificar o código do n8n:

- **brums_rules.json** – Categoriza o **Vigor** (energia) e o **DTH** (soma das escalas negativas) em níveis alto/médio/baixo usando desvio‑padrão intra‑indivíduo.  Inclui uma condição para gerar a flag **A** quando o vigor está baixo e o DTH está elevado.
- **red_flags.json** – Enumera os tipos de red flags identificados pelo sistema:  
  - `A`: estado agudo desfavorável detectado pelo BRUMS  
  - `B`: padrões negativos persistentes (≥ 3 dias consecutivos) ou instabilidade  
  - `C`: contexto amplificador, como clima de ego alto no PMCSQ‑2 ou eventos críticos reportados.
- **attention_levels.json** – Mapeia o número de flags acumuladas para um nível de atenção: 0 → Verde, 1 → Atenção, 2 → Amarelo, ≥ 3 → Vermelho.

### flows/pingo_flow.yaml

Exemplo de fluxo do **n8n** para processar dados diários enviados por formulários ou webhooks.  O YAML serve como guia e deve ser importado ou replicado no editor do n8n, adaptando as credenciais e URLs conforme a sua instância.  Principais etapas:

1. **Webhook** – recebe o payload diário (ID do atleta, respostas do BRUMS, RPE, duração, peso, modalidade etc.).
2. **HTTP Request** – baixa as regras de pontuação (por exemplo, `brums_rules.json`) diretamente deste repositório via URL raw do GitHub.
3. **Function** – calcula as somas do BRUMS (DTH e Vigor), o score DTH – Vigor, determina as categorias (alto/médio/baixo) conforme as regras, gera as flags A/B/C e contabiliza o número de flags.  Também calcula a carga de treino (RPE × duração) e normaliza campos extras (peso, tempo de treino).
4. **HTTP Request** – envia o resultado para a API do Supabase (tabela `brums_analysis`).
5. **Switch** – avalia a quantidade de flags e direciona para ramos de notificação (verde, atenção, amarelo, vermelho).  Cada ramo pode acionar mensagens no WhatsApp, e‑mails ou dashboards, conforme descrito no fluxo operacional do PINGO.

## 🔧 Como utilizar

1. **Configurar o Supabase**: importe `schema/supabase_schema.sql` em um projeto Supabase vazio.  Copie a URL e a chave anônima (anon key) para utilizar nos scripts.
2. **Criar formulários**: abra o editor de Apps Script e cole o conteúdo de `forms/minds_performance_forms.gs`.  Execute `createAllForms()` (ou as funções específicas) para gerar os formulários de coleta.  Conecte cada formulário a uma planilha Google Sheets.
3. **Analisar respostas**: cole o script de `forms/minds_performance_analysis.gs` no mesmo projeto Apps Script ligado à planilha de respostas e execute a função correspondente (por exemplo, `analyzeDailyResponses()`).  Esse script gera abas de análise com z‑scores e envia os registros para o Supabase.
4. **Configurar o n8n**: importe ou crie o fluxo descrito em `flows/pingo_flow.yaml`.  Ajuste o webhook inicial para apontar para a URL gerada pelo n8n.  Configure o node de HTTP Request com as credenciais do Supabase e a URL raw do GitHub para baixar as regras de pontuação.  Ajuste as mensagens de notificação conforme a sua estratégia de comunicação.
5. **Versionar regras**: altere os arquivos JSON em `scoring/` para refinar classificações ou criar novas flags.  O n8n sempre irá buscar a versão mais recente no GitHub raw, tornando as mudanças instantâneas sem necessidade de reimplementar código.

## 📜 Referências

Este repositório foi construído com base em diversos documentos da iniciativa MINDS, incluindo a proposta de valor estratégica, o manual institucional e os scripts originais de formulários.  Eles foram condensados para fornecer um kit pronto de implementação.  Para detalhes conceituais sobre as escalas psicométricas, a análise do comportamento e a integração com nutrição de alto rendimento, consulte os documentos em `docs/`.

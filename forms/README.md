## Pastas de Formulários (`forms`)

Esta pasta contém scripts de Google Apps Script que automatizam a criação dos formulários do MINDS Performance e a análise das respostas.

### Arquivos

| Arquivo                         | Descrição |
|--------------------------------|-----------|
| **minds_performance_forms.gs** | Funções para criar formulários diários, semanais e trimestrais. Cada formulário pede o identificador do atleta e contém perguntas relacionadas ao BRUMS, carga de treino, questionários psicométricos (ACSI‑28BR, GSES‑12, PMCSQ‑2, RESTQ‑Sport, CBAS/LSS), além de blocos qualitativos. A função `createAllFormsLinked()` gera todos os formulários e os vincula à planilha mãe. |
| **minds_performance_analysis.gs** | Funções para processar as respostas dos formulários. O script lê as respostas na planilha, calcula somatórios e médias, computa z‑scores intra‑indivíduo e envia os resultados para o Supabase via REST API. Também expõe endpoints de relatório (`dailySummary`, `weeklySummary`, etc.) para consulta rápida via HTTP. |

### Uso

1. Abra o Google Apps Script (script.google.com) e cole o conteúdo de `minds_performance_forms.gs`. Ajuste as variáveis `MASTER_SHEET_ID` e `MASTER_SHEET_NAME` conforme sua planilha. Execute `createAllFormsLinked()` para gerar e vincular os formulários.
2. No mesmo projeto, cole `minds_performance_analysis.gs` e configure o Supabase (URL e chave API). As funções `analyzeDailyResponses()`, `analyzeWeeklyResponses()` etc. podem ser agendadas para rodar automaticamente.
3. Os scripts estão comentados em português e podem ser adaptados para incluir novos questionários ou métricas.
# Fluxos n8n

O PINGO utiliza **n8n**, uma plataforma de automação, para orquestrar tarefas assíncronas como coleta de dados, cálculo de scores e envio de notificações.  Esta pasta contém exemplos de fluxos em formato **YAML** que podem ser importados diretamente no n8n (Menu *Import/Export* → *Import from file*).

## Arquivos

| Arquivo | Objetivo |
| --- | --- |
| **pingo_flow.yaml** | Fluxo original de referência.  Demonstra como coletar dados diários via webhook, aplicar regras básicas do BRUMS e enviar notificações com base no número de flags.  É útil para entender a lógica elementar e serve como ponto de partida. |
| **construcional_webhook.yaml** | Fluxo atualizado para operar em modo *webhook*, sem fila.  Recebe blocos de texto da avaliação construcional, envia o conteúdo a um modelo de linguagem (LLM) que classifica cada dimensão (repertório protetor/risco, apoio ambiental, claridade de metas) e grava o resultado no Supabase via RPC `upsert_construcional_analysis`.  Ao final, dispara o fluxo de cálculo de score. |
| **run_scoring_webhook.yaml** | Motor de pontuação.  Ao receber a chamada via webhook, busca os inputs consolidados da view `pingo_scoring_inputs_view`, baixa as regras de pontuação do repositório e aplica o `scoring_engine.json` para gerar flags, determinar o nível de atenção e persistir os resultados com `upsert_pingo_scoring_output`.  Pode ser invocado diretamente após análises qualitativas ou em batch diário. |
| **alert_dispatch_webhook.yaml** | Disparador de alertas.  Após o cálculo do score, este fluxo decide o canal e o texto da mensagem a partir de `attention_level` e `flag_count`.  Envia alertas via API Evolution para intern/coach/psicólogo conforme a gravidade (verde → sem alerta, amarelo → ajuste necessário, vermelho → escalonamento obrigatório).  Também grava um log de alertas no Supabase para auditoria. |

## Uso básico

1. **Importar** o YAML desejado no seu painel n8n e ajustar as credenciais (Supabase URL, chave de serviço e URLs de APIs externas).
2. **Configurar Webhooks**: cada fluxo começa com um nó Webhook; copie a URL exibida pelo n8n e configure o disparo correspondente (por exemplo, no Apps Script ou no Supabase) para enviar os dados para esse endpoint.
3. **Adaptar** os nós de IA: o fluxo `construcional_webhook.yaml` assume a presença de um node ChatGPT ou modelo similar.  Ajuste o provider (OpenAI, Anthropich, etc.) e o prompt conforme suas necessidades.
4. **Personalizar Notificações**: edite os textos e destinos dos alertas no `alert_dispatch_webhook.yaml` para refletir sua estrutura de comissão técnica.

Estes fluxos implementam o pipeline completo descrito na proposta do PINGO: coleta de dados → classificação qualitativa → cálculo de score → notificação comportamental.

# MINDS Performance – Guia Completo e Lógica Final

Este documento sintetiza a arquitetura atualizada do **PINGO**, o motor de inteligência do MINDS Performance, e descreve como os componentes do repositório interagem para transformar dados de rotina dos atletas em sinais acionáveis e intervenções comportamentais.  Após as melhorias discutidas, a solução opera inteiramente por webhooks, eliminando filas internas e ciclos de polling para reduzir latência e simplificar a implementação.

## 🔁 Pipeline completo

1. **Coleta de dados via formulários** – os scripts em `forms/` criam formulários Google (diários, semanais, trimestrais) que medem humor (BRUMS), carga de treino, adesão nutricional, escalas psicossociais (ACSI‑28BR, GSES‑12, PMCSQ‑2, RESTQ‑Sport) e perguntas qualitativas (construcional). As respostas são gravadas em planilhas Google e analisadas via Apps Script, que enviam registros para o Supabase utilizando a API REST【951987460632417†L10-L15】.
2. **Armazenamento e normalização no Supabase** – o script `schema/supabase_ddl.qsl` define todas as tabelas e índices.  Em `supabase_analytics.sql` são criadas views de z‑score intra‑individuais (por atleta) e uma view consolidada (`pingo_scoring_inputs_view`) que reúne os sinais mais recentes de BRUMS, dieta e construcional.  Uma função `upsert_pingo_scoring_output` persiste o score final com base no número de flags【951987460632417†L45-L51】.
3. **Classificação qualitativa** – quando chegam blocos do construcional, o webhook `construcional_webhook.yaml` (dentro de `flows/`) é acionado.  Ele envia os textos a um modelo de linguagem (ChatGPT ou similar) que classifica as quatro dimensões em low/medium/high, normaliza a saída e grava os resultados no Supabase via RPC `upsert_construcional_analysis`.  Logo em seguida, chama o webhook de cálculo de score.
4. **Motor de scoring** – o webhook `run_scoring_webhook.yaml` lê os insumos consolidados de `pingo_scoring_inputs_view`, busca as regras de pontuação (arquivos em `scoring/`), aplica o `scoring_engine.json` e suas regras auxiliares (`brums_rules.json`, `construcional_rules.json`, `diet_adherence_rules.json`) para gerar flags e determinar o nível de atenção.  O resultado é salvo com `upsert_pingo_scoring_output` e inclui um resumo com as flags desencadeadas【111214856191087†L10-L26】【111214856191087†L36-L59】.
5. **Despacho de alertas** – após calcular o score, o fluxo dispara o webhook `alert_dispatch_webhook.yaml`.  Um switch avalia `attention_level` e envia mensagens via API Evolution conforme o número de flags: 0 (verde) → sem alerta; 1 (atenção) → notificar intern; 2 (amarelo) → notificar intern + treinador; ≥3 (vermelho) → escalonamento obrigatório para intern, treinador e psicólogo【876828957937634†L0-L20】.  As mensagens seguem o estatuto da engenharia comportamental (não diagnosticar nem prescrever), indicando apenas o risco funcional e orientando o próximo passo.

## 📂 Estrutura atualizada

Após a revisão, cada pasta possui um **README.md** dedicado que explica sua finalidade:

- `forms/README.md` – descreve os scripts de criação e análise de formulários.
- `schema/README.md` – explica como inicializar o banco Supabase e as views analíticas.
- `scoring/README.md` – documenta os arquivos JSON de regras (engine, red flags, correlações, níveis de atenção) e a lógica de agregação.
- `flows/README.md` – lista os fluxos do n8n (pingo original e os novos webhooks) e orienta a importação.

Além disso, adicionamos novos fluxos YAML em `flows/`:

| Fluxo | Função |
| --- | --- |
| **construcional_webhook.yaml** | Classifica respostas qualitativas, grava no Supabase e dispara o cálculo de score. |
| **run_scoring_webhook.yaml** | Lê insumos, aplica as regras de pontuação, gera flags e salva o score. |
| **alert_dispatch_webhook.yaml** | Notifica a comissão via Evolution (WhatsApp) conforme o nível de atenção e registra o alerta. |

## 📌 Observações finais

- O PINGO respeita os princípios de **não diagnóstico** e **não prescrição**: ele apenas quantifica sinais de risco e delega a decisão aos profissionais responsáveis【111214856191087†L10-L26】.  As mensagens de alerta seguem o modelo “sem improviso, sem pânico”.
- As regras de pontuação (arquivos em `scoring/`) são transparentes e versionadas.  Qualquer alteração deve passar por revisão da equipe técnica para evitar alarmes falsos ou omissões.
- Para personalizar a comunicação, altere os templates de mensagem no fluxo `alert_dispatch_webhook.yaml` e ajuste os números de telefone na variável Evolution.
- Recomenda‑se habilitar um cron “watchdog” no n8n para conferir se há registros sem score (backup).  No entanto, a arquitetura principal opera apenas com triggers.

Este guia consolida o conhecimento de toda a engenharia comportamental da plataforma MINDS, fornecendo uma visão coesa de como os dados são coletados, analisados e transformados em ações concretas.  Ele serve como manual de referência para desenvolvedores e gestores que pretendem adaptar ou escalar o PINGO em outros contextos esportivos ou de bem‑estar.

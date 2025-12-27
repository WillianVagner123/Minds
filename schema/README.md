# Esquema e análises do Supabase

Esta pasta contém os scripts SQL necessários para provisionar e estender o banco de dados do PINGO no **Supabase**.  As tabelas e views foram projetadas para armazenar e processar dados do dia‑a‑dia dos atletas, seguindo o princípio de análise **intra‑individual** do sistema.

## Arquivos

| Arquivo | Descrição |
| --- | --- |
| **supabase_ddl.qsl** | Script de **Definição de Dados** que cria todas as tabelas fundamentais.  Inclui cadastros de atletas, análises de BRUMS, ACSI‑28BR, GSES‑12, PMCSQ‑2, RESTQ‑Sport, CBAS/LSS, check‑ins semanais e mensais, tabelas de dietas e o repositório de texto **construcional**.  Também define índices e constraints para garantir unicidade por atleta/data. |
| **supabase_analytics.sql** | Extensões analíticas para o banco.  Fornece views que calculam z‑scores por atleta, vistas consolidadas para insumos do motor de pontuação e funções auxiliares.  Na versão original, este arquivo também incluía uma fila (`analysis_jobs`) e funções para **claim** e **mark** jobs; na versão orientada a *webhooks* estas funções podem ser omitidas.  Além disso, define uma função `upsert_pingo_scoring_output` para inserir o score final com base no número de flags. |

## Como utilizar

1. **Criar as tabelas**: importe o script `supabase_ddl.qsl` em um projeto Supabase vazio.  Todas as tabelas e índices serão criados automaticamente.  Certifique‑se de habilitar a extensão `vector` para armazenamento de embeddings.
2. **Adicionar as views e funções**: após o DDL, execute `supabase_analytics.sql` para criar as views de z‑score e as funções de inserção e upsert.  Ajuste o arquivo conforme o seu modo de operação: se utilizar fila no n8n, mantenha as funções de `analysis_jobs`; se utilizar webhooks diretos, adapte para usar somente as `upsert` que inserem diretamente nos resultados.  O script de analytics também contém uma view `pingo_latest_score_view` para obter o último score por atleta.
3. **Segurança e RLS**: verifique se as policies de row‑level security estão configuradas corretamente para permitir leitura/escrita pelos serviços n8n (via chave service role) e impedir acessos não autorizados.

Ao combinar `supabase_ddl.qsl` e `supabase_analytics.sql`, você obterá uma base completa para armazenar dados, calcular métricas e persistir os resultados do motor de scoring descrito em `scoring/scoring_engine.json`【951987460632417†L45-L51】.

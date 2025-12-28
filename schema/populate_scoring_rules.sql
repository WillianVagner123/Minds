-- ===========================================================
-- 📥  POPULAR SCORING_RULES
--
-- Este script insere no Supabase os arquivos de regras de scoring
-- disponíveis no repositório GitHub. As regras são carregadas
-- diretamente em formato JSON e associadas ao URL raw de origem.
-- É recomendável executar este script após criar as tabelas via
-- supabase_ddl.qsl. Caso já existam entradas para uma das chaves,
-- o comando ON CONFLICT garante a atualização do conteúdo.
-- ===========================================================

insert into scoring_rules(key, source_url, content, version)
values
  (
    'attention_levels',
    'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/attention_levels.json',
    -- mapeia códigos numéricos para rótulos de atenção
    '{"0": "Verde", "1": "Atenção", "2": "Amarelo", "3": "Vermelho"}',
    1
  ),
  (
    'brums_rules',
    'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/brums_rules.json',
    -- regras de categorização do BRUMS e definição de flags A e B
    '{"version": 2, "generated_at": "2025-12-27", "vigor": {"high": ">= +1 SD", "medium": "> -1 SD and < +1 SD", "low": "<= -1 SD"}, "dth": {"low": "<= +0.5 SD", "medium": "> +0.5 SD and <= +1.5 SD", "high": "> +1.5 SD"}, "flags": [
      {"flag": "A1", "class": "A", "description": "Estado agudo desfavorável: vigor baixo + DTH >= médio", "condition": "vigor == ''low'' && (dth == ''medium'' || dth == ''high'')"},
      {"flag": "A2", "class": "A", "description": "Estado agudo crítico: vigor baixo + DTH alto", "condition": "vigor == ''low'' && dth == ''high''"},
      {"flag": "A3", "class": "A", "description": "Hiperativação sob estresse: vigor alto + DTH alto (risco de custo funcional elevado)", "condition": "vigor == ''high'' && dth == ''high''"},
      {"flag": "A4", "class": "A", "description": "Estresse agudo relevante: vigor médio + DTH alto", "condition": "vigor == ''medium'' && dth == ''high''"},
      {"flag": "A5", "class": "A", "description": "Fadiga/baixa energia (mesmo sem DTH alto): vigor baixo + DTH baixo/médio", "condition": "vigor == ''low'' && (dth == ''low'' || dth == ''medium'')"},
      {"flag": "A6", "class": "A", "description": "Sinal extremo de DTH (z >= +2.5): pico agudo importante", "condition": "typeof dth_z !== ''undefined'' && dth_z >= 2.5"},
      {"flag": "A7", "class": "A", "description": "Sinal extremo de vigor baixo (z <= -2.5): queda aguda importante", "condition": "typeof vigor_z !== ''undefined'' && vigor_z <= -2.5"},
      {"flag": "B1", "class": "B", "description": "Padrão negativo: DTH alto por >= 3 dias", "condition": "typeof dth_high_days !== ''undefined'' && dth_high_days >= 3"},
      {"flag": "B2", "class": "B", "description": "Padrão negativo: vigor baixo por >= 3 dias", "condition": "typeof vigor_low_days !== ''undefined'' && vigor_low_days >= 3"},
      {"flag": "B3", "class": "B", "description": "Instabilidade: alta volatilidade do DTH (janela 7d)", "condition": "typeof dth_volatility_7d !== ''undefined'' && dth_volatility_7d >= 1.2"},
      {"flag": "B4", "class": "B", "description": "Instabilidade: alta volatilidade do vigor (janela 7d)", "condition": "typeof vigor_volatility_7d !== ''undefined'' && vigor_volatility_7d >= 1.2"},
      {"flag": "B5", "class": "B", "description": "Queda abrupta de vigor (delta <= -1.0 SD vs dia anterior)", "condition": "typeof vigor_delta_1d !== ''undefined'' && vigor_delta_1d <= -1.0"},
      {"flag": "B6", "class": "B", "description": "Subida abrupta de DTH (delta >= +1.0 SD vs dia anterior)", "condition": "typeof dth_delta_1d !== ''undefined'' && dth_delta_1d >= 1.0"}
    ]}',
    2
  ),
  (
    'construcional_rules',
    'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/construcional_rules.json',
    -- regras para classificar repertório protetor/risco, apoio ambiental e claridade de metas
    '{"version": 1, "scales": {
      "repertorio_protetor": {"low": "<=0", "medium": "==1", "high": ">=2"},
      "repertorio_risco": {"low": "<=0", "medium": "==1", "high": ">=2"},
      "apoio_ambiental": {"low": "<=0", "medium": "==1", "high": ">=2"},
      "claridade_metas": {"low": "<=0", "medium": "==1", "high": ">=2"}
    }, "flags": [
      {"flag": "C1", "class": "C", "description": "Construcional: alto repertório de risco + baixo repertório protetor", "condition": "repertorio_risco == ''high'' && repertorio_protetor == ''low''"},
      {"flag": "C2", "class": "C", "description": "Construcional: apoio ambiental baixo (restrição contextual relevante)", "condition": "apoio_ambiental == ''low''"},
      {"flag": "C3", "class": "C", "description": "Construcional: metas pouco claras (reduz orientação e autorregulação)", "condition": "claridade_metas == ''low'' && repertorio_protetor != ''high''"}
    ]}',
    1
  ),
  (
    'diet_adherence_rules',
    'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/diet_adherence_rules.json',
    -- regras de adesão à dieta e sinais biológicos/funcionais
    '{"version": 1, "adherence_levels": {
      "high": ">=80", "medium": ">=60 and <80", "low": "<60"
    }, "risk_signals": {
      "energy_availability_risk": {"true": "==true"},
      "missed_meals": {"high": ">=2", "moderate": "==1", "low": "==0"},
      "gi_distress": {"high": ">=7", "moderate": ">=4 and <7", "low": "<4"}
    }, "flags": [
      {"flag": "D1", "class": "B", "description": "Adesão baixa sustentada (>=3 dias) ou queda relevante", "condition": "adherence_level == ''low'' && adherence_low_days >= 3"},
      {"flag": "D2", "class": "A", "description": "Sinal agudo: desconforto GI alto no dia (pode elevar custo funcional do treino)", "condition": "gi_distress == ''high''"},
      {"flag": "D3", "class": "C", "description": "Risco de disponibilidade energética reportado (contexto biológico amplificador)", "condition": "energy_availability_risk == true"}
    ]}',
    1
  ),
  (
    'questionnaire_correlation_rules',
    'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/questionnaire_correlation_rules.json',
    -- regras de correlação entre BRUMS e demais questionários
    '{"version": 1, "generated_at": "2025-12-27", "inputs_expected": {
      "brums": ["vigor", "dth"], "acsi": ["coping_with_adversity", "peaking_under_pressure"], "gses": ["gses_total"], "restq": ["restq_state"], "pmcsq2": ["ego_climate_high"], "construcional": ["repertorio_protetor", "repertorio_risco", "apoio_ambiental", "claridade_metas"], "diet": ["adherence_level", "energy_availability_risk"]
    }, "flags": [
      {"flag": "X1", "class": "A", "description": "Ambíguo no BRUMS + coping baixo => estado do dia com repertório insuficiente", "condition": "vigor == ''low'' && dth == ''medium'' && coping_with_adversity < 10"},
      {"flag": "X2", "class": "A", "description": "Ambíguo no BRUMS + pressão baixa + autoeficácia baixa => risco de manejo ruim do treino", "condition": "vigor == ''low'' && dth == ''medium'' && peaking_under_pressure < 6 && gses_total == ''low''"},
      {"flag": "X3", "class": "B", "description": "Estado ruim + RESTQ baixo => custo funcional acumulado (padrão)", "condition": "(vigor == ''low'' && (dth == ''medium'' || dth == ''high'')) && restq_state == ''low''"},
      {"flag": "X4", "class": "C", "description": "Estado ruim + clima de ego alto => contexto amplificador", "condition": "(vigor == ''low'' && dth == ''high'') && ego_climate_high == true"},
      {"flag": "X5", "class": "C", "description": "BRUMS ambíguo + repertório de risco alto e proteção baixa (construcional) => vulnerabilidade funcional", "condition": "vigor == ''low'' && dth == ''medium'' && repertorio_risco == ''high'' && repertorio_protetor == ''low''"},
      {"flag": "X6", "class": "B", "description": "BRUMS desfavorável + adesão baixa sustentada => padrão misto (emoção + dieta)", "condition": "(vigor == ''low'' && (dth == ''medium'' || dth == ''high'')) && adherence_level == ''low'' && typeof adherence_low_days !== ''undefined'' && adherence_low_days >= 3"},
      {"flag": "X7", "class": "C", "description": "Qualquer estado desfavorável + risco de disponibilidade energética reportado => amplificador biológico", "condition": "(vigor == ''low'' || dth == ''high'') && energy_availability_risk == true"}
    ]}',
    1
  ),
  (
    'red_flags',
    'https://raw.githubusercontent.com/WillianVagner123/Minds/refs/heads/main/scoring/red_flags.json',
    -- dicionário legível para cada código de bandeira
    '{"A1": "BRUMS: vigor baixo + DTH >= médio (agudo)", "A2": "BRUMS: vigor baixo + DTH alto (agudo crítico)", "A3": "BRUMS: vigor alto + DTH alto (hiperativação sob estresse)", "A4": "BRUMS: vigor médio + DTH alto (estresse agudo relevante)", "A5": "BRUMS: vigor baixo (fadiga/baixa energia)", "A6": "BRUMS: DTH extremo (z>=+2.5)", "A7": "BRUMS: vigor extremamente baixo (z<=-2.5)", "B1": "BRUMS: DTH alto >=3 dias (padrão)", "B2": "BRUMS: vigor baixo >=3 dias (padrão)", "B3": "BRUMS: volatilidade DTH alta (7d)", "B4": "BRUMS: volatilidade vigor alta (7d)", "B5": "BRUMS: queda abrupta vigor (1d)", "B6": "BRUMS: subida abrupta DTH (1d)", "C1": "Construcional: risco alto + proteção baixa", "C2": "Construcional: apoio ambiental baixo", "C3": "Construcional: metas pouco claras + proteção não alta", "D1": "Dieta: adesão baixa sustentada (>=3 dias)", "D2": "Dieta: desconforto GI alto no dia", "D3": "Dieta: risco de disponibilidade energética reportado", "X1": "Cruzamento: BRUMS ambíguo + coping baixo (ACSI)", "X2": "Cruzamento: BRUMS ambíguo + pressão baixa (ACSI) + autoeficácia baixa (GSES)", "X3": "Cruzamento: BRUMS desfavorável + RESTQ baixo (padrão acumulado)", "X4": "Cruzamento: BRUMS crítico + EGO alto (PMCSQ-2) (contexto amplificador)", "X5": "Cruzamento: BRUMS ambíguo + construcional (risco alto/proteção baixa)", "X6": "Cruzamento: BRUMS desfavorável + adesão baixa sustentada (dieta) (padrão misto)", "X7": "Cruzamento: estado desfavorável + risco de disponibilidade energética (amplificador biológico)"}',
    1
  )
on conflict(key) do update
set
  source_url = excluded.source_url,
  content    = excluded.content,
  version    = excluded.version,
  updated_at = now();

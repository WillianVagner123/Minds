/* =========================
   CONFIG
========================= */

// ID da PLANILHA MÃE (onde ficam as abas RESP_DAILY, RESP_WEEKLY etc.)
var MASTER_SHEET_ID = ""; // <-- cole aqui

// Nome das abas
var TAB_NAMES = {
  DAILY: "RESP_DAILY",
  WEEKLY: "RESP_WEEKLY",
  QUARTERLY: "RESP_QUARTERLY",
  SEMIANNUAL: "RESP_SEMIANNUAL",
  RESTQ_TRAINER: "RESP_RESTQ_TRAINER",
  REGISTRATION: "RESP_REGISTRATION",
  CONSTRUCIONAL: "RESP_CONSTRUCIONAL" // se existir, ajuste o nome
};

// Webhooks n8n
var N8N_CONSTRUCIONAL_WEBHOOK_URL = "https://autowebhook.opingo.com.br/webhook/Construcional";
var N8N_RUNSCORING_WEBHOOK_URL   = "https://autowebhook.opingo.com.br/webhook/RunScoring";

// Colunas “base” (ajuste conforme seus cabeçalhos exatos na planilha)
var COL = {
  timestamp: "Carimbo de data/hora",
  athleteId: "ID do atleta (código interno ou CPF)",

  // diário (exemplos do seu texto)
  evalDate: "Data da avaliação",
  rpe: "Percepção subjetiva de esforço (RPE) da sessão",
  durationMin: "Duração da sessão (minutos)",
  adherence: "Hoje, o quanto você conseguiu seguir o plano alimentar combinado?",
  missedMeals: "Hoje você deixou de fazer alguma refeição importante (café, almoço, jantar ou lanche pré/pós)?",
  lowEnergy: "Hoje você sentiu que comeu menos do que precisava para treinar/recuperar bem?",
  gi: "Hoje, qual foi o nível de desconforto gastrointestinal (estômago/intestino)?"
};

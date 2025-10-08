// server.js
/* Webhook Helpdesk - fluxo contextual, robusto e profissional
   - Context-aware parsing: só interpreta "1/2/3/4" quando estamos no menu (IDLE).
   - Comandos globais: "menu", "voltar", "sair".
   - Suporta: autenticação por matrícula, abertura de ticket, listar tickets, pedir atendente.
   - Proteções: sessão com TTL, fetch com timeout, tratamento de erros.
*/

const express = require("express");
const fetch = require("node-fetch");
const { v4: uuidv4 } = require("uuid");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// CONFIG
const SESSION_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

// SESSÕES EM MEMÓRIA
const sessions = new Map();

// util: fetch com timeout
async function fetchWithTimeout(url, opts = {}, timeout = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// limpa sessões expiradas
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions.entries()) {
    if (now - v.lastAt > SESSION_TTL_MS) sessions.delete(k);
  }
}, 60 * 1000);

// helpers SheetBest
async function getSheetData() {
  const r = await fetchWithTimeout(SHEETBEST_URL);
  if (!r.ok) throw new Error(`SheetBest GET: ${r.status}`);
  const json = await r.json();
  if (!Array.isArray(json)) throw new Error("SheetBest: resposta não é array");
  return json;
}
async function postToSheet(obj) {
  const r = await fetchWithTimeout(SHEETBEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`SheetBest POST ${r.status} ${text}`);
  }
  return true;
}

// busca usuário por matrícula
async function findUserByMatricula(matricula) {
  const data = await getSheetData();
  return data.find(row => String(row.matricula || "").trim() === String(matricula).trim()) || null;
}

// cria ticket (registra na planilha)
async function createTicket(usuario, descricao, tipo = "ticket") {
  const ticketId = `T${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
  const payload = {
    tipo,
    ticketId,
    matricula: usuario.matricula || "",
    nome: usuario.nome || "",
    setor: usuario.setor || "",
    descricao,
    status: "Aberto",
    criado_em: new Date().toLocaleString("pt-BR"),
  };
  await postToSheet(payload);
  return ticketId;
}

// lista tickets por matrícula
async function listTickets(matricula) {
  const data = await getSheetData();
  const tickets = data.filter(r => {
    const isTicket = (r.tipo && String(r.tipo).toLowerCase() === "ticket") || Boolean(r.ticketId);
    return isTicket && String(r.matricula || "").trim() === String(matricula).trim();
  });
  return tickets;
}

// menus e mensagens
function mainMenu(usuario) {
  const nome = usuario?.nome || "colaborador";
  return `🎯 Olá ${nome}!\nEscolha uma opção:\n1 - Abrir chamado\n2 - Ver meus chamados\n3 - Falar com atendente\n4 - Encerrar atendimento\n\n(Digite o número da opção ou escreva 'menu' a qualquer momento)`;
}
function helpShort() {
  return "Dica: digite o número da opção (1-4) ou 'menu' / 'voltar' / 'sair'.";
}

// detecta intenção de menu — apenas quando estado IDLE
function detectMenuIntent(text, params, sessionState) {
  if (sessionState !== "IDLE") return null;

  // prioridade: parâmetro explícito enviado pelo Dialogflow
  if (params && params.opcao) {
    const op = String(params.opcao).trim();
    if (/^[1-4]$/.test(op)) return op;
  }

  // se o texto for apenas um dígito isolado
  if (/^\s*[1-4]\s*$/.test(text)) {
    return text.trim();
  }

  // mapeamentos por palavras-chave (começo da frase ou palavra isolada)
  const t = text.toLowerCase().trim();
  if (/^(abrir|abrir chamado|quero abrir)/.test(t)) return "1";
  if (/^(ver|meus chamados|status|consultar)/.test(t)) return "2";
  if (/^(atendente|falar com|suporte|humano)/.test(t)) return "3";
  if (/^(sair|encerrar|fechar|finalizar)/.test(t)) return "4";

  return null;
}

// global commands that always work
function detectGlobalCommand(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (t === "menu" || t === "voltar") return "MENU";
  if (t === "sair" || t === "encerrar" || t === "exit") return "EXIT";
  return null;
}

// entrypoint
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = body.session || ("sess:" + (req.ip || "anon"));
    const params = body.queryResult?.parameters || {};
    const text = String(body.queryResult?.queryText || "").trim();

    // obter/atualizar sessão
    let sess = sessions.get(sessionId);
    if (!sess) {
      sess = { state: "WAIT_MATRICULA", lastAt: Date.now(), temp: {}, usuario: null, matricula: null };
      sessions.set(sessionId, sess);
    } else {
      sess.lastAt = Date.now();
    }

    // comandos globais
    const gcmd = detectGlobalCommand(text);
    if (gcmd === "MENU") {
      if (sess.usuario) {
        sess.state = "IDLE";
        return res.json({ fulfillmentText: mainMenu(sess.usuario) + "\n\n" + helpShort() });
      } else {
        sess.state = "WAIT_MATRICULA";
        return res.json({ fulfillmentText: "Por favor informe sua matrícula para começar." });
      }
    }
    if (gcmd === "EXIT") {
      sessions.delete(sessionId);
      return res.json({ fulfillmentText: "👋 Atendimento encerrado. Até breve!" });
    }

    // State machine
    switch (sess.state) {
      case "WAIT_MATRICULA": {
        // aceita parâmetro matricula ou texto com dígitos
        const matricula = params.matricula ? String(params.matricula).trim() : (text.match(/\d{3,}/)?.[0] || null);
        if (!matricula) {
          return res.json({ fulfillmentText: "Por favor, informe sua matrícula (somente números)." });
        }
        // busca usuário
        let usuario;
        try {
          usuario = await findUserByMatricula(matricula);
        } catch (err) {
          console.error("Erro SheetBest GET:", err);
          return res.json({ fulfillmentText: "⚠️ Erro ao consultar a base. Tente novamente em alguns instantes." });
        }
        if (!usuario) {
          // inicia fluxo de cadastro
          sess.state = "AWAIT_REG_NAME";
          sess.temp.matricula = matricula;
          return res.json({ fulfillmentText: "Matrícula não encontrada. Deseja cadastrar? Informe seu nome completo para iniciar o cadastro." });
        }
        // autêntica
        sess.usuario = usuario;
        sess.matricula = matricula;
        sess.state = "IDLE";
        return res.json({ fulfillmentText: `✅ Matrícula confirmada! Bem-vindo(a), ${usuario.nome || "colaborador"} (${usuario.setor || "setor não informado"}).\n\n${mainMenu(usuario)}` });
      }

      case "AWAIT_REG_NAME": {
        const name = params.nome || text || null;
        if (!name) return res.json({ fulfillmentText: "Por favor informe seu nome completo para cadastro." });
        sess.temp.name = name;
        sess.state = "AWAIT_REG_EMAIL";
        return res.json({ fulfillmentText: "Obrigado. Agora informe seu email." });
      }

      case "AWAIT_REG_EMAIL": {
        const email = params.email || text || null;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ fulfillmentText: "Informe um email válido." });
        sess.temp.email = email;
        sess.state = "AWAIT_REG_PHONE";
        return res.json({ fulfillmentText: "Ok. Agora informe seu telefone (com DDD)." });
      }

      case "AWAIT_REG_PHONE": {
        const phone = params.telefone || text || null;
        if (!phone) return res.json({ fulfillmentText: "Informe um telefone válido." });
        sess.temp.phone = phone;
        sess.state = "AWAIT_REG_DEPT";
        return res.json({ fulfillmentText: "Informe seu departamento/setor." });
      }

      case "AWAIT_REG_DEPT": {
        const dept = params.departamento || text || null;
        if (!dept) return res.json({ fulfillmentText: "Por favor informe seu departamento." });

        const newUser = {
          tipo: "user",
          matricula: sess.temp.matricula,
          nome: sess.temp.name,
          email: sess.temp.email,
          telefone: sess.temp.phone,
          setor: dept,
          criado_em: new Date().toLocaleString("pt-BR")
        };
        try {
          await postToSheet(newUser);
        } catch (err) {
          console.error("Erro SheetBest POST user:", err);
          sess.state = "WAIT_MATRICULA"; sess.temp = {};
          return res.json({ fulfillmentText: "⚠️ Não foi possível cadastrar agora. Tente novamente mais tarde." });
        }
        sess.usuario = newUser; sess.matricula = newUser.matricula; sess.temp = {}; sess.state = "IDLE";
        return res.json({ fulfillmentText: `✅ Cadastro criado! Bem-vindo(a), ${newUser.nome}.\n\n${mainMenu(newUser)}` });
      }

      case "IDLE": {
        // Detecta intenção de menu somente aqui
        const opt = detectMenuIntent(text, params, sess.state);
        if (!opt) {
          return res.json({ fulfillmentText: "Por favor escolha uma opção do menu (1-4) ou digite 'menu' para ver o menu novamente." });
        }
        if (opt === "1") {
          sess.state = "AWAIT_TICKET_DESCRIPTION";
          return res.json({ fulfillmentText: "Certo — descreva brevemente o problema ou solicitação (ou escreva 'voltar' para retornar ao menu)." });
        }
        if (opt === "2") {
          // listar tickets
          try {
            const tickets = await listTickets(sess.matricula);
            if (!tickets || tickets.length === 0) return res.json({ fulfillmentText: "Você não possui chamados registrados. Deseja abrir um? Digite 1." });
            const listSummary = tickets.slice(-5).reverse().map(t => `• ${t.ticketId || "(sem id)"} — ${String(t.descricao||t.descrição||"").slice(0,60)} (${t.status || "N/A"})`).join("\n");
            return res.json({ fulfillmentText: `Seus últimos chamados:\n${listSummary}\n\n${mainMenu(sess.usuario)}` });
          } catch (err) {
            console.error("Erro listar tickets:", err);
            return res.json({ fulfillmentText: "⚠️ Não foi possível obter seus chamados no momento." });
          }
        }
        if (opt === "3") {
          sess.state = "AWAIT_ESCALATION_DESC";
          return res.json({ fulfillmentText: "Ok — descreva o motivo para passar ao atendente humano." });
        }
        if (opt === "4") {
          sessions.delete(sessionId);
          return res.json({ fulfillmentText: "👋 Atendimento encerrado. Até breve!" });
        }
        return res.json({ fulfillmentText: "Opção inválida. Digite 1,2,3 ou 4." });
      }

      case "AWAIT_TICKET_DESCRIPTION": {
        const desc = params.descricao || text || null;
        if (!desc) return res.json({ fulfillmentText: "Por favor descreva o problema para abrir o chamado (ou 'voltar' para menu)." });
        try {
          const ticketId = await createTicket(sess.usuario, desc);
          sess.state = "IDLE";
          return res.json({ fulfillmentText: `✅ Chamado criado (ID: ${ticketId}).\n${mainMenu(sess.usuario)}` });
        } catch (err) {
          console.error("Erro criar ticket:", err);
          sess.state = "IDLE";
          return res.json({ fulfillmentText: "⚠️ Erro ao criar chamado. Tente novamente mais tarde." });
        }
      }

      case "AWAIT_ESCALATION_DESC": {
        const desc = params.descricao || text || null;
        if (!desc) return res.json({ fulfillmentText: "Descreva sucintamente o motivo do atendimento humano (ou 'voltar')." });
        try {
          const ticketId = await createTicket(sess.usuario, `[ESCALA] ${desc}`);
          sess.state = "IDLE";
          return res.json({ fulfillmentText: `✅ Encaminhado ao atendimento humano (ID: ${ticketId}). Nossa equipe entrará em contato.\n\n${mainMenu(sess.usuario)}` });
        } catch (err) {
          console.error("Erro escalation:", err);
          sess.state = "IDLE";
          return res.json({ fulfillmentText: "⚠️ Não foi possível encaminhar. Tente novamente mais tarde." });
        }
      }

      default:
        sess.state = "WAIT_MATRICULA";
        return res.json({ fulfillmentText: "Estado inválido — por favor informe sua matrícula para começar." });
    }

  } catch (err) {
    console.error("ERRO WEBHOOK:", err);
    return res.json({ fulfillmentText: "⚠️ Erro no servidor. Tente novamente." });
  }
});

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Helpdesk webhook rodando na porta ${PORT}`));

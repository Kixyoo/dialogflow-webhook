/**
 * FerreroHelp - Webhook Helpdesk Profissional (Express + SheetBest)
 *
 * Recursos:
 * - Autenticação por matrícula (somente matrícula basta)
 * - Sessões em memória com TTL (evitam pedir matrícula a cada passo)
 * - Menu interativo (1=abrir chamado, 2=ver chamados, 3=falar com atendente, 4=sair)
 * - Multistep: ao abrir chamado, pede descrição e confirma criação com ticketId
 * - Registra chamados na planilha via SheetBest (mesma planilha)
 * - Busca chamados por matrícula (lista resumida)
 * - Robustez: validações, timeouts fetch, tratamento de erros e logs
 *
 * Observações:
 * - A planilha do SheetBest deve aceitar POSTs (pública ou configurada)
 * - Estrutura na planilha: não é necessário mudar, as colunas serão criadas automaticamente
 */

const express = require("express");
const fetch = require("node-fetch");
const { v4: uuidv4 } = require("uuid"); // para gerar ticketId único
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// ===== CONFIG =====
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutos de inatividade
const FETCH_TIMEOUT_MS = 8000; // timeout fetch
// ==================

// sessões em memória: Map<sessionId, { matricula, usuario, state, temp, lastAt }>
const sessions = new Map();

// utilitário: fetch com timeout
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

// limpa sessões expiradas periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions.entries()) {
    if (now - v.lastAt > SESSION_TTL_MS) sessions.delete(k);
  }
}, 60 * 1000);

// ====== Helpers SheetBest ======
async function getSheetData() {
  // retorno: array de objetos (ou throw)
  const resp = await fetchWithTimeout(SHEETBEST_URL);
  if (!resp.ok) throw new Error(`SheetBest GET status ${resp.status}`);
  const json = await resp.json();
  if (!Array.isArray(json)) throw new Error("Resposta SheetBest inesperada (não é array)");
  return json;
}

async function postToSheet(obj) {
  const resp = await fetchWithTimeout(SHEETBEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`SheetBest POST status ${resp.status} - ${text}`);
  }
  return true;
}

// procura usuário (case-insensitive trim)
async function findUserByMatricula(matricula) {
  const data = await getSheetData();
  return data.find(row => String(row.matricula || "").trim() === String(matricula).trim()) || null;
}

// cria um chamado na planilha (registra tipo "ticket")
async function createTicket(usuario, descricao) {
  const ticketId = `T-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  const payload = {
    tipo: "ticket",
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

// lista chamados por matrícula (procura registros com tipo=ticket e matricula)
async function listTicketsByMatricula(matricula) {
  const data = await getSheetData();
  // pegar apenas tickets: tipo==='ticket' (ou se não existir coluna, fallback: has ticketId)
  const tickets = data.filter(row => {
    const isTicket = (row.tipo && String(row.tipo).toLowerCase() === "ticket") || Boolean(row.ticketId);
    return isTicket && String(row.matricula || "").trim() === String(matricula).trim();
  });
  // ordenar por criado_em desc (se existir) - simples: retorna array
  return tickets;
}

// ====== Mensagens/menus ======
function mainMenu(usuario) {
  const name = usuario?.nome || "usuário";
  return `Olá ${name}! 👋\nEscolha uma opção:\n1️⃣ Abrir chamado\n2️⃣ Ver meus chamados\n3️⃣ Falar com um atendente\n4️⃣ Encerrar atendimento`;
}

function helpText() {
  return "Digite o número da opção (1, 2, 3 ou 4). Para voltar ao menu a qualquer momento, digite 'menu'.";
}

// ====== Parsing util ======
function extractSingleDigitOption(text) {
  if (!text) return null;
  const m = text.match(/(^|\D)([1-4])(\D|$)/);
  return m ? m[2] : null;
}

// ====== Webhook ======
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = body.session || ("sess:" + (req.ip || "anon"));
    const params = body.queryResult?.parameters || {};
    const text = String(body.queryResult?.queryText || "").trim();

    // atualizar/obter sessão
    let session = sessions.get(sessionId);
    if (!session) {
      session = { lastAt: Date.now(), state: "WAIT_MATRICULA", temp: {} };
      sessions.set(sessionId, session);
    } else {
      session.lastAt = Date.now();
    }

    // helper para responder JSON
    const reply = (fulfillmentText) => res.json({ fulfillmentText });

    // Allow user to ask for menu any time
    if (/^\s*menu\s*$/i.test(text)) {
      if (session.usuario) {
        session.state = "IDLE";
        return reply(mainMenu(session.usuario) + "\n\n" + helpText());
      } else {
        session.state = "WAIT_MATRICULA";
        return reply("Por favor informe sua matrícula para continuar.");
      }
    }

    // State machine
    switch (session.state) {
      case "WAIT_MATRICULA": {
        // accept param or free-text numeric matricula
        const matricula = params.matricula ? String(params.matricula).trim() : (text.match(/\d{3,}/)?.[0] || null);
        if (!matricula) return reply("Por favor, informe sua matrícula (somente números).");

        // lookup user
        let usuario;
        try {
          usuario = await findUserByMatricula(matricula);
        } catch (err) {
          console.error("Erro lendo planilha:", err);
          return reply("⚠️ Erro ao verificar matrícula. Tente novamente em alguns instantes.");
        }

        if (!usuario) {
          // matrícula não encontrada → convite para cadastro (opcional)
          session.temp.matricula = matricula;
          session.state = "AWAIT_REG_NAME";
          return reply("Matrícula não encontrada. Deseja cadastrar? Por favor informe seu nome completo.");
        }

        // autenticação bem-sucedida
        session.matricula = matricula;
        session.usuario = usuario;
        session.state = "IDLE";
        return reply(
          `✅ Matrícula confirmada! Bem-vindo(a), ${usuario.nome || "colaborador"} (${usuario.setor || "setor não informado"}).\n\n` +
          mainMenu(usuario) + "\n\n" + helpText()
        );
      }

      case "AWAIT_REG_NAME": {
        // user provided name to register
        const name = params.nome || text || null;
        if (!name) return reply("Por favor, informe seu nome completo para cadastro.");

        // we can request email/phone/department (ask sequentially)
        session.temp.name = name;
        session.state = "AWAIT_REG_EMAIL";
        return reply("Obrigado. Agora informe seu email.");
      }

      case "AWAIT_REG_EMAIL": {
        const email = params.email || text || null;
        if (!email) return reply("Por favor, informe um email válido.");

        session.temp.email = email;
        session.state = "AWAIT_REG_PHONE";
        return reply("Ótimo. Informe agora seu telefone (com DDD).");
      }

      case "AWAIT_REG_PHONE": {
        const phone = params.telefone || text || null;
        if (!phone) return reply("Por favor, informe um telefone válido.");

        session.temp.phone = phone;
        session.state = "AWAIT_REG_DEPT";
        return reply("Por fim, informe seu departamento/setor.");
      }

      case "AWAIT_REG_DEPT": {
        const dept = params.departamento || text || null;
        if (!dept) return reply("Por favor informe seu departamento.");

        // build user object and post to sheet as tipo:user
        const newUser = {
          tipo: "user",
          matricula: session.temp.matricula,
          nome: session.temp.name,
          email: session.temp.email,
          telefone: session.temp.phone,
          setor: dept,
          criado_em: new Date().toLocaleString("pt-BR"),
        };

        try {
          await postToSheet(newUser);
        } catch (err) {
          console.error("Erro ao gravar cadastro:", err);
          session.state = "WAIT_MATRICULA";
          session.temp = {};
          return reply("⚠️ Não foi possível cadastrar no momento. Tente novamente mais tarde.");
        }

        // mark session as authenticated
        session.usuario = newUser;
        session.matricula = newUser.matricula;
        session.state = "IDLE";
        session.temp = {};

        return reply(
          `✅ Cadastro realizado com sucesso! Bem-vindo(a), ${newUser.nome} (${newUser.setor}).\n\n` +
          mainMenu(newUser) + "\n\n" + helpText()
        );
      }

      case "IDLE": {
        // expect menu option (1-4) or text to choose; extract digit
        const option = extractSingleDigitOption(text) || (params.opcao ? String(params.opcao).trim() : null);
        if (!option) {
          // if user typed something else, give guidance
          return reply("Selecione uma opção do menu: digite 1, 2, 3 ou 4. Para ver o menu a qualquer momento, escreva 'menu'.");
        }

        if (option === "1") {
          // open ticket flow
          session.state = "AWAIT_TICKET_DESCRIPTION";
          return reply("Certo — descreva brevemente o problema ou solicitação que deseja abrir em chamado.");
        }

        if (option === "2") {
          // list tickets
          try {
            const tickets = await listTicketsByMatricula(session.matricula);
            if (!tickets || tickets.length === 0) {
              return reply("Você não possui chamados registrados. Deseja abrir um agora? Digite 1.");
            }
            // summarize (max 5)
            const summaries = tickets.slice(-5).reverse().map(t => {
              return `• ${t.ticketId || t.id || "(sem id)"} — ${String(t.descricao || t.descrição || t.title || "").slice(0,60)} (${t.status || t.situacao || "N/A"})`;
            }).join("\n");
            return reply(`Seus chamados (últimos):\n${summaries}\n\n${mainMenu(session.usuario)}`);
          } catch (err) {
            console.error("Erro list tickets:", err);
            return reply("⚠️ Erro ao obter seus chamados. Tente novamente mais tarde.");
          }
        }

        if (option === "3") {
          // escalate / handoff - create escalation ticket
          session.state = "AWAIT_ESCALATION_DESC";
          return reply("Você escolheu falar com um atendente. Por favor descreva o motivo para que possamos encaminhar.");
        }

        if (option === "4") {
          sessions.delete(sessionId);
          return reply("👋 Atendimento encerrado. Se precisar, volte quando quiser.");
        }

        return reply("Opção inválida. Digite 1, 2, 3 ou 4.");
      }

      case "AWAIT_TICKET_DESCRIPTION": {
        const desc = text || params.descricao || null;
        if (!desc) return reply("Por favor descreva o problema para abrir o chamado.");

        // create ticket
        try {
          const ticketId = await createTicket(session.usuario, desc);
          session.state = "IDLE";
          return reply(`✅ Chamado criado com sucesso (ID: ${ticketId}).\nNossa equipe irá analisar e retornar.\n\n${mainMenu(session.usuario)}`);
        } catch (err) {
          console.error("Erro criando chamado:", err);
          session.state = "IDLE";
          return reply("⚠️ Erro ao criar chamado. Tente novamente mais tarde.");
        }
      }

      case "AWAIT_ESCALATION_DESC": {
        const desc = text || params.descricao || null;
        if (!desc) return reply("Por favor descreva brevemente o motivo do contato com o atendente.");

        // create escalation ticket
        try {
          const ticketId = await createTicket(session.usuario, `[ESCALA] ${desc}`);
          session.state = "IDLE";
          return reply(`✅ Encaminhei seu pedido ao atendimento humano (ID: ${ticketId}).\nAguarde contato.\n\n${mainMenu(session.usuario)}`);
        } catch (err) {
          console.error("Erro criando escalation:", err);
          session.state = "IDLE";
          return reply("⚠️ Erro ao encaminhar. Tente novamente mais tarde.");
        }
      }

      default:
        session.state = "WAIT_MATRICULA";
        return reply("Estado desconhecido. Por favor, informe sua matrícula para começar.");
    }
  } catch (err) {
    console.error("Webhook erro fatal:", err);
    return res.json({ fulfillmentText: "⚠️ Erro no servidor. Tente novamente." });
  }
});

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ FerreroHelp webhook rodando na porta ${PORT}`));

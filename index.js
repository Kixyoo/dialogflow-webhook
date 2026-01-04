"use strict";

const express = require("express");

const app = express();
app.use(express.json({ limit: "1mb" }));

/* =========================
 * CONFIG (ENV)
 * ========================= */
const PORT = Number(process.env.PORT || 3000);

// Sheetbest endpoints
// 1) Obrigatório: onde salvar os tickets/atendimentos/orçamentos
const TICKETS_URL = process.env.TICKETS_URL || "";

// 2) Opcional: onde consultar pedidos (para status do pedido)
const PEDIDOS_URL = process.env.PEDIDOS_URL || "";

// Segurança opcional
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";

// Sessões e cache
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 45);
const PEDIDOS_CACHE_SECONDS = Number(process.env.PEDIDOS_CACHE_SECONDS || 45);

// Rate limit simples
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQ = Number(process.env.RATE_LIMIT_MAX_REQ || 80);

// Limites de texto
const MAX_TEXTO_USUARIO = Number(process.env.MAX_TEXTO_USUARIO || 700);

/* =========================
 * UTILS
 * ========================= */
function now() {
  return Date.now();
}

function textoSeguro(str) {
  const s = String(str || "").trim();
  if (!s) return "";
  return s.length > MAX_TEXTO_USUARIO ? s.slice(0, MAX_TEXTO_USUARIO) : s;
}

function norm(str) {
  return textoSeguro(str).toLowerCase();
}

function responder(res, texto) {
  return res.json({ fulfillmentText: texto });
}

function logInfo(...args) {
  console.log(new Date().toISOString(), "[INFO]", ...args);
}
function logWarn(...args) {
  console.warn(new Date().toISOString(), "[WARN]", ...args);
}
function logError(...args) {
  console.error(new Date().toISOString(), "[ERROR]", ...args);
}

function extrairNumeroPedido(texto) {
  // pega a primeira sequência de 3+ dígitos (ajuste se seu pedido tiver letras tipo P42-1234)
  const m = String(texto || "").match(/\d{3,}/);
  return m ? m[0] : "";
}

/* =========================
 * RATE LIMIT (por IP)
 * ========================= */
const rateBucket = new Map();

function rateLimit(req, res, next) {
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const t = now();
  const item = rateBucket.get(ip);

  if (!item || t > item.resetAt) {
    rateBucket.set(ip, { resetAt: t + RATE_LIMIT_WINDOW_MS, count: 1 });
    return next();
  }

  item.count += 1;
  if (item.count > RATE_LIMIT_MAX_REQ) {
    logWarn("Rate limit excedido:", ip);
    return responder(
      res,
      "⚠️ Muitas mensagens em pouco tempo. Aguarde um instante e tente novamente."
    );
  }

  return next();
}

app.use(rateLimit);

/* =========================
 * TOKEN GUARD (opcional)
 * ========================= */
function tokenGuard(req, res, next) {
  if (!WEBHOOK_TOKEN) return next();
  const token = String(req.headers["x-webhook-token"] || "");
  if (token !== WEBHOOK_TOKEN) {
    return res.status(401).json({ fulfillmentText: "⛔ Acesso não autorizado." });
  }
  return next();
}

/* =========================
 * MENUS (Portal 42)
 * ========================= */
function menuPrincipal() {
  return (
    `🪐 Portal 42 | Itens Personalizados\n\n` +
    `Como podemos te ajudar?\n\n` +
    `1️⃣ Fazer um orçamento (personalizados)\n` +
    `2️⃣ Consultar status do meu pedido\n` +
    `3️⃣ Enviar/ajustar arte do pedido\n` +
    `4️⃣ Trocas e prazos\n` +
    `5️⃣ Falar com atendente\n` +
    `0️⃣ Encerrar\n\n` +
    `Digite o número da opção ou "menu" a qualquer momento.`
  );
}

function menuTrocasEPrazos() {
  return (
    `📦 Trocas e prazos\n\n` +
    `1️⃣ Prazo de produção e envio\n` +
    `2️⃣ Política de troca (personalizados)\n` +
    `3️⃣ Voltar ao menu\n\n` +
    `Digite 1, 2 ou 3 (ou "menu").`
  );
}

/* =========================
 * SESSÕES
 * ========================= */
const sessoes = new Map(); // sessionId -> { etapa, dados, ultimaAtividadeEm }

function getSessao(sessionId) {
  return sessoes.get(sessionId) || null;
}

function setSessao(sessionId, sessao) {
  sessoes.set(sessionId, sessao);
}

function tocarSessao(sessionId) {
  const s = sessoes.get(sessionId);
  if (s) s.ultimaAtividadeEm = now();
}

function limparSessoesExpiradas() {
  const ttlMs = SESSION_TTL_MINUTES * 60 * 1000;
  const t = now();
  for (const [id, s] of sessoes.entries()) {
    const ultima = Number(s.ultimaAtividadeEm || 0);
    if (!ultima || t - ultima > ttlMs) {
      sessoes.delete(id);
    }
  }
}

setInterval(limparSessoesExpiradas, 60 * 1000).unref();

/* =========================
 * SHEETBEST: tickets e pedidos
 * ========================= */
async function salvarTicket(ticket) {
  if (!TICKETS_URL) return false;

  try {
    const resp = await fetch(TICKETS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ticket),
    });

    if (!resp.ok) {
      logWarn("Falha ao salvar ticket:", resp.status);
      return false;
    }
    return true;
  } catch (e) {
    logError("Erro ao salvar ticket:", e);
    return false;
  }
}

// Cache simples dos pedidos (para não bater no Sheetbest a cada msg)
let pedidosCache = { em: 0, dados: null };

async function carregarPedidos() {
  if (!PEDIDOS_URL) return null;

  const t = now();
  const cacheOk =
    pedidosCache.dados && t - pedidosCache.em < PEDIDOS_CACHE_SECONDS * 1000;

  if (cacheOk) return pedidosCache.dados;

  const resp = await fetch(PEDIDOS_URL);
  if (!resp.ok) throw new Error(`PEDIDOS_URL HTTP ${resp.status}`);

  const dados = await resp.json();
  pedidosCache = { em: t, dados };
  return dados;
}

function acharPedidoPorNumero(dados, numeroPedido) {
  const alvo = String(numeroPedido || "").trim();
  if (!alvo) return null;

  return (
    (dados || []).find((row) => {
      const keys = Object.keys(row || {});
      const keyPedido = keys.find((k) =>
        k.toLowerCase().includes("pedido")
      );
      const val = keyPedido ? String(row[keyPedido] || "").trim() : "";
      return val === alvo;
    }) || null
  );
}

/* =========================
 * HEALTH
 * ========================= */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "Portal42-Atendimento",
    time: new Date().toISOString(),
    sessions: sessoes.size,
    ticketsUrl: Boolean(TICKETS_URL),
    pedidosUrl: Boolean(PEDIDOS_URL),
  });
});

/* =========================
 * WEBHOOK
 * ========================= */
app.post("/webhook", tokenGuard, async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = String(body.session || "default").trim();

    const queryResult = body.queryResult || {};
    const mensagemOriginal = textoSeguro(queryResult.queryText || "");
    const mensagem = norm(mensagemOriginal);

    // comandos universais
    if (mensagem === "menu") {
      const s = getSessao(sessionId) || { etapa: "menu", dados: {}, ultimaAtividadeEm: now() };
      s.etapa = "menu";
      setSessao(sessionId, s);
      return responder(res, menuPrincipal());
    }
    if (mensagem === "0" || mensagem === "sair" || mensagem === "encerrar") {
      sessoes.delete(sessionId);
      return responder(res, "👋 Atendimento encerrado. Até já!");
    }

    // garante sessão
    if (!getSessao(sessionId)) {
      setSessao(sessionId, { etapa: "menu", dados: {}, ultimaAtividadeEm: now() });
    }
    tocarSessao(sessionId);

    const sessao = getSessao(sessionId);

    switch (sessao.etapa) {
      /* -----------------
       * MENU
       * ----------------- */
      case "menu": {
        if (mensagem === "1") {
          sessao.etapa = "orcamento_produto";
          sessao.dados = { tipo: "orcamento" };
          return responder(
            res,
            "🧾 Orçamento de personalizados!\nQual item você deseja?\nEx: caneca, camiseta, chaveiro, adesivo, placa, etc."
          );
        }
        if (mensagem === "2") {
          sessao.etapa = "status_pedido";
          sessao.dados = { tipo: "status" };
          return responder(res, "📦 Me diga o número do seu pedido (apenas números).");
        }
        if (mensagem === "3") {
          sessao.etapa = "enviar_arte";
          sessao.dados = { tipo: "arte" };
          return responder(
            res,
            "🎨 Perfeito. Envie o número do pedido e descreva o ajuste.\nSe tiver link da arte (Drive/WeTransfer), cole aqui."
          );
        }
        if (mensagem === "4") {
          sessao.etapa = "trocas_menu";
          return responder(res, menuTrocasEPrazos());
        }
        if (mensagem === "5") {
          sessao.etapa = "atendente_motivo";
          sessao.dados = { tipo: "humano" };
          return responder(res, "👩‍💻 Claro. Me conte rapidamente o motivo para falar com um atendente.");
        }

        return responder(res, "⚠️ Opção inválida. Digite 1, 2, 3, 4, 5 ou 0.");
      }

      /* -----------------
       * ORÇAMENTO
       * ----------------- */
      case "orcamento_produto": {
        sessao.dados.produto = mensagemOriginal;
        sessao.etapa = "orcamento_quantidade";
        return responder(res, `Beleza! Quantas unidades de "${mensagemOriginal}" você precisa?`);
      }

      case "orcamento_quantidade": {
        sessao.dados.quantidade = mensagemOriginal;
        sessao.etapa = "orcamento_prazo";
        return responder(res, "Qual o prazo desejado? (ex: até sexta, 10 dias, data específica)");
      }

      case "orcamento_prazo": {
        sessao.dados.prazo = mensagemOriginal;
        sessao.etapa = "orcamento_arte";
        return responder(
          res,
          "Você já tem a arte pronta?\nResponda com:\n- 'tenho' + link/descrição\nou\n- 'não tenho' + ideia do que quer (texto/tema/cores)."
        );
      }

      case "orcamento_arte": {
        sessao.dados.arte = mensagemOriginal;
        sessao.etapa = "orcamento_contato";
        return responder(
          res,
          "Para finalizar, me informe um contato (WhatsApp ou e-mail) para retornarmos com o orçamento."
        );
      }

      case "orcamento_contato": {
        sessao.dados.contato = mensagemOriginal;

        const ticket = {
          tipo: "orcamento",
          produto: sessao.dados.produto || "",
          quantidade: sessao.dados.quantidade || "",
          prazo: sessao.dados.prazo || "",
          arte: sessao.dados.arte || "",
          contato: sessao.dados.contato || "",
          origem: "webhook",
          criado_em: new Date().toISOString(),
          status: "aberto",
        };

        const salvou = await salvarTicket(ticket);

        sessao.etapa = "menu";
        sessao.dados = {};

        return responder(
          res,
          salvou
            ? "✅ Orçamento registrado! Nossa equipe vai retornar no contato informado.\n\n" + menuPrincipal()
            : "⚠️ Recebi seu pedido de orçamento, mas não consegui salvar no sistema agora.\nTente novamente ou fale com um atendente.\n\n" + menuPrincipal()
        );
      }

      /* -----------------
       * STATUS DO PEDIDO
       * ----------------- */
      case "status_pedido": {
        const numero = extrairNumeroPedido(mensagemOriginal) || mensagemOriginal.trim();
        if (!numero) {
          return responder(res, "📦 Não consegui identificar o número do pedido. Envie somente números, por favor.");
        }

        // Se não tiver PEDIDOS_URL, registra ticket e orienta retorno humano
        if (!PEDIDOS_URL) {
          const ticket = {
            tipo: "status_pedido",
            numero_pedido: numero,
            mensagem: "Cliente solicitou status do pedido",
            criado_em: new Date().toISOString(),
            status: "aberto",
          };
          const salvou = await salvarTicket(ticket);

          sessao.etapa = "menu";
          sessao.dados = {};
          return responder(
            res,
            salvou
              ? `✅ Pedido ${numero} registrado para consulta. Vamos te retornar com o status.\n\n${menuPrincipal()}`
              : `⚠️ Anotei o pedido ${numero}, mas não consegui salvar no sistema agora.\n\n${menuPrincipal()}`
          );
        }

        // Se tiver PEDIDOS_URL, tenta achar e responder
        let dadosPedidos = null;
        try {
          dadosPedidos = await carregarPedidos();
        } catch (e) {
          logError("Erro ao carregar pedidos:", e);
        }

        const pedido = acharPedidoPorNumero(dadosPedidos, numero);

        // Se achou, tenta montar uma resposta com campos comuns
        if (pedido) {
          const statusKey = Object.keys(pedido).find((k) => k.toLowerCase().includes("status"));
          const previsaoKey = Object.keys(pedido).find((k) =>
            k.toLowerCase().includes("previs") || k.toLowerCase().includes("envio")
          );

          const status = statusKey ? String(pedido[statusKey] || "").trim() : "em andamento";
          const previsao = previsaoKey ? String(pedido[previsaoKey] || "").trim() : "";

          sessao.etapa = "menu";
          sessao.dados = {};

          return responder(
            res,
            `📦 Pedido ${numero}\nStatus: ${status}${previsao ? `\nPrevisão: ${previsao}` : ""}\n\n${menuPrincipal()}`
          );
        }

        // Se não achou, registra ticket
        const ticket = {
          tipo: "status_pedido",
          numero_pedido: numero,
          mensagem: "Pedido não encontrado automaticamente. Necessita checagem manual.",
          criado_em: new Date().toISOString(),
          status: "aberto",
        };
        const salvou = await salvarTicket(ticket);

        sessao.etapa = "menu";
        sessao.dados = {};

        return responder(
          res,
          salvou
            ? `🔎 Não encontrei o pedido ${numero} automaticamente. Vou encaminhar para conferência manual e retornamos.\n\n${menuPrincipal()}`
            : `🔎 Não encontrei o pedido ${numero} e não consegui salvar no sistema agora.\nTente novamente ou fale com um atendente.\n\n${menuPrincipal()}`
        );
      }

      /* -----------------
       * ENVIAR/AJUSTAR ARTE
       * ----------------- */
      case "enviar_arte": {
        const numero = extrairNumeroPedido(mensagemOriginal);
        const ticket = {
          tipo: "arte_pedido",
          numero_pedido: numero || "",
          descricao: mensagemOriginal,
          criado_em: new Date().toISOString(),
          status: "aberto",
        };

        const salvou = await salvarTicket(ticket);

        sessao.etapa = "menu";
        sessao.dados = {};

        return responder(
          res,
          salvou
            ? "✅ Solicitação de arte registrada! Se tiver link/arquivo, envie aqui também (ou repita o link).\n\n" + menuPrincipal()
            : "⚠️ Recebi sua solicitação, mas não consegui salvar no sistema agora.\n\n" + menuPrincipal()
        );
      }

      /* -----------------
       * TROCAS / PRAZOS
       * ----------------- */
      case "trocas_menu": {
        if (mensagem === "1") {
          return responder(
            res,
            "⏱️ Prazo de produção varia conforme item e quantidade.\nGeralmente:\n• Produção: 2 a 7 dias úteis\n• Envio: conforme transportadora\n\nPara um prazo exato, peça um orçamento (opção 1) 😉\n\nDigite 'menu' para voltar."
          );
        }
        if (mensagem === "2") {
          return responder(
            res,
            "🔁 Trocas em itens personalizados:\nComo o produto é feito sob medida, trocas por arrependimento geralmente não se aplicam.\nSe houver defeito de fabricação, a gente resolve rapidinho.\n\nSe quiser abrir um atendimento, escolha '5' no menu.\n\nDigite 'menu' para voltar."
          );
        }
        if (mensagem === "3") {
          sessao.etapa = "menu";
          return responder(res, menuPrincipal());
        }
        return responder(res, "⚠️ Opção inválida. Digite 1, 2 ou 3 (ou 'menu').");
      }

      /* -----------------
       * HUMANO
       * ----------------- */
      case "atendente_motivo": {
        const ticket = {
          tipo: "atendimento_humano",
          motivo: mensagemOriginal || "(sem mensagem)",
          criado_em: new Date().toISOString(),
          status: "aberto",
        };

        const salvou = await salvarTicket(ticket);

        sessao.etapa = "menu";
        sessao.dados = {};

        return responder(
          res,
          salvou
            ? "✅ Encaminhei para um atendente. Se puder, deixe um contato (WhatsApp/e-mail) para retorno.\n\n" + menuPrincipal()
            : "⚠️ Não consegui registrar no sistema agora. Tente novamente em instantes.\n\n" + menuPrincipal()
        );
      }

      default: {
        sessao.etapa = "menu";
        sessao.dados = {};
        return responder(res, menuPrincipal());
      }
    }
  } catch (e) {
    logError("Erro no webhook:", e);
    return responder(res, "⚠️ Ocorreu um erro no atendimento. Tente novamente mais tarde.");
  }
});

/* =========================
 * START
 * ========================= */
app.listen(PORT, () => {
  logInfo(`Portal 42 atendimento rodando na porta ${PORT}`);
  logInfo(`TICKETS_URL: ${TICKETS_URL ? "OK" : "NÃO CONFIGURADO (obrigatório p/ salvar tickets)"}`);
  logInfo(`PEDIDOS_URL: ${PEDIDOS_URL ? "OK" : "NÃO CONFIGURADO (status automático desativado)"}`);
});

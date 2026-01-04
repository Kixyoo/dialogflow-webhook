
/**
 * FerreroHelp - Webhook (Dialogflow/Chatbot)
 * Node 18+ (usa fetch nativo)
 *
 * Recursos:
 * - Autenticação por matrícula via Sheetbest
 * - Controle de etapas (máquina de estados)
 * - Sessão em memória com TTL (expiração automática)
 * - Cache da planilha (reduz chamadas ao Sheetbest)
 * - Rate limit simples (por IP) pra evitar abuso/loops
 * - Endpoint /health para monitoramento
 * - Suporte opcional a um "token" de segurança (WEBHOOK_TOKEN)
 */

"use strict";

const express = require("express");

const app = express();
app.use(express.json({ limit: "1mb" }));

/* =========================
 * Configurações (ENV)
 * ========================= */
const PORT = Number(process.env.PORT || 3000);

// URL da planilha (Sheetbest) com dados de usuários (precisa conter "matricula" e "nome")
const SHEETBEST_URL =
  process.env.SHEETBEST_URL ||
  "https://api.sheetbest.com/sheets/863400ea-66a1-4855-8dcf-76d81ffd1285";

// (Opcional) URL Sheetbest para registrar chamados (se quiser persistir fora da sessão)
// Exemplo: https://api.sheetbest.com/sheets/<UUID-CHAMADOS>
const CHAMADOS_URL = process.env.CHAMADOS_URL || "";

// TTL da sessão (minutos) e cache da planilha (segundos)
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 30);
const SHEET_CACHE_SECONDS = Number(process.env.SHEET_CACHE_SECONDS || 60);

// (Opcional) Token simples para proteger o webhook (mande no header: x-webhook-token)
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";

// Segurança e qualidade
const MAX_TEXTO_USUARIO = Number(process.env.MAX_TEXTO_USUARIO || 500);

// Rate limit simples
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX_REQ = Number(process.env.RATE_LIMIT_MAX_REQ || 60);

/* =========================
 * Utilidades
 * ========================= */
function now() {
  return Date.now();
}

function textoSeguro(str) {
  const s = String(str || "").trim();
  if (!s) return "";
  // corta mensagens gigantes para evitar abuso
  return s.length > MAX_TEXTO_USUARIO ? s.slice(0, MAX_TEXTO_USUARIO) : s;
}

function normalizar(str) {
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

/* =========================
 * Rate limit simples (por IP)
 * ========================= */
const rateBucket = new Map(); // ip -> { resetAt, count }

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
    logWarn("Rate limit excedido para IP:", ip);
    return responder(
      res,
      "⚠️ Muitas mensagens em pouco tempo. Aguarde um instante e tente novamente."
    );
  }

  return next();
}

app.use(rateLimit);

/* =========================
 * Segurança opcional por token
 * ========================= */
function tokenGuard(req, res, next) {
  if (!WEBHOOK_TOKEN) return next();
  const token = String(req.headers["x-webhook-token"] || "");
  if (token !== WEBHOOK_TOKEN) {
    logWarn("Acesso negado: token inválido");
    return res.status(401).json({ fulfillmentText: "⛔ Acesso não autorizado." });
  }
  return next();
}

/* =========================
 * Menus
 * ========================= */
function gerarMenuPrincipal(nome) {
  const n = nome || "usuário";
  return (
    `Olá, ${n}!\n\n` +
    `Selecione o que deseja fazer:\n\n` +
    `1️⃣ Abrir chamado\n` +
    `2️⃣ Consultar chamados\n` +
    `3️⃣ Falar com atendente\n` +
    `4️⃣ Configurações\n` +
    `0️⃣ Encerrar atendimento\n\n` +
    `(Digite o número da opção ou "menu" a qualquer momento.)`
  );
}

function gerarMenuConfiguracoes() {
  return (
    `⚙️ Configurações:\n\n` +
    `1️⃣ Atualizar meus dados\n` +
    `2️⃣ Voltar ao menu principal\n\n` +
    `(Digite o número da opção ou "menu" para voltar.)`
  );
}

/* =========================
 * Sessões (memória) com TTL
 * ========================= */
const usuarios = new Map(); // userId -> { ...dadosUsuario, etapa, chamados[], ultimaAtividadeEm }

function tocarSessao(userId) {
  const u = usuarios.get(userId);
  if (u) u.ultimaAtividadeEm = now();
}

function criarSessao(userId, usuarioPlanilha) {
  usuarios.set(userId, {
    ...usuarioPlanilha,
    etapa: "menu",
    chamados: [],
    ultimaAtividadeEm: now(),
  });
}

function limparSessoesExpiradas() {
  const t = now();
  const ttlMs = SESSION_TTL_MINUTES * 60 * 1000;

  for (const [id, u] of usuarios.entries()) {
    const ultima = Number(u.ultimaAtividadeEm || 0);
    if (!ultima || t - ultima > ttlMs) {
      usuarios.delete(id);
    }
  }
}

setInterval(limparSessoesExpiradas, 60 * 1000).unref();

/* =========================
 * Cache da planilha
 * ========================= */
let sheetCache = { em: 0, dados: null };

async function carregarPlanilha() {
  const t = now();
  const cacheOk =
    sheetCache.dados && t - sheetCache.em < SHEET_CACHE_SECONDS * 1000;

  if (cacheOk) return sheetCache.dados;

  const resp = await fetch(SHEETBEST_URL);
  if (!resp.ok) {
    throw new Error(`Sheetbest HTTP ${resp.status}`);
  }

  const dados = await resp.json();
  sheetCache = { em: t, dados };
  return dados;
}

async function buscarUsuarioPorMatricula(matricula) {
  try {
    const m = String(matricula || "").trim();
    if (!m) return null;

    const dados = await carregarPlanilha();
    return (
      dados.find((row) => String(row.matricula || "").trim() === m) || null
    );
  } catch (e) {
    logError("Erro ao buscar usuário:", e);
    return null;
  }
}

/* =========================
 * Persistência opcional do chamado (Sheetbest)
 * ========================= */
async function registrarChamadoPersistente({ matricula, nome, descricao }) {
  if (!CHAMADOS_URL) return false; // não configurado

  try {
    const payload = {
      matricula: String(matricula || "").trim(),
      nome: String(nome || "").trim(),
      descricao: textoSeguro(descricao),
      criado_em: new Date().toISOString(),
      status: "aberto",
    };

    const resp = await fetch(CHAMADOS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      logWarn("Falha ao registrar chamado no Sheetbest:", resp.status);
      return false;
    }

    return true;
  } catch (e) {
    logError("Erro ao registrar chamado persistente:", e);
    return false;
  }
}

/* =========================
 * Healthcheck
 * ========================= */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "FerreroHelp",
    time: new Date().toISOString(),
    sessions: usuarios.size,
    cacheAgeSeconds: sheetCache.em ? Math.floor((now() - sheetCache.em) / 1000) : null,
  });
});

/* =========================
 * Webhook principal
 * ========================= */
app.post("/webhook", tokenGuard, async (req, res) => {
  try {
    const body = req.body || {};

    // Dialogflow costuma mandar session como string grande
    const userId = String(body.session || "default").trim();

    const queryResult = body.queryResult || {};
    const parametros = queryResult.parameters || {};

    const mensagemOriginal = textoSeguro(queryResult.queryText || "");
    const mensagemNorm = normalizar(mensagemOriginal);

    // Matrícula vem via parameters (Dialogflow)
    const matriculaParam = parametros.matricula
      ? String(parametros.matricula).trim()
      : "";

    // Comandos universais
    const querMenu = mensagemNorm === "menu";
    const querSair =
      mensagemNorm === "0" ||
      mensagemNorm === "sair" ||
      mensagemNorm === "encerrar" ||
      mensagemNorm === "finalizar";

    // Usuário ainda não autenticado
    if (!usuarios.has(userId)) {
      if (querSair) {
        return responder(res, "👋 Atendimento encerrado. Até mais!");
      }

      if (!matriculaParam) {
        return responder(res, "👋 Por favor, informe sua matrícula para continuar.");
      }

      const usuarioPlanilha = await buscarUsuarioPorMatricula(matriculaParam);
      if (!usuarioPlanilha) {
        return responder(
          res,
          "❌ Matrícula não encontrada. Verifique e tente novamente."
        );
      }

      criarSessao(userId, usuarioPlanilha);
      const nome = usuarioPlanilha.nome || "usuário";
      logInfo("Login OK:", { userId, matricula: matriculaParam });

      return responder(res, `✅ Matrícula confirmada!\n${gerarMenuPrincipal(nome)}`);
    }

    // Sessão existe
    tocarSessao(userId);

    const usuario = usuarios.get(userId);
    const nome = usuario.nome || "usuário";

    if (querMenu) {
      usuario.etapa = "menu";
      return responder(res, gerarMenuPrincipal(nome));
    }

    if (querSair) {
      usuarios.delete(userId);
      return responder(res, `👋 Atendimento encerrado. Até mais, ${nome}!`);
    }

    // Controle por etapas
    switch (usuario.etapa) {
      case "menu": {
        if (mensagemNorm === "1") {
          usuario.etapa = "abrir_chamado";
          return responder(res, "📝 Descreva o problema que deseja reportar.");
        }

        if (mensagemNorm === "2") {
          usuario.etapa = "consultar_chamados";
          const qtd = usuario.chamados.length;

          return responder(
            res,
            qtd > 0
              ? `🔎 Você possui ${qtd} chamado(s) registrado(s) nesta sessão.\nÚltimo: "${usuario.chamados[qtd - 1]}".\n\n(Digite "menu" para voltar.)`
              : `📭 Você não possui chamados nesta sessão.\n\n(Digite "menu" para voltar.)`
          );
        }

        if (mensagemNorm === "3") {
          usuario.etapa = "falar_atendente";
          return responder(
            res,
            "👩‍💻 Tudo bem. Descreva o motivo para falar com um atendente humano."
          );
        }

        if (mensagemNorm === "4") {
          usuario.etapa = "config";
          return responder(res, gerarMenuConfiguracoes());
        }

        return responder(res, "⚠️ Opção inválida. Digite 1, 2, 3, 4 ou 0.");
      }

      case "abrir_chamado": {
        const descricao = mensagemOriginal;
        if (!descricao) {
          return responder(res, "📝 Descreva o problema para abrir o chamado.");
        }

        // Guarda na sessão
        usuario.chamados.push(descricao);

        // (Opcional) registra persistente no Sheetbest, se CHAMADOS_URL estiver configurado
        const persistiu = await registrarChamadoPersistente({
          matricula: usuario.matricula,
          nome,
          descricao,
        });

        usuario.etapa = "menu";

        const extra = CHAMADOS_URL
          ? persistiu
            ? "\n📌 Registro salvo no sistema."
            : "\n⚠️ Não foi possível salvar no sistema agora, mas mantive nesta sessão."
          : "";

        return responder(
          res,
          `✅ Chamado aberto com sucesso!\nResumo: "${descricao}".${extra}\n\nDigite "menu" para voltar às opções.`
        );
      }

      case "consultar_chamados": {
        // Mantém essa etapa “passiva”: o usuário pode ler e voltar com menu
        // Se quiser, dá pra aceitar "menu" (já aceitamos) ou "1" para abrir chamado direto
        if (mensagemNorm === "1") {
          usuario.etapa = "abrir_chamado";
          return responder(res, "📝 Descreva o problema que deseja reportar.");
        }

        return responder(
          res,
          `ℹ️ Para voltar ao menu principal, digite "menu".\nSe quiser abrir um novo chamado, digite "1".`
        );
      }

      case "falar_atendente": {
        const motivo = mensagemOriginal || "(sem mensagem)";
        usuario.etapa = "menu";

        // Aqui normalmente você integraria com um sistema humano (Zendesk, Freshdesk, WhatsApp handoff etc.)
        return responder(
          res,
          `🤝 Solicitação encaminhada ao atendimento humano.\nMensagem: "${motivo}"\n\nDigite "menu" para voltar às opções.`
        );
      }

      case "config": {
        if (mensagemNorm === "1") {
          usuario.etapa = "atualizar_dados";
          return responder(
            res,
            "✏️ Informe os novos dados que deseja atualizar (ex: telefone, e-mail)."
          );
        }

        if (mensagemNorm === "2") {
          usuario.etapa = "menu";
          return responder(res, gerarMenuPrincipal(nome));
        }

        return responder(res, "⚠️ Opção inválida. Digite 1 ou 2.");
      }

      case "atualizar_dados": {
        const novosDados = mensagemOriginal;
        if (!novosDados) {
          return responder(res, "✏️ Digite os dados que deseja atualizar.");
        }

        // Atenção: aqui está “registrando recebimento”.
        // Para atualizar de verdade na planilha, você precisaria saber a linha/ID no Sheetbest e enviar PUT/PATCH.
        usuario.etapa = "menu";

        return responder(
          res,
          `✅ Dados recebidos com sucesso!\nNovo valor: "${novosDados}".\n\nDigite "menu" para voltar às opções.`
        );
      }

      default: {
        usuario.etapa = "menu";
        return responder(res, gerarMenuPrincipal(nome));
      }
    }
  } catch (erro) {
    logError("Erro no webhook:", erro);
    return responder(
      res,
      "⚠️ Ocorreu um erro no atendimento. Tente novamente mais tarde."
    );
  }
});

/* =========================
 * Start
 * ========================= */
app.listen(PORT, () => {
  logInfo(`Servidor FerreroHelp rodando na porta ${PORT}`);
  logInfo(`SHEETBEST_URL: ${SHEETBEST_URL ? "OK" : "NÃO CONFIGURADO"}`);
  logInfo(`CHAMADOS_URL: ${CHAMADOS_URL ? "OK" : "NÃO CONFIGURADO"}`);
});


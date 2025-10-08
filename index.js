const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

// ✅ Endpoint da planilha no SheetBest
const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// ✅ Sessões em memória (para controle de fluxo)
const sessoes = new Map();

// 🔹 Função utilitária para buscar usuário pela matrícula
async function buscarUsuarioPorMatricula(matricula) {
  try {
    const resposta = await fetch(SHEETBEST_URL);
    if (!resposta.ok) throw new Error(`Erro HTTP ${resposta.status}`);
    const dados = await resposta.json();
    return dados.find(u => String(u.matricula).trim() === String(matricula).trim());
  } catch (erro) {
    console.error("Erro ao buscar usuário:", erro);
    return null;
  }
}

// 🔹 Função de formatação de mensagens estilo Riot
function mensagemRiot(titulo, corpo) {
  return `🎮 **${titulo.toUpperCase()}**\n───────────────────────\n${corpo}`;
}

// 🔹 Rota principal (Dialogflow Webhook)
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    const sessionId = body.session || "anon";
    const parametros = body.queryResult?.parameters || {};
    const mensagem = body.queryResult?.queryText?.trim() || "";
    const matricula = parametros.matricula ? String(parametros.matricula).trim() : null;

    // 🧭 Etapa 1 — Autenticação
    if (!sessoes.has(sessionId)) {
      if (!matricula) {
        return res.json({
          fulfillmentText: mensagemRiot(
            "Bem-vindo ao Ferrero HelpDesk",
            "🛡️ Antes de começarmos, preciso da sua **matrícula** para validar o acesso ao sistema."
          ),
        });
      }

      const usuario = await buscarUsuarioPorMatricula(matricula);
      if (!usuario) {
        return res.json({
          fulfillmentText: mensagemRiot(
            "Acesso negado",
            "❌ Matrícula não encontrada. Verifique os dados e tente novamente."
          ),
        });
      }

      // Autenticado com sucesso
      sessoes.set(sessionId, { ...usuario, etapa: "menu" });

      return res.json({
        fulfillmentText: mensagemRiot(
          "Acesso confirmado",
          `✅ Bem-vindo(a), **${usuario.nome || "usuário"}**!\n` 
            `Selecione uma opção:\n` +
            `1️⃣ Abrir chamado\n` +
            `2️⃣ Consultar status\n` +
            `3️⃣ Falar com atendente\n` +
            `4️⃣ Encerrar atendimento`
        ),
      });
    }

    // 🧭 Etapa 2 — Usuário autenticado
    const usuario = sessoes.get(sessionId);
    const nome = usuario.nome || "usuário";

    // 🔍 Detecta opção escolhida
    const opcao = mensagem.match(/^[1-4]/)?.[0];

    if (!opcao) {
      return res.json({
        fulfillmentText: mensagemRiot(
          "Opção inválida",
          "⚠️ Digite apenas o número da opção desejada (1 a 4)."
        ),
      });
    }

    // 🔹 Etapas do menu
    switch (opcao) {
      case "1":
        usuario.etapa = "abrir_chamado";
        sessoes.set(sessionId, usuario);
        return res.json({
          fulfillmentText: mensagemRiot(
            "Abertura de chamado",
            `📝 Certo, ${nome}. Me conte brevemente o problema que deseja reportar.`
          ),
        });

      case "2":
        return res.json({
          fulfillmentText: mensagemRiot(
            "Status do chamado",
            `🔎 ${nome}, seu último chamado está **em análise pela equipe técnica**.\n` +
              `Você receberá uma notificação assim que houver atualização.`
          ),
        });

      case "3":
        return res.json({
          fulfillmentText: mensagemRiot(
            "Atendente humano",
            `💬 ${nome}, estou conectando você com um especialista...\n` +
              `Por favor, aguarde alguns instantes.`
          ),
        });

      case "4":
        sessoes.delete(sessionId);
        return res.json({
          fulfillmentText: mensagemRiot(
            "Sessão encerrada",
            `👋 Atendimento finalizado. Até mais, ${nome}!\n` +
              `Ferrero HelpDesk — *“A eficiência é o primeiro passo da excelência.”*`
          ),
        });

      default:
        return res.json({
          fulfillmentText: mensagemRiot(
            "Opção inválida",
            "⚠️ Digite um número entre 1 e 4."
          ),
        });
    }
  } catch (erro) {
    console.error("Erro no webhook:", erro);
    return res.json({
      fulfillmentText: mensagemRiot(
        "Erro interno",
        "⚠️ Ocorreu uma falha no servidor. Nossa equipe já foi notificada."
      ),
    });
  }
});

// 🚀 Inicialização
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🟢 Ferrero HelpDesk rodando na porta ${PORT}`);
});


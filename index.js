const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// 🔹 Sessões de usuários autenticados
const usuarios = new Map();

// 🔹 Função para buscar usuário pela matrícula
async function buscarUsuario(matricula) {
  try {
    const resp = await fetch(SHEETBEST_URL);
    const dados = await resp.json();
    return dados.find(row => String(row.matricula).trim() === matricula);
  } catch (erro) {
    console.error("Erro ao buscar usuário:", erro);
    return null;
  }
}

// 🔹 Menu principal
function gerarMenu(nome) {
  return (
    `🎮 Bem-vindo(a), ${nome}!\n\n` +
    `Selecione o que deseja fazer:\n` +
    `1️⃣ Abrir chamado\n` +
    `2️⃣ Ver meus chamados\n` +
    `3️⃣ Falar com atendente\n` +
    `4️⃣ Encerrar atendimento\n\n` +
    `(Digite o número da opção ou "menu" a qualquer momento)`
  );
}

// 🔹 Webhook principal
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    const userId = body.session || "default";
    const parametros = body.queryResult?.parameters || {};
    const mensagem = body.queryResult?.queryText?.trim() || "";
    const matricula = parametros.matricula ? String(parametros.matricula).trim() : null;

    // 🔸 Se usuário não autenticado
    if (!usuarios.has(userId)) {
      if (!matricula) {
        return res.json({
          fulfillmentText: "👋 Olá! Bem-vindo ao FerreroHelp.\nPor favor, informe sua matrícula para continuar."
        });
      }

      const usuario = await buscarUsuario(matricula);
      if (!usuario) {
        return res.json({
          fulfillmentText: "❌ Matrícula não encontrada. Verifique e tente novamente."
        });
      }

      usuarios.set(userId, {
        ...usuario,
        etapa: "menu",
        chamadoAberto: false
      });

      return res.json({
        fulfillmentText: `✅ Matrícula confirmada!\n${gerarMenu(usuario.nome || "usuário")}`
      });
    }

    // 🔸 Usuário autenticado
    const usuario = usuarios.get(userId);
    const nome = usuario.nome || "usuário";

    // Se o usuário digitar "menu", exibir o menu novamente
    if (mensagem.toLowerCase() === "menu") {
      usuario.etapa = "menu";
      return res.json({ fulfillmentText: gerarMenu(nome) });
    }

    // Controle de fluxo conforme a etapa atual
    switch (usuario.etapa) {
      case "menu":
        if (["1", "2", "3", "4"].includes(mensagem)) {
          usuario.etapa = mensagem; // muda o estado conforme opção
        } else {
          return res.json({
            fulfillmentText: "⚠️ Opção inválida. Digite 1, 2, 3 ou 4, ou 'menu' para voltar."
          });
        }
        break;
    }

    // 🔸 Processar ações específicas
    switch (usuario.etapa) {
      case "1": // Abrir chamado
        usuario.etapa = "abrir_chamado";
        return res.json({
          fulfillmentText: "📨 Descreva brevemente o problema que você deseja reportar."
        });

      case "abrir_chamado":
        usuario.chamadoAberto = true;
        usuario.ultimoChamado = mensagem;
        usuario.etapa = "menu";
        return res.json({
          fulfillmentText:
            `✅ Chamado criado com sucesso!\n\nResumo: "${mensagem}"\n\n` +
            `Use 'menu' para voltar às opções.`
        });

      case "2": // Ver meus chamados
        usuario.etapa = "menu";
        return res.json({
          fulfillmentText: `🔎 ${nome}, atualmente você possui ${
            usuario.chamadoAberto ? "1 chamado em aberto." : "nenhum chamado no momento."
          }\n\n(Digite 'menu' para voltar.)`
        });

      case "3": // Falar com atendente
        usuario.etapa = "falar_atendente";
        return res.json({
          fulfillmentText: "👩‍💻 Ok, descreva o motivo para falar com um atendente humano."
        });

      case "falar_atendente":
        usuario.etapa = "menu";
        return res.json({
          fulfillmentText:
            `✅ Encaminhado ao atendimento humano.\nMensagem: "${mensagem}"\n\n` +
            `Nossa equipe entrará em contato em breve.\n\n(Digite 'menu' para voltar.)`
        });

      case "4": // Encerrar atendimento
        usuarios.delete(userId);
        return res.json({
          fulfillmentText: `👋 Atendimento encerrado. Até mais, ${nome}!`
        });

      default:
        return res.json({
          fulfillmentText: "⚠️ Não entendi. Digite 'menu' para ver as opções novamente."
        });
    }
  } catch (erro) {
    console.error("Erro no webhook:", erro);
    return res.json({
      fulfillmentText: "⚠️ Ocorreu um erro no atendimento. Tente novamente mais tarde."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Servidor HelpDesk rodando na porta ${PORT}`)
);

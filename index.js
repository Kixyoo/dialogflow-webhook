const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// Sessões de usuários autenticados
const usuarios = new Map();

// Função para buscar usuário pela matrícula
async function buscarUsuario(matricula) {
  try {
    const resp = await fetch(SHEETBEST_URL);
    const dados = await resp.json();
    return dados.find(row => String(row.matricula).trim() === matricula);
  } catch (erro) {
    console.error("❌ Erro ao buscar usuário:", erro);
    return null;
  }
}

// Menu principal
function gerarMenuPrincipal(nome) {
  return (
    `🎮 Bem-vindo(a), ${nome}!\n\n` +
    `Selecione o que deseja fazer:\n\n` +
    `1️⃣ Abrir chamado\n` +
    `2️⃣ Consultar chamados\n` +
    `3️⃣ Falar com atendente\n` +
    `4️⃣ Configurações\n` +
    `0️⃣ Encerrar atendimento\n\n` +
    `(Digite o número da opção ou "menu" a qualquer momento.)`
  );
}

// Submenu de configurações
function gerarMenuConfiguracoes() {
  return (
    `⚙️ Configurações:\n\n` +
    `1️⃣ Atualizar meus dados\n` +
    `2️⃣ Voltar ao menu principal\n\n` +
    `(Digite o número da opção ou "menu" para voltar.)`
  );
}

// Webhook principal
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    const userId = body.session || "default";
    const parametros = body.queryResult?.parameters || {};
    const mensagem = (body.queryResult?.queryText || "").trim().toLowerCase();
    const matricula = parametros.matricula ? String(parametros.matricula).trim() : null;

    // Usuário ainda não autenticado
    if (!usuarios.has(userId)) {
      if (!matricula) {
        return res.json({
          fulfillmentText: "👋 Por favor, informe sua matrícula para continuar."
        });
      }

      const usuario = await buscarUsuario(matricula);
      if (!usuario) {
        return res.json({
          fulfillmentText: "❌ Matrícula não encontrada. Verifique e tente novamente."
        });
      }

      usuarios.set(userId, { ...usuario, etapa: "menu", chamados: [] });
      return res.json({
        fulfillmentText: `✅ Matrícula confirmada!\n${gerarMenuPrincipal(usuario.nome || "usuário")}`
      });
    }

    const usuario = usuarios.get(userId);
    const nome = usuario.nome || "usuário";

    // Retornar ao menu principal
    if (mensagem === "menu") {
      usuario.etapa = "menu";
      return res.json({ fulfillmentText: gerarMenuPrincipal(nome) });
    }

    // Encerrar atendimento
    if (mensagem === "0") {
      usuarios.delete(userId);
      return res.json({
        fulfillmentText: `👋 Atendimento encerrado. Até mais, ${nome}!`
      });
    }

    // Controle por etapas
    switch (usuario.etapa) {
      case "menu":
        if (mensagem === "1") {
          usuario.etapa = "abrir_chamado";
          return res.json({ fulfillmentText: "📝 Descreva o problema que deseja reportar." });
        }
        if (mensagem === "2") {
          usuario.etapa = "consultar_chamados";
          const qtd = usuario.chamados.length;
          return res.json({
            fulfillmentText:
              qtd > 0
                ? `🔎 Você possui ${qtd} chamado(s) aberto(s).\nÚltimo: "${usuario.chamados[qtd - 1]}".\n(Digite 'menu' para voltar.)`
                : "📭 Você não possui chamados abertos.\n(Digite 'menu' para voltar.)"
          });
        }
        if (mensagem === "3") {
          usuario.etapa = "falar_atendente";
          return res.json({
            fulfillmentText: "👩‍💻 Ok, descreva o motivo para falar com um atendente humano."
          });
        }
        if (mensagem === "4") {
          usuario.etapa = "config";
          return res.json({ fulfillmentText: gerarMenuConfiguracoes() });
        }
        return res.json({
          fulfillmentText: "⚠️ Opção inválida. Digite 1, 2, 3, 4 ou 0."
        });

      case "abrir_chamado":
        usuario.chamados.push(mensagem);
        usuario.etapa = "menu";
        return res.json({
          fulfillmentText: `✅ Chamado aberto com sucesso!\nResumo: "${mensagem}".\n\nUse 'menu' para voltar às opções.`
        });

      case "falar_atendente":
        usuario.etapa = "menu";
        return res.json({
          fulfillmentText:
            `🤝 Encaminhando ao atendimento humano.\nMensagem: "${mensagem}"\n\n(Digite 'menu' para voltar.)`
        });

      case "config":
        if (mensagem === "1") {
          usuario.etapa = "atualizar_dados";
          return res.json({
            fulfillmentText: "✏️ Informe os novos dados que deseja atualizar (ex: telefone, e-mail)."
          });
        }
        if (mensagem === "2") {
          usuario.etapa = "menu";
          return res.json({ fulfillmentText: gerarMenuPrincipal(nome) });
        }
        return res.json({ fulfillmentText: "⚠️ Opção inválida. Digite 1 ou 2." });

      case "atualizar_dados":
        usuario.etapa = "menu";
        return res.json({
          fulfillmentText: `✅ Dados atualizados com sucesso!\nNovo valor: "${mensagem}".\n\nUse 'menu' para voltar às opções.`
        });

      default:
        usuario.etapa = "menu";
        return res.json({ fulfillmentText: gerarMenuPrincipal(nome) });
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
  console.log(`✅ Servidor FerreroHelp rodando na porta ${PORT}`)
);


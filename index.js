const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// 🔹 Armazena usuários autenticados por sessão
const usuariosAutenticados = new Map();

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    const userId = body.session || "default";
    const parametros = body.queryResult?.parameters || {};
    const mensagemUsuario = body.queryResult?.queryText?.trim() || ""; // Texto digitado
    const matricula = parametros.matricula ? String(parametros.matricula).trim() : null;

    // 🔹 1. Se o usuário ainda não informou a matrícula
    if (!usuariosAutenticados.has(userId)) {
      if (!matricula) {
        return res.json({
          fulfillmentText: "👋 Olá! Bem-vindo ao HelpDesk. Por favor, informe sua matrícula para continuar."
        });
      }

      // 🔹 2. Consultar planilha no SheetBest
      const resposta = await fetch(SHEETBEST_URL);
      const dados = await resposta.json();

      const usuario = dados.find((row) => String(row.matricula).trim() === matricula);

      // 🔹 3. Caso não encontre
      if (!usuario) {
        return res.json({
          fulfillmentText: "❌ Matrícula não encontrada. Verifique e tente novamente."
        });
      }

      // 🔹 4. Caso encontre → armazenar sessão
      usuariosAutenticados.set(userId, usuario);

      const nome = usuario.nome || "usuário";
      const setor = usuario.setor || "Setor não identificado";

      return res.json({
        fulfillmentText:
          `✅ Matrícula confirmada!\nBem-vindo(a), ${nome} (${setor}).\n\nSelecione uma opção:\n` +
          `1️⃣ - Abrir chamado\n` +
          `2️⃣ - Ver status do chamado\n` +
          `3️⃣ - Falar com um atendente\n` +
          `4️⃣ - Encerrar atendimento`
      });
    }

    // 🔹 5. Usuário já autenticado → processar menu
    const usuario = usuariosAutenticados.get(userId);
    const nome = usuario.nome || "usuário";

    // Detectar opção digitada (sem precisar de parâmetro)
    const opcao = mensagemUsuario.match(/[1-4]/)?.[0] || "";

    switch (opcao) {
      case "1":
        return res.json({
          fulfillmentText: `📨 Ok ${nome}, me diga o problema que você deseja reportar para abrir um chamado.`
        });
      case "2":
        return res.json({
          fulfillmentText: `🔎 ${nome}, seu chamado está em análise pela equipe técnica.`
        });
      case "3":
        return res.json({
          fulfillmentText: `👩‍💻 ${nome}, conectando você com um atendente humano...`
        });
      case "4":
        usuariosAutenticados.delete(userId);
        return res.json({
          fulfillmentText: `👋 Atendimento encerrado. Até mais, ${nome}!`
        });
      default:
        return res.json({
          fulfillmentText: "⚠️ Opção inválida. Digite 1, 2, 3 ou 4."
        });
    }
  } catch (erro) {
    console.error("Erro no webhook:", erro);
    return res.json({
      fulfillmentText: "⚠️ Ocorreu um erro no atendimento. Tente novamente."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor HelpDesk rodando na porta ${PORT}`));

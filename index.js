const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// 🔹 Função para buscar usuário pela matrícula
async function buscarUsuarioPorMatricula(matricula) {
  const resp = await fetch(SHEETBEST_URL);
  if (!resp.ok) throw new Error("Erro ao buscar dados da planilha");
  const dados = await resp.json();
  return dados.find(
    (row) => (row.matricula || "").trim() === String(matricula).trim()
  );
}

// 🔸 Webhook principal
app.post("/webhook", async (req, res) => {
  try {
    const parameters = req.body.queryResult?.parameters || {};
    const matricula = parameters.matricula ? String(parameters.matricula).trim() : null;

    // Se ainda não informou a matrícula
    if (!matricula) {
      return res.json({ fulfillmentText: "Por favor, informe sua matrícula para continuar." });
    }

    // Busca o usuário pela matrícula
    const usuario = await buscarUsuarioPorMatricula(matricula);

    if (usuario) {
      // Se encontrou, exibe o menu de opções
      const menu = 
        `Olá ${usuario.nome || "usuário"}! 👋\n` +
        `Matrícula: ${usuario.matricula}\n\n` +
        `Escolha uma opção:\n` +
        `1️⃣ Ver meus dados\n` +
        `2️⃣ Atualizar cadastro\n` +
        `3️⃣ Encerrar atendimento`;

      return res.json({
        fulfillmentText: menu,
        followupEventInput: {
          name: "menu_opcoes", // evento para o Dialogflow continuar o fluxo
          languageCode: "pt-BR",
          parameters: { nome: usuario.nome, matricula: usuario.matricula }
        }
      });
    } else {
      // Se não encontrar a matrícula
      return res.json({
        fulfillmentText: "⚠️ Matrícula não encontrada. Deseja realizar um novo cadastro?"
      });
    }

  } catch (erro) {
    console.error("Erro no webhook:", erro);
    return res.json({
      fulfillmentText: "⚠️ Ocorreu um erro ao buscar seus dados. Tente novamente."
    });
  }
});


// 🔹 Rota GET para listar todos os usuários da planilha
app.get("/usuarios", async (req, res) => {
  try {
    const resp = await fetch(SHEETBEST_URL);
    if (!resp.ok) throw new Error("Erro ao buscar dados da planilha");
    const dados = await resp.json();
    res.json(dados);
  } catch (erro) {
    console.error("Erro ao consultar planilha:", erro);
    res.status(500).json({ erro: "Erro ao consultar planilha" });
  }
});

// 🔹 Rota GET para buscar um usuário específico
app.get("/usuario", async (req, res) => {
  try {
    const { nome, matricula } = req.query;
    const resp = await fetch(SHEETBEST_URL);
    const dados = await resp.json();

    const usuario = dados.find(
      (row) =>
        (row.nome && row.nome.toLowerCase().trim() === nome?.toLowerCase().trim()) ||
        (row.matricula && row.matricula.trim() === matricula?.trim())
    );

    if (!usuario) return res.status(404).json({ mensagem: "Usuário não encontrado" });
    res.json(usuario);
  } catch (erro) {
    console.error("Erro ao buscar usuário:", erro);
    res.status(500).json({ erro: "Erro ao buscar usuário" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));

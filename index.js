const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// 🔹 Função para buscar usuário
async function buscarUsuarioPorMatricula(matricula) {
  try {
    const resp = await fetch(SHEETBEST_URL);

    if (!resp.ok) {
      throw new Error(`Erro HTTP: ${resp.status}`);
    }

    const dados = await resp.json(); // já é um array

    // Buscar a matrícula
    return dados.find(row => (row.matricula || "").toString().trim() === matricula.toString().trim());

  } catch (erro) {
    console.error("Erro detalhado:", erro);
    return null; // retorna null se der problema
  }
}

// 🔸 Webhook principal
app.post("/webhook", async (req, res) => {
  const matricula = req.body.queryResult?.parameters?.matricula?.toString().trim();
  if (!matricula) {
    return res.json({ fulfillmentText: "Por favor, informe sua matrícula." });
  }

  const usuario = await buscarUsuarioPorMatricula(matricula);

  if (usuario) {
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
        name: "menu_opcoes",
        languageCode: "pt-BR",
        parameters: { nome: usuario.nome, matricula: usuario.matricula }
      }
    });
  } else {
    return res.json({
      fulfillmentText: "⚠️ Matrícula não encontrada. Deseja realizar um novo cadastro?"
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));

const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// 🔹 Função para buscar usuário por matrícula
async function buscarUsuarioPorMatricula(matricula) {
  try {
    const resp = await fetch(SHEETBEST_URL);
    if (!resp.ok) throw new Error(`Erro HTTP: ${resp.status}`);
    const dados = await resp.json();

    if (!Array.isArray(dados)) throw new Error("Formato de dados inesperado");

    return dados.find(row => (row.matricula || "").toString().trim() === matricula.toString().trim());
  } catch (erro) {
    console.error("Erro ao buscar usuário:", erro);
    return null; // retorna null se der problema
  }
}

// 🔹 Função para inserir novo usuário
async function inserirUsuario(nome, matricula) {
  try {
    const bodyToInsert = {
      nome,
      matricula,
      data: new Date().toLocaleString("pt-BR")
    };

    const resp = await fetch(SHEETBEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyToInsert)
    });

    if (!resp.ok) throw new Error("Erro ao gravar dados via API");
    return true;
  } catch (erro) {
    console.error("Erro ao inserir usuário:", erro);
    return false;
  }
}

// 🔸 Webhook principal
app.post("/webhook", async (req, res) => {
  try {
    const parameters = req.body.queryResult?.parameters || {};
    const nome = parameters.nome ? parameters.nome.trim() : null;
    const matricula = parameters.matricula ? String(parameters.matricula).trim() : null;

    if (!nome) return res.json({ fulfillmentText: "Por favor, informe seu nome." });
    if (!matricula) return res.json({ fulfillmentText: "Por favor, informe sua matrícula." });

    // Verifica se já existe
    const usuarioExistente = await buscarUsuarioPorMatricula(matricula);

    if (usuarioExistente) {
      const menu =
        `Olá ${usuarioExistente.nome || "usuário"}! 👋\n` +
        `Matrícula: ${usuarioExistente.matricula}\n\n` +
        `Escolha uma opção:\n` +
        `1️⃣ Ver meus dados\n` +
        `2️⃣ Atualizar cadastro\n` +
        `3️⃣ Encerrar atendimento`;

      return res.json({
        fulfillmentText: menu,
        followupEventInput: {
          name: "menu_opcoes",
          languageCode: "pt-BR",
          parameters: { nome: usuarioExistente.nome, matricula: usuarioExistente.matricula }
        }
      });
    }

    // Se não existe, insere
    const inserido = await inserirUsuario(nome, matricula);

    if (inserido) {
      return res.json({ fulfillmentText: `✅ Dados de ${nome} adicionados com sucesso!` });
    } else {
      return res.json({ fulfillmentText: "⚠️ Não foi possível adicionar seus dados. Tente novamente mais tarde." });
    }

  } catch (erro) {
    console.error("Erro no webhook:", erro);
    return res.json({ fulfillmentText: "⚠️ Ocorreu um erro no servidor. Tente novamente mais tarde." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));

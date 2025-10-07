const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

app.post("/webhook", async (req, res) => {
  try {
    const parameters = req.body.queryResult?.parameters || {};
    const nome = parameters.nome ? parameters.nome.trim() : null;
    const matricula = parameters.matricula ? String(parameters.matricula).trim() : null;

    if (!nome) {
      return res.json({ fulfillmentText: "Por favor, informe seu nome." });
    }

    if (!matricula) {
      return res.json({ fulfillmentText: "Por favor, informe sua matrícula." });
    }

    // Ler dados da planilha
    const respGet = await fetch(SHEETBEST_URL);
    const dados = await respGet.json();

    const existe = dados.some((row) => {
      const nomePlanilha = (row.nome || "").trim().toLowerCase();
      const matriculaPlanilha = (row.matricula || "").trim();
      return nomePlanilha === nome.toLowerCase() || matriculaPlanilha === matricula;
    });

    if (existe) {
      return res.json({
        fulfillmentText: "Este nome ou matrícula já está cadastrado na planilha."
      });
    }

    // Enviar novo registro
    const bodyToInsert = {
      nome,
      matricula,
      data: new Date().toLocaleString("pt-BR")
    };

    const respPost = await fetch(SHEETBEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyToInsert)
    });

    if (!respPost.ok) throw new Error("Erro ao gravar dados via API");

    return res.json({ fulfillmentText: `✅ Dados de ${nome} adicionados com sucesso!` });

  } catch (erro) {
    console.error("Erro no webhook:", erro);
    return res.json({
      fulfillmentText: "⚠️ Houve um erro ao tentar adicionar os dados na planilha."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

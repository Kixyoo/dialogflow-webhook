const express = require("express");
const fetch = require("node-fetch"); // ou axios, dependendo do que você preferir
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

app.post("/webhook", async (req, res) => {
  try {
    const parameters = req.body.queryResult?.parameters || {};
    const nome = parameters.nome ? parameters.nome.trim() : null;
    const matricula = parameters.matricula ? String(parameters.matricula).trim() : null;

    if (!nome || !matricula) {
      return res.json({ fulfillmentText: "Por favor, informe nome e matrícula." });
    }

    // Primeiro, ler os dados já existentes via GET
    const respGet = await fetch(SHEETBEST_URL);
    if (!respGet.ok) {
      console.error("Erro no GET da SheetBest:", respGet.status, await respGet.text());
      throw new Error("Erro ao ler dados da planilha via API");
    }
    const dados = await respGet.json();

    // Verificar duplicatas
    const existe = dados.some((row) => {
      const nomePlanilha = row.nome ? String(row.nome).trim().toLowerCase() : "";
      const matriculaPlanilha = row.matricula ? String(row.matricula).trim() : "";
      return nomePlanilha === nome.toLowerCase() || matriculaPlanilha === matricula;
    });

    if (existe) {
      return res.json({ fulfillmentText: "Este nome ou matrícula já está cadastrado na planilha." });
    }

    // Inserir novo dado via POST
    const bodyToInsert = {
      nome: nome,
      matricula: matricula,
      data: new Date().toLocaleString()
    };
    const respPost = await fetch(SHEETBEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(bodyToInsert)
    });
    if (!respPost.ok) {
      console.error("Erro no POST da SheetBest:", respPost.status, await respPost.text());
      throw new Error("Erro ao gravar dados via API");
    }

    return res.json({ fulfillmentText: `Dados de ${nome} adicionados com sucesso!` });
  } catch (erro) {
    console.error("Erro no webhook com SheetBest:", erro);
    return res.json({
      fulfillmentText: "Houve um erro ao tentar adicionar os dados na planilha.",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

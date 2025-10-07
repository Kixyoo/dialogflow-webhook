const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

app.post("/webhook", async (req, res) => {
  try {
    const session = req.body.session || "";
    const parameters = req.body.queryResult?.parameters || {};
    const nome = parameters.nome ? parameters.nome.trim() : null;
    const matricula = parameters.matricula ? String(parameters.matricula).trim() : null;
    const contextos = req.body.queryResult.outputContexts || [];

    // Recuperar dados anteriores do contexto (caso já tenha o nome)
    let nomeSalvo = nome;
    for (const ctx of contextos) {
      if (ctx.name.includes("/contexts/cadastro_dados") && ctx.parameters?.nome) {
        nomeSalvo = ctx.parameters.nome;
      }
    }

    // Se ainda não informou o nome
    if (!nomeSalvo) {
      return res.json({
        fulfillmentText: "Qual é o seu nome?",
        outputContexts: [
          {
            name: `${session}/contexts/cadastro_dados`,
            lifespanCount: 5,
            parameters: { nome: null, matricula: null },
          },
        ],
      });
    }

    // Se informou nome mas não matrícula
    if (nomeSalvo && !matricula) {
      return res.json({
        fulfillmentText: "Qual é a sua matrícula?",
        outputContexts: [
          {
            name: `${session}/contexts/cadastro_dados`,
            lifespanCount: 5,
            parameters: { nome: nomeSalvo },
          },
        ],
      });
    }

    // Se nome e matrícula estão preenchidos → salvar
    const respGet = await fetch(SHEETBEST_URL);
    const dados = await respGet.json();

    const existe = dados.some((row) => {
      const nomePlanilha = row.nome ? String(row.nome).trim().toLowerCase() : "";
      const matriculaPlanilha = row.matricula ? String(row.matricula).trim() : "";
      return nomePlanilha === nomeSalvo.toLowerCase() || matriculaPlanilha === matricula;
    });

    if (existe) {
      return res.json({ fulfillmentText: "Este nome ou matrícula já está cadastrado na planilha." });
    }

    // Inserir novo dado via POST
    const bodyToInsert = {
      nome: nomeSalvo,
      matricula: matricula,
      data: new Date().toLocaleString()
    };
    await fetch(SHEETBEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyToInsert)
    });

    return res.json({
      fulfillmentText: `Dados de ${nomeSalvo} adicionados com sucesso!`,
      outputContexts: [
        { name: `${session}/contexts/cadastro_dados`, lifespanCount: 0 }
      ]
    });

  } catch (erro) {
    console.error("Erro no webhook com SheetBest:", erro);
    return res.json({ fulfillmentText: "Houve um erro ao tentar adicionar os dados na planilha." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

app.post("/webhook", async (req, res) => {
  try {
    const session = req.body.session || "";
    const queryText = req.body.queryResult?.queryText?.toLowerCase() || "";
    const parameters = req.body.queryResult?.parameters || {};
    const nome = parameters.nome ? parameters.nome.trim() : null;
    const matricula = parameters.matricula ? String(parameters.matricula).trim() : null;
    const contextos = req.body.queryResult.outputContexts || [];

    // Recuperar contexto
    let nomeSalvo = nome;
    let matriculaSalva = matricula;
    let aguardandoConfirmacao = false;

    for (const ctx of contextos) {
      if (ctx.name.includes("/contexts/cadastro_dados")) {
        if (ctx.parameters?.nome) nomeSalvo = ctx.parameters.nome;
        if (ctx.parameters?.matricula) matriculaSalva = ctx.parameters.matricula;
        if (ctx.parameters?.aguardandoConfirmacao) aguardandoConfirmacao = ctx.parameters.aguardandoConfirmacao;
      }
    }

    // 🔹 Etapa de confirmação (já cadastrado)
    if (aguardandoConfirmacao) {
      if (["sim", "claro", "pode", "confirmo"].includes(queryText)) {
        // Usuário quer continuar → redirecionar
        return res.json({
          followupEventInput: {
            name: "INICIAR_ATENDIMENTO",
            languageCode: "pt-BR",
            parameters: {
              nome: nomeSalvo,
              matricula: matriculaSalva
            }
          }
        });
      } else if (["não", "nao", "cancelar", "parar"].includes(queryText)) {
        return res.json({
          fulfillmentText: "Tudo bem! Cadastro cancelado. Se quiser recomeçar, é só me avisar 😊",
          outputContexts: [
            { name: `${session}/contexts/cadastro_dados`, lifespanCount: 0 }
          ]
        });
      } else {
        return res.json({
          fulfillmentText: "Você já está cadastrado. Deseja continuar mesmo assim? (sim/não)",
          outputContexts: [
            {
              name: `${session}/contexts/cadastro_dados`,
              lifespanCount: 3,
              parameters: { nome: nomeSalvo, matricula: matriculaSalva, aguardandoConfirmacao: true }
            }
          ]
        });
      }
    }

    // 🔹 Perguntar nome
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

    // 🔹 Perguntar matrícula
    if (nomeSalvo && !matriculaSalva) {
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

    // 🔹 Verifica se já existe
    const respGet = await fetch(SHEETBEST_URL);
    const dados = await respGet.json();

    const existe = dados.some((row) => {
      const nomePlanilha = row.nome ? String(row.nome).trim().toLowerCase() : "";
      const matriculaPlanilha = row.matricula ? String(row.matricula).trim() : "";
      return nomePlanilha === nomeSalvo.toLowerCase() || matriculaPlanilha === matriculaSalva;
    });

    if (existe) {
      return res.json({
        fulfillmentText: "Parece que você já está cadastrado. Deseja continuar mesmo assim? (sim/não)",
        outputContexts: [
          {
            name: `${session}/contexts/cadastro_dados`,
            lifespanCount: 3,
            parameters: {
              nome: nomeSalvo,
              matricula: matriculaSalva,
              aguardandoConfirmacao: true
            }
          }
        ]
      });
    }

    // 🔹 Inserir novo cadastro
    const bodyToInsert = {
      nome: nomeSalvo,
      matricula: matriculaSalva,
      data: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    };

    await fetch(SHEETBEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyToInsert),
    });

    // 🔹 Confirma e redireciona para atendimento
    return res.json({
      fulfillmentText: `✅ Dados de ${nomeSalvo} adicionados com sucesso! Redirecionando para o atendimento...`,
      followupEventInput: {
        name: "INICIAR_ATENDIMENTO",
        languageCode: "pt-BR",
        parameters: {
          nome: nomeSalvo,
          matricula: matriculaSalva
        }
      }
    });

  } catch (erro) {
    console.error("Erro no webhook com SheetBest:", erro);
    return res.json({
      fulfillmentText: "⚠️ Ocorreu um erro ao tentar salvar os dados. Tente novamente mais tarde.",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));

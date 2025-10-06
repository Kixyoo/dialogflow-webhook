const express = require("express");
const { WebhookClient } = require("dialogflow-fulfillment");
const bodyParser = require("body-parser");
const { google } = require("googleapis");
const axios = require("axios");
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// FUNÇÃO PARA INSERIR ID ÚNICO
function uniqueID() {
  function chr4() {
    return Math.random().toString(16).slice(-6);
  }
  return chr4();
}

// CONFIGURAÇÃO GOOGLE SHEETS
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json", // coloque o JSON da service account aqui
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const SPREADSHEET_ID = "1DivV2yHvXJnh6n69oQz_Q3ym2TFvyQwTGm2Qap4MZ0c";
const RANGE = "Página1!A:C"; // A = ID, B = Nome, C = Matrícula

app.get("/", (req, res) => {
  res.send("Aula Plataforma Glitch para Dialogflow");
});

app.post("/webhook", async (request, response) => {
  const agent = new WebhookClient({ request, response });

  // FUNÇÃO PARA OBTER HORÁRIO
  let date = new Date();
  let hora = date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    hour12: false,
  });

  // FUNÇÃO DE BOAS-VINDAS
  function welcome(agent) {
    if (hora >= 5 && hora <= 11)
      agent.add(
        `Oi 👩🏽‍🎤 Bom dia!\nOlá seja Bem Vindo A Gráfica Online Qual o Seu Nome?\n\n[1] Quero saber mais\n[2] Assistir uma Aula Grátis\n[3] Entrar no Grupo Vip\n[4] Presente Surpresa`
      );
    else if (hora >= 12 && hora <= 17)
      agent.add(
        `Oi 👨🏻‍💻 Boa tarde!\nOlá seja Bem Vindo A Gráfica Online Qual o Seu Nome?!\n\n[1] Quero saber mais\n[2] Assistir uma Aula Grátis\n[3] Entrar no Grupo Vip\n[4] Presente Surpresa`
      );
    else
      agent.add(
        `Oi 👨🏻‍💻 Boa noite! Me chamo Bruno\nSeja Bem Vindo A Gráfica Online\n*_Digite Apenas o Número Correspondente ao que Precisa._*\n1 - Valores de Carimbos.\n2 - Valores de Cartão de Visita.\n3 - Valores de Panfletos.\n4 - Valores de Banners.\n5 - Valor de Etiquetas.\n6 - Blocos/Comandas\n7 - Cavaletes/Wind Banner\n8 - Orçamento de Outros Materiais\n9 - Falar Direto Com Atendente.`
      );
  }

  // FUNÇÃO DE CADASTRO COM CONSULTA NA PLANILHA
  async function cadastro(agent) {
    const { nome, matricula, telefone, produto } = agent.parameters;

    let client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = result.data.values;
    let idEncontrado = null;

    if (rows && rows.length > 1) {
      for (let i = 1; i < rows.length; i++) {
        const [idPlanilha, nomePlanilha, matriculaPlanilha] = rows[i];

        const nomeTrim = nome ? nome.toString().trim().toLowerCase() : null;
        const matriculaTrim = matricula ? matricula.toString().trim() : null;
        const nomeSheet = nomePlanilha ? nomePlanilha.toString().trim().toLowerCase() : "";
        const matriculaSheet = matriculaPlanilha ? matriculaPlanilha.toString().trim() : "";

        if (matriculaTrim && matriculaSheet === matriculaTrim) {
          idEncontrado = idPlanilha;
          break;
        }
        if (nomeTrim && nomeSheet === nomeTrim) {
          idEncontrado = idPlanilha;
          break;
        }
      }
    }

    // Se não encontrou, gera um ID único
    if (!idEncontrado) idEncontrado = uniqueID();

    // Inserir registro na API Sheet.best
    const dataToInsert = [
      {
        Nome: nome,
        Telefone: telefone,
        Produto: produto,
        Matrícula: matricula || "",
        ID: idEncontrado,
      },
    ];

    try {
      await axios.post(
        "https://sheet.best/api/sheets/c97701f9-98a4-43ec-ae17-75b20e926928",
        dataToInsert
      );
    } catch (err) {
      console.error("Erro ao inserir na Sheet.best:", err);
    }

    agent.add(`Olá ${nome}! Seu ID é: ${idEncontrado}`);
  }

  // MAPEAMENTO DAS INTENTS
  let intentMap = new Map();
  intentMap.set("Default Welcome Intent", welcome);
  intentMap.set("Default Welcome Intent - yes", cadastro);
  agent.handleRequest(intentMap);
});

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log("Servidor rodando na porta " + listener.address().port);
});

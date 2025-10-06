const express = require("express");
const { google } = require("googleapis");
const app = express();
app.use(express.json());

// Configuração de autenticação com Google Sheets
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",  // nome do arquivo JSON da service account
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

// ID da planilha e intervalo
const SPREADSHEET_ID = "1DivV2yHvXJnh6n69oQz_Q3ym2TFvyQwTGm2Qap4MZ0c";
const RANGE = "Página1!A:C";  // colunas A = ID, B = Nome, C = Matrícula

app.post("/webhook", async (req, res) => {
  try {
    const parameters = req.body.queryResult.parameters || {};
    const nome = parameters["nome"];
    const matricula = parameters["matricula"];

    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = result.data.values;  // array de arrays
    let resposta = "Não encontrei correspondência na planilha.";

    if (rows && rows.length > 1) {
      // começamos de i = 1 para pular cabeçalho
      for (let i = 1; i < rows.length; i++) {
        const [idPlanilha, nomePlanilha, matriculaPlanilha] = rows[i];

        // se tiver matrícula informada, comparo com a coluna C
        if (matricula && matriculaPlanilha === String(matricula)) {
          resposta = `Olá ${nomePlanilha}! Seu ID é ${idPlanilha}.`;
          break;
        }
        // se tiver nome informado, comparo (case-insensitive)
        if (nome && nomePlanilha.toLowerCase() === nome.toLowerCase()) {
          resposta = `Olá ${nomePlanilha}! Seu ID é ${idPlanilha}.`;
          break;
        }
      }
    }

    return res.json({ fulfillmentText: resposta });
  } catch (erro) {
    console.error("Erro ao consultar planilha:", erro);
    return res.json({
      fulfillmentText: "Houve um erro ao tentar consultar a planilha.",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

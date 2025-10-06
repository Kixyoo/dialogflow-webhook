const express = require("express");
const { google } = require("googleapis");
const app = express();
app.use(express.json());

// Autenticação usando variáveis de ambiente
const auth = new google.auth.GoogleAuth({
  credentials: {
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    project_id: process.env.GOOGLE_PROJECT_ID,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

// Planilha e intervalo
const SPREADSHEET_ID = "1DivV2yHvXJnh6n69oQz_Q3ym2TFvyQwTGm2Qap4MZ0c";
const RANGE = "Página1!A:C";

// Webhook do Dialogflow
app.post("/webhook", async (req, res) => {
  try {
    const parameters = req.body.queryResult.parameters || {};
    const nome = parameters.nome ? parameters.nome.trim().toLowerCase() : null;
    const matricula = parameters.matricula ? String(parameters.matricula).trim() : null;

    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = result.data.values;
    let resposta = "Não encontrei correspondência na planilha.";

    if (rows && rows.length > 1) {
      for (let i = 1; i < rows.length; i++) {
        const [idPlanilha, nomePlanilhaRaw, matriculaPlanilhaRaw] = rows[i];
        const nomePlanilha = nomePlanilhaRaw ? nomePlanilhaRaw.trim().toLowerCase() : "";
        const matriculaPlanilha = matriculaPlanilhaRaw ? String(matriculaPlanilhaRaw).trim() : "";

        if (matricula && matriculaPlanilha === matricula) {
          resposta = `Olá ${nomePlanilhaRaw}! Seu ID é ${idPlanilha}.`;
          break;
        }

        if (nome && nomePlanilha === nome) {
          resposta = `Olá ${nomePlanilhaRaw}! Seu ID é ${idPlanilha}.`;
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

const express = require("express");
const { google } = require("googleapis");
const app = express();
app.use(express.json());

const auth = new google.auth.GoogleAuth({
  credentials: {
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    project_id: process.env.GOOGLE_PROJECT_ID,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = "1DivV2yHvXJnh6n69oQz_Q3ym2TFvyQwTGm2Qap4MZ0c";
const RANGE = "Página1!A:C";

app.post("/webhook", async (req, res) => {
  try {
    const parameters = req.body.queryResult.parameters || {};
    const nome = parameters.nome ? parameters.nome.trim() : null;
    const matricula = parameters.matricula ? String(parameters.matricula).trim() : null;

    if (!nome || !matricula) {
      return res.json({ fulfillmentText: "Por favor, informe nome e matrícula." });
    }

    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    // Ler toda a planilha
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = result.data.values || [];

    // Checar se nome ou matrícula já existem
    const existe = rows.some((row) => {
      const nomePlanilha = row[1] ? row[1].trim().toLowerCase() : "";
      const matriculaPlanilha = row[2] ? String(row[2]).trim() : "";
      return nomePlanilha === nome.toLowerCase() || matriculaPlanilha === matricula;
    });

    if (existe) {
      return res.json({ fulfillmentText: "Este nome ou matrícula já está cadastrado na planilha." });
    }

    // Acrescentar nova linha
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: [[new Date().toLocaleString(), nome, matricula]],
      },
    });

    return res.json({ fulfillmentText: `Dados de ${nome} adicionados com sucesso!` });
  } catch (erro) {
    console.error("Erro ao adicionar na planilha:", erro);
    return res.json({
      fulfillmentText: "Houve um erro ao tentar adicionar os dados na planilha.",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

const express = require("express");
const { google } = require("googleapis");
const app = express();
app.use(express.json());

// 🔹 Configuração Google Sheets
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json", // seu JSON da service account
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const SPREADSHEET_ID = "1DivV2yHvXJnh6n69oQz_Q3ym2TFvyQwTGm2Qap4MZ0c";
const RANGE = "A:E"; // ajuste conforme suas colunas: matricula,nome,email,telefone,departamento

// 🔹 Função para buscar usuário por matrícula
async function buscarUsuarioPorMatricula(matricula) {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = res.data.values; // array de arrays
    if (!rows || rows.length === 0) return null;

    // Assumindo que a primeira linha é o cabeçalho
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Criar objetos
    const dados = dataRows.map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h.trim().toLowerCase()] = row[i] || "");
      return obj;
    });

    // Procurar matrícula
    return dados.find(row => (row.matricula || "").toString().trim() === matricula.toString().trim());

  } catch (erro) {
    console.error("Erro ao acessar Google Sheets:", erro);
    throw erro;
  }
}

// 🔸 Webhook principal
app.post("/webhook", async (req, res) => {
  try {
    const parameters = req.body.queryResult?.parameters || {};
    const matricula = parameters.matricula ? String(parameters.matricula).trim() : null;

    if (!matricula) {
      return res.json({ 
        fulfillmentText: "Por favor, informe sua matrícula para continuar." 
      });
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
          parameters: { 
            nome: usuario.nome, 
            matricula: usuario.matricula 
          }
        }
      });
    } else {
      return res.json({
        fulfillmentText: "⚠️ Matrícula não encontrada. Deseja realizar um novo cadastro?"
      });
    }

  } catch (erro) {
    console.error("Erro no webhook:", erro);
    return res.json({
      fulfillmentText: "⚠️ Ocorreu um erro ao buscar seus dados. Verifique se a planilha está compartilhada corretamente."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));

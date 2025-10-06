const express = require("express");
const { google } = require("googleapis");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configuração de autenticação com Google Sheets
const auth = new google.auth.GoogleAuth({
  keyFile: "credenciais.json", // arquivo da service account
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const sheets = google.sheets({ version: "v4", auth });

// Função principal — responder à intent do Dialogflow
app.post("/webhook", async (req, res) => {
  try {
    const intent = req.body.queryResult.intent.displayName;

    if (intent === "ConsultarProduto") {
      const nomeProduto = req.body.queryResult.parameters.produto;
      const spreadsheetId = "https://docs.google.com/spreadsheets/d/1DivV2yHvXJnh6n69oQz_Q3ym2TFvyQwTGm2Qap4MZ0c/edit?usp=sharing";
      const range = "Produtos!A:B"; // nome da aba e intervalo

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

      const linhas = response.data.values;
      const produto = linhas.find(
        (linha) => linha[0].toLowerCase() === nomeProduto.toLowerCase()
      );

      let resposta = "Produto não encontrado.";
      if (produto) {
        resposta = `O preço do ${produto[0]} é R$${produto[1]}.`;
      }

      return res.json({ fulfillmentText: resposta });
    }

    res.json({ fulfillmentText: "Intent não reconhecida." });
  } catch (erro) {
    console.error("Erro no webhook:", erro);
    res.json({ fulfillmentText: "Erro interno no servidor." });
  }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

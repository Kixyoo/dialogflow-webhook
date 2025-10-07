const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// 🔹 Função melhorada para buscar usuário
async function buscarUsuarioPorMatricula(matricula) {
  try {
    console.log("Buscando matrícula:", matricula);
    const resp = await fetch(SHEETBEST_URL);
    
    if (!resp.ok) {
      throw new Error(`Erro HTTP: ${resp.status}`);
    }
    
    const dados = await resp.json();
    console.log("Dados recebidos da planilha:", dados);
    
    // Verifica se os dados são um array
    if (!Array.isArray(dados)) {
      console.log("Estrutura dos dados:", typeof dados);
      // Tenta acessar dados aninhados se existirem
      const dadosArray = dados.data || dados.records || [dados];
      return dadosArray.find(row => 
        (row.matricula || "").toString().trim() === matricula.toString().trim()
      );
    }
    
    return dados.find(row => 
      (row.matricula || "").toString().trim() === matricula.toString().trim()
    );
    
  } catch (erro) {
    console.error("Erro detalhado:", erro);
    throw erro;
  }
}

// 🔸 Webhook principal (mantenha igual)
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
      fulfillmentText: "⚠️ Ocorreu um erro ao buscar seus dados. Verifique se a planilha está compartilhada publicamente."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));

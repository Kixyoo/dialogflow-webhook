const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// Sessões temporárias
const sessoes = {};

// Buscar usuário por matrícula
async function buscarUsuarioPorMatricula(matricula) {
  try {
    const resp = await fetch(SHEETBEST_URL);
    const dados = await resp.json();
    return dados.find(row => (row.matricula || "").toString().trim() === matricula.toString().trim());
  } catch (erro) {
    console.error("Erro ao buscar usuário:", erro);
    return null;
  }
}

// Inserir novo usuário
async function inserirUsuario(user) {
  try {
    const bodyToInsert = { ...user, data: new Date().toLocaleString("pt-BR") };
    const resp = await fetch(SHEETBEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyToInsert)
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// Atualizar usuário
async function atualizarUsuario(user) {
  try {
    const bodyToInsert = { ...user, atualizado_em: new Date().toLocaleString("pt-BR") };
    const resp = await fetch(SHEETBEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyToInsert)
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// Registrar chamado
async function registrarChamado(usuario, descricao) {
  try {
    const chamado = {
      matricula: usuario.matricula,
      nome: usuario.nome,
      descricao,
      status: "Aberto",
      data: new Date().toLocaleString("pt-BR")
    };
    const resp = await fetch(SHEETBEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chamado)
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// Menu principal
function gerarMenuHelpdesk(usuario) {
  return `Olá ${usuario.nome}! 👋\nEscolha uma opção:\n1️⃣ Abrir chamado\n2️⃣ Ver meus chamados\n3️⃣ FAQ\n4️⃣ Encerrar atendimento`;
}

// Submenu FAQ
function gerarFAQ() {
  return `💡 Perguntas frequentes:\n1️⃣ Horário de atendimento\n2️⃣ Políticas da empresa\n3️⃣ Voltar ao menu principal`;
}

// Webhook principal
app.post("/webhook", async (req, res) => {
  try {
    const params = req.body.queryResult?.parameters || {};
    const sessionId = req.body.session;
    let sessao = sessoes[sessionId] || {};

    const matricula = params.matricula ? String(params.matricula).trim() : sessao.matricula;
    let usuario = sessao.usuario;

    // Passo 1: Solicitar matrícula
    if (!matricula) {
      return res.json({ fulfillmentText: "Por favor, informe sua matrícula para acessar o Helpdesk." });
    }

    // Buscar usuário
    if (!usuario) {
      usuario = await buscarUsuarioPorMatricula(matricula);
      sessao.matricula = matricula;
    }

    // Cadastro se não existir
    if (!usuario) {
      const faltando = [];
      if (!params.nome) faltando.push("nome");
      if (!params.email) faltando.push("email");
      if (!params.telefone) faltando.push("telefone");
      if (!params.departamento) faltando.push("departamento");

      if (faltando.length > 0) {
        sessoes[sessionId] = sessao;
        return res.json({ fulfillmentText: `Matrícula não encontrada. Por favor, informe: ${faltando.join(", ")}` });
      }

      const novoUsuario = {
        nome: params.nome,
        matricula,
        email: params.email,
        telefone: params.telefone,
        departamento: params.departamento
      };
      const inserido = await inserirUsuario(novoUsuario);
      if (!inserido) return res.json({ fulfillmentText: "⚠️ Não foi possível cadastrar. Tente novamente mais tarde." });
      usuario = novoUsuario;
    }

    sessao.usuario = usuario;
    sessoes[sessionId] = sessao;

    const opcao = params.opcao || req.body.queryResult?.queryText?.trim();
    const subOpcao = params.subOpcao;

    // Menu principal se não escolheu opção
    if (!opcao) return res.json({ fulfillmentText: gerarMenuHelpdesk(usuario) });

    switch (opcao) {
      case "1": // Abrir chamado
        if (!params.descricao) {
          return res.json({ fulfillmentText: "Por favor, descreva o problema ou solicitação do chamado." });
        }
        const sucessoChamado = await registrarChamado(usuario, params.descricao);
        if (sucessoChamado) {
          return res.json({ fulfillmentText: "✅ Chamado registrado com sucesso!\n\n" + gerarMenuHelpdesk(usuario) });
        } else {
          return res.json({ fulfillmentText: "⚠️ Não foi possível registrar o chamado." });
        }

      case "2": // Ver chamados
        return res.json({ fulfillmentText: "🔹 Funcionalidade de listar chamados ainda em implementação.\n\n" + gerarMenuHelpdesk(usuario) });

      case "3": // FAQ
        if (!subOpcao) return res.json({ fulfillmentText: gerarFAQ() });
        let respostaFAQ = "";
        switch (subOpcao) {
          case "1": respostaFAQ = "🕘 Horário: Segunda a sexta, 08:00 às 18:00."; break;
          case "2": respostaFAQ = "📜 Políticas: Todas disponíveis no manual interno."; break;
          case "3": return res.json({ fulfillmentText: gerarMenuHelpdesk(usuario) });
          default: respostaFAQ = "⚠️ Opção inválida. Tente novamente.";
        }
        return res.json({ fulfillmentText: `${respostaFAQ}\n\n${gerarFAQ()}` });

      case "4": // Encerrar atendimento
        delete sessoes[sessionId];
        return res.json({ fulfillmentText: "👋 Atendimento encerrado. Até mais!" });

      default:
        return res.json({ fulfillmentText: "⚠️ Opção inválida. Digite 1, 2, 3 ou 4." });
    }

  } catch (erro) {
    console.error("Erro no webhook:", erro);
    return res.json({ fulfillmentText: "⚠️ Ocorreu um erro no servidor. Tente novamente mais tarde." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));

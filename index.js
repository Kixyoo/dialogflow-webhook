const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// 🔹 Armazenamento temporário de sessões
const sessoes = {};

// 🔹 Buscar usuário por matrícula
async function buscarUsuarioPorMatricula(matricula) {
  try {
    const resp = await fetch(SHEETBEST_URL);
    if (!resp.ok) throw new Error(`Erro HTTP: ${resp.status}`);
    const dados = await resp.json();
    return dados.find(row => (row.matricula || "").toString().trim() === matricula.toString().trim());
  } catch (erro) {
    console.error("Erro ao buscar usuário:", erro);
    return null;
  }
}

// 🔹 Inserir novo usuário
async function inserirUsuario(user) {
  try {
    const bodyToInsert = { ...user, data: new Date().toLocaleString("pt-BR") };
    const resp = await fetch(SHEETBEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyToInsert)
    });
    return resp.ok;
  } catch (erro) {
    console.error("Erro ao inserir usuário:", erro);
    return false;
  }
}

// 🔹 Atualizar usuário
async function atualizarUsuario(user) {
  try {
    const bodyToInsert = { ...user, atualizado_em: new Date().toLocaleString("pt-BR") };
    const resp = await fetch(SHEETBEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyToInsert)
    });
    return resp.ok;
  } catch (erro) {
    console.error("Erro ao atualizar usuário:", erro);
    return false;
  }
}

// 🔹 Gerar menu principal
function gerarMenu(usuario) {
  return `Olá ${usuario.nome}! 👋\nEscolha uma opção:\n1️⃣ Ver meus dados\n2️⃣ Atualizar cadastro\n3️⃣ FAQ\n4️⃣ Encerrar atendimento`;
}

// 🔹 Sub-menu FAQ
function gerarFAQ(usuario) {
  return `💡 Perguntas frequentes:\n1️⃣ Horário de atendimento\n2️⃣ Políticas da empresa\n3️⃣ Voltar ao menu principal`;
}

// 🔸 Webhook principal
app.post("/webhook", async (req, res) => {
  try {
    const params = req.body.queryResult?.parameters || {};
    const sessionId = req.body.session;
    let sessao = sessoes[sessionId] || {};

    // Recuperar matrícula do estado ou do parâmetro
    const matricula = params.matricula ? String(params.matricula).trim() : sessao.matricula;
    let usuario = sessao.usuario;

    // 🔹 Se não tiver matrícula, pede ao usuário
    if (!matricula) {
      return res.json({ fulfillmentText: "Por favor, informe sua matrícula para continuar." });
    }

    // 🔹 Se não tivermos usuário em memória, busca na planilha
    if (!usuario) {
      usuario = await buscarUsuarioPorMatricula(matricula);
      sessao.matricula = matricula;
    }

    // 🔹 Se não encontrado, pede dados restantes
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
      if (!inserido) {
        return res.json({ fulfillmentText: "⚠️ Não foi possível cadastrar. Tente novamente mais tarde." });
      }
      usuario = novoUsuario;
    }

    sessao.usuario = usuario;
    sessoes[sessionId] = sessao;

    // 🔹 Captura a opção do menu: pelo parâmetro ou texto digitado
    let opcao = params.opcao;
    if (!opcao && req.body.queryResult?.queryText) {
      opcao = req.body.queryResult.queryText.trim();
    }

    // 🔹 Se não escolheu opção, mostra menu
    if (!opcao) {
      return res.json({ fulfillmentText: gerarMenu(usuario) });
    }

    // 🔹 Processa escolha do menu
    switch (opcao) {
      case "1":
        return res.json({
          fulfillmentText: `📄 Seus dados:\nNome: ${usuario.nome}\nMatrícula: ${usuario.matricula}\nEmail: ${usuario.email}\nTelefone: ${usuario.telefone}\nDepartamento: ${usuario.departamento}\n\n${gerarMenu(usuario)}`
        });

      case "2":
        // Para atualizar, pedimos novos dados via parâmetro ou texto
        const atualizado = await atualizarUsuario({
          nome: usuario.nome,
          matricula: usuario.matricula,
          email: params.email || usuario.email,
          telefone: params.telefone || usuario.telefone,
          departamento: params.departamento || usuario.departamento
        });
        return res.json({ fulfillmentText: atualizado ? `✅ Cadastro atualizado com sucesso!\n\n${gerarMenu(usuario)}` : "⚠️ Não foi possível atualizar seu cadastro." });

      case "3":
        // FAQ
        const subOpcao = params.subOpcao || req.body.queryResult?.queryText?.trim();
        if (!subOpcao) return res.json({ fulfillmentText: gerarFAQ(usuario) });
        let respostaFAQ = "";
        switch (subOpcao) {
          case "1": respostaFAQ = "🕘 Horário de atendimento: Segunda a sexta, 08:00 às 18:00."; break;
          case "2": respostaFAQ = "📜 Políticas da empresa: Todas as informações estão disponíveis no manual interno."; break;
          case "3": return res.json({ fulfillmentText: gerarMenu(usuario) });
          default: respostaFAQ = "⚠️ Opção inválida. Tente novamente.";
        }
        return res.json({ fulfillmentText: `${respostaFAQ}\n\n${gerarFAQ(usuario)}` });

      case "4":
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

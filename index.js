const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const SHEETBEST_URL = "https://api.sheetbest.com/sheets/4e9a0ce8-f805-46b9-bee8-402a3bc806c3";

// 🔹 Buscar usuário por matrícula
async function buscarUsuarioPorMatricula(matricula) {
  try {
    const resp = await fetch(SHEETBEST_URL);
    if (!resp.ok) throw new Error(`Erro HTTP: ${resp.status}`);
    const dados = await resp.json();
    if (!Array.isArray(dados)) throw new Error("Formato de dados inesperado");
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
    const nome = params.nome ? params.nome.trim() : null;
    const matricula = params.matricula ? String(params.matricula).trim() : null;
    const email = params.email ? params.email.trim() : null;
    const telefone = params.telefone ? params.telefone.trim() : null;
    const departamento = params.departamento ? params.departamento.trim() : null;
    const opcao = params.opcao ? params.opcao.trim() : null;
    const subOpcao = params.subOpcao ? params.subOpcao.trim() : null;

    // ❌ Passo 1: perguntar dados faltantes
    if (!nome) return res.json({ fulfillmentText: "Por favor, informe seu nome." });
    if (!matricula) return res.json({ fulfillmentText: "Por favor, informe sua matrícula." });

    let usuario = await buscarUsuarioPorMatricula(matricula);

    // ❌ Se não existe, pedir os campos restantes
    if (!usuario) {
      if (!email) return res.json({ fulfillmentText: "Por favor, informe seu email." });
      if (!telefone) return res.json({ fulfillmentText: "Por favor, informe seu telefone." });
      if (!departamento) return res.json({ fulfillmentText: "Por favor, informe seu departamento." });

      const novoUsuario = { nome, matricula, email, telefone, departamento };
      const inserido = await inserirUsuario(novoUsuario);
      if (inserido) {
        usuario = novoUsuario;
        return res.json({ fulfillmentText: `✅ Dados de ${nome} adicionados com sucesso!\n\n${gerarMenu(usuario)}` });
      } else {
        return res.json({ fulfillmentText: "⚠️ Não foi possível adicionar seus dados. Tente novamente mais tarde." });
      }
    }

    // ❌ Passo 2: Menu principal
    if (!opcao) {
      return res.json({
        fulfillmentText: gerarMenu(usuario),
        followupEventInput: { name: "menu_opcoes", languageCode: "pt-BR", parameters: usuario }
      });
    }

    // ❌ Passo 3: Escolha do menu
    switch (opcao) {
      case "1": // Ver meus dados
        return res.json({
          fulfillmentText: `📄 Seus dados:\nNome: ${usuario.nome}\nMatrícula: ${usuario.matricula}\nEmail: ${usuario.email}\nTelefone: ${usuario.telefone}\nDepartamento: ${usuario.departamento}\n\n${gerarMenu(usuario)}`
        });

      case "2": // Atualizar cadastro
        const atualizado = await atualizarUsuario({
          nome,
          matricula,
          email: email || usuario.email,
          telefone: telefone || usuario.telefone,
          departamento: departamento || usuario.departamento
        });
        if (atualizado) {
          return res.json({ fulfillmentText: `✅ Cadastro atualizado com sucesso!\n\n${gerarMenu(usuario)}` });
        } else {
          return res.json({ fulfillmentText: "⚠️ Não foi possível atualizar seu cadastro." });
        }

      case "3": // FAQ
        if (!subOpcao) {
          return res.json({
            fulfillmentText: gerarFAQ(usuario),
            followupEventInput: { name: "faq_opcoes", languageCode: "pt-BR", parameters: usuario }
          });
        } else {
          // Respostas FAQ
          let respostaFAQ = "";
          switch (subOpcao) {
            case "1":
              respostaFAQ = "🕘 Horário de atendimento: Segunda a sexta, 08:00 às 18:00.";
              break;
            case "2":
              respostaFAQ = "📜 Políticas da empresa: Todas as informações estão disponíveis no manual interno.";
              break;
            case "3":
              return res.json({
                fulfillmentText: gerarMenu(usuario),
                followupEventInput: { name: "menu_opcoes", languageCode: "pt-BR", parameters: usuario }
              });
            default:
              respostaFAQ = "⚠️ Opção inválida. Tente novamente.";
          }
          return res.json({ fulfillmentText: `${respostaFAQ}\n\n${gerarFAQ(usuario)}` });
        }

      case "4": // Encerrar atendimento
        return res.json({ fulfillmentText: "👋 Atendimento encerrado. Até mais!" });

      default:
        return res.json({ fulfillmentText: "⚠️ Opção inválida. Tente novamente." });
    }

  } catch (erro) {
    console.error("Erro no webhook:", erro);
    return res.json({ fulfillmentText: "⚠️ Ocorreu um erro no servidor. Tente novamente mais tarde." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));

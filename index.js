
const express = require("express");
const fetch = require("node-fetch");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const app = express();
app.use(express.json());

const SHEETBEST_URL = process.env.SHEETBEST_URL;
const ADMIN_PIN_HASH = process.env.ADMIN_PIN_HASH;

// Sessões de usuários autenticados
const usuarios = new Map();

// ===== SheetBest helpers =====
async function buscarUsuario(matricula) {
  try {
    const resp = await fetch(SHEETBEST_URL);
    const dados = await resp.json();
    return dados.find((row) => String(row.matricula).trim() === matricula);
  } catch (erro) {
    console.error("❌ Erro ao buscar usuário:", erro);
    return null;
  }
}

async function cadastrarUsuario(novo) {
  // novo = { matricula, nome, ... }
  const resp = await fetch(SHEETBEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(novo),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Falha ao cadastrar no SheetBest (${resp.status}): ${txt}`);
  }
  return resp.json().catch(() => ({}));
}

// ===== Menus =====
function gerarMenuPrincipal(nome, isAdmin = false) {
  let menu =
    `Selecione o que deseja fazer:\n\n` +
    `1️⃣ Abrir chamado\n` +
    `2️⃣ Consultar chamados\n` +
    `3️⃣ Falar com atendente\n` +
    `4️⃣ Configurações\n`;

  if (isAdmin) menu += `5️⃣ Cadastrar usuário\n`;

  menu +=
    `0️⃣ Encerrar atendimento\n\n` +
    `(Digite o número da opção ou "menu" a qualquer momento.)`;

  return menu;
}

function gerarMenuConfiguracoes() {
  return (
    `⚙️ Configurações:\n\n` +
    `1️⃣ Atualizar meus dados\n` +
    `2️⃣ Voltar ao menu principal\n\n` +
    `(Digite o número da opção ou "menu" para voltar.)`
  );
}

// ===== Webhook principal =====
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    const userId = body.session || "default";
    const parametros = body.queryResult?.parameters || {};
    const textoBruto = (body.queryResult?.queryText || "").trim();
    const mensagem = textoBruto.toLowerCase();
    const matricula = parametros.matricula ? String(parametros.matricula).trim() : null;

    // Se não existe sessão ainda, pode ser login normal OU admin
    if (!usuarios.has(userId)) {
      // Entrada no modo admin (separado, sem “bypass” automático)
      if (mensagem === "admin") {
        usuarios.set(userId, {
          role: "admin",
          etapa: "admin_login",
          tentativasAdmin: 0,
        });
        return res.json({
          fulfillmentText: "🔐 Modo admin. Informe o PIN de administrador:",
        });
      }

      // Login normal por matrícula
      if (!matricula) {
        return res.json({
          fulfillmentText:
            "👋 Por favor, informe sua matrícula para continuar.\n(Se você for admin, digite: admin)",
        });
      }

      const usuario = await buscarUsuario(matricula);
      if (!usuario) {
        // Aqui a gente NÃO pede senha admin como fallback, para não virar porta dos fundos.
        return res.json({
          fulfillmentText:
            "❌ Matrícula não encontrada. Verifique e tente novamente.\nSe precisar cadastrar, peça para um administrador entrar com o comando: admin",
        });
      }

      usuarios.set(userId, { ...usuario, role: "user", etapa: "menu", chamados: [] });
      return res.json({
        fulfillmentText: `✅ Matrícula confirmada!\n${gerarMenuPrincipal(usuario.nome || "usuário")}`,
      });
    }

    const sessao = usuarios.get(userId);
    const isAdmin = sessao.role === "admin";
    const nome = sessao.nome || (isAdmin ? "admin" : "usuário");

    // Retornar ao menu principal
    if (mensagem === "menu") {
      sessao.etapa = "menu";
      return res.json({ fulfillmentText: gerarMenuPrincipal(nome, isAdmin) });
    }

    // Encerrar atendimento
    if (mensagem === "0") {
      usuarios.delete(userId);
      return res.json({ fulfillmentText: `👋 Atendimento encerrado. Até mais, ${nome}!` });
    }

    switch (sessao.etapa) {
      // ===== Login Admin =====
      case "admin_login": {
        if (!ADMIN_PIN_HASH) {
          usuarios.delete(userId);
          return res.json({
            fulfillmentText:
              "⚠️ Admin não configurado no servidor (ADMIN_PIN_HASH ausente).",
          });
        }

        sessao.tentativasAdmin = (sessao.tentativasAdmin || 0) + 1;
        if (sessao.tentativasAdmin > 5) {
          usuarios.delete(userId);
          return res.json({
            fulfillmentText: "⛔ Muitas tentativas. Sessão encerrada por segurança.",
          });
        }

        const ok = await bcrypt.compare(textoBruto, ADMIN_PIN_HASH);
        if (!ok) {
          return res.json({
            fulfillmentText: `❌ PIN incorreto. Tentativa ${sessao.tentativasAdmin}/5.`,
          });
        }

        // Admin autenticado
        sessao.etapa = "menu";
        sessao.chamados = [];
        return res.json({
          fulfillmentText: `✅ Admin autenticado!\n${gerarMenuPrincipal(nome, true)}`,
        });
      }

      // ===== Menu =====
      case "menu":
        if (mensagem === "1") {
          sessao.etapa = "abrir_chamado";
          return res.json({ fulfillmentText: "📝 Descreva o problema que deseja reportar." });
        }
        if (mensagem === "2") {
          sessao.etapa = "consultar_chamados";
          const qtd = (sessao.chamados || []).length;
          return res.json({
            fulfillmentText:
              qtd > 0
                ? `🔎 Você possui ${qtd} chamado(s) aberto(s).\nÚltimo: "${sessao.chamados[qtd - 1]}".\n(Digite 'menu' para voltar.)`
                : "📭 Você não possui chamados abertos.\n(Digite 'menu' para voltar.)",
          });
        }
        if (mensagem === "3") {
          sessao.etapa = "falar_atendente";
          return res.json({
            fulfillmentText: "👩‍💻 Ok, descreva o motivo para falar com um atendente humano.",
          });
        }
        if (mensagem === "4") {
          sessao.etapa = "config";
          return res.json({ fulfillmentText: gerarMenuConfiguracoes() });
        }

        // Opção admin: cadastrar usuário
        if (mensagem === "5" && isAdmin) {
          sessao.etapa = "cadastro_matricula";
          return res.json({
            fulfillmentText: "🆕 Cadastro: informe a matrícula do novo usuário:",
          });
        }

        return res.json({
          fulfillmentText: `⚠️ Opção inválida. Digite 1, 2, 3, 4${isAdmin ? ", 5" : ""} ou 0.`,
        });

      case "abrir_chamado":
        sessao.chamados = sessao.chamados || [];
        sessao.chamados.push(textoBruto);
        sessao.etapa = "menu";
        return res.json({
          fulfillmentText: `✅ Chamado aberto com sucesso!\nResumo: "${textoBruto}".\n\nUse 'menu' para voltar às opções.`,
        });

      case "falar_atendente":
        sessao.etapa = "menu";
        return res.json({
          fulfillmentText:
            `🤝 Encaminhando ao atendimento humano.\nMensagem: "${textoBruto}"\n\n(Digite 'menu' para voltar.)`,
        });

      case "config":
        if (mensagem === "1") {
          sessao.etapa = "atualizar_dados";
          return res.json({
            fulfillmentText: "✏️ Informe os novos dados que deseja atualizar (ex: telefone, e-mail).",
          });
        }
        if (mensagem === "2") {
          sessao.etapa = "menu";
          return res.json({ fulfillmentText: gerarMenuPrincipal(nome, isAdmin) });
        }
        return res.json({ fulfillmentText: "⚠️ Opção inválida. Digite 1 ou 2." });

      case "atualizar_dados":
        sessao.etapa = "menu";
        return res.json({
          fulfillmentText: `✅ Dados atualizados com sucesso!\nNovo valor: "${textoBruto}".\n\nUse 'menu' para voltar às opções.`,
        });

      // ===== Fluxo de cadastro (admin) =====
      case "cadastro_matricula": {
        if (!isAdmin) {
          sessao.etapa = "menu";
          return res.json({ fulfillmentText: "⛔ Ação restrita ao administrador." });
        }

        const mat = textoBruto.trim();
        if (!mat) {
          return res.json({ fulfillmentText: "⚠️ Matrícula inválida. Informe novamente:" });
        }

        const existente = await buscarUsuario(mat);
        if (existente) {
          sessao.etapa = "menu";
          return res.json({
            fulfillmentText:
              `⚠️ Essa matrícula já existe (${existente.nome || "sem nome"}).\n${gerarMenuPrincipal(nome, true)}`,
          });
        }

        sessao.novoUsuario = { matricula: mat };
        sessao.etapa = "cadastro_nome";
        return res.json({ fulfillmentText: "✅ Agora informe o nome do usuário:" });
      }

      case "cadastro_nome": {
        if (!isAdmin) {
          sessao.etapa = "menu";
          return res.json({ fulfillmentText: "⛔ Ação restrita ao administrador." });
        }

        const nomeNovo = textoBruto.trim();
        if (!nomeNovo) {
          return res.json({ fulfillmentText: "⚠️ Nome inválido. Informe novamente:" });
        }

        sessao.novoUsuario.nome = nomeNovo;

        // Se quiser coletar mais campos (email, telefone etc.), adicione etapas aqui.
        await cadastrarUsuario(sessao.novoUsuario);

        sessao.novoUsuario = null;
        sessao.etapa = "menu";
        return res.json({
          fulfillmentText: `🎉 Usuário cadastrado com sucesso!\n${gerarMenuPrincipal(nome, true)}`,
        });
      }

      default:
        sessao.etapa = "menu";
        return res.json({ fulfillmentText: gerarMenuPrincipal(nome, isAdmin) });
    }
  } catch (erro) {
    console.error("Erro no webhook:", erro);
    return res.json({
      fulfillmentText: "⚠️ Ocorreu um erro no atendimento. Tente novamente mais tarde.",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor FerreroHelp rodando na porta ${PORT}`));

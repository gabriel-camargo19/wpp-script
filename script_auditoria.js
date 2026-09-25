(() => {
  const FIRESTORE_PROJECT_ID = "cofre-wpp";
  const COLLECTION_CONVERSAS = "conversas_completas";
  const COLLECTION_STATUS = "status_operadores";

  let timeoutInatividade = null;
  let contactoAtual = "";

  // 1. Identificação do Operador
  function obterOuPedirNomeOperador() {
    let op = localStorage.getItem("auditoria_nome_operador");
    if (!op || !op.trim()) {
      op = prompt("Digite o nome do operador responsável por esta máquina:");
      if (!op || !op.trim()) {
        op = "Operador Padrão";
      } else {
        op = op.trim();
        localStorage.setItem("auditoria_nome_operador", op);
      }
    }
    return op;
  }

  let nomeOperador = obterOuPedirNomeOperador();

  function obterDataHoje() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function extrairNomeContato() {
    const painelChat = document.querySelector("#main");
    if (!painelChat) return "";

    const headerSpans = painelChat.querySelectorAll("header span[dir='auto'], header [title]");
    for (const el of headerSpans) {
      const texto = (el.getAttribute("title") || el.innerText || "").trim();
      if (
        texto && 
        texto !== "Dados do perfil" && 
        !texto.includes("online") && 
        !texto.includes("visto por último") &&
        !texto.includes("digitando...")
      ) {
        return texto;
      }
    }
    return "";
  }

  function extrairMensagensAtivas() {
    const painelChat = document.querySelector("#main");
    if (!painelChat) return null;

    const contacto = extrairNomeContato();
    if (!contacto) return null;

    const linhas = painelChat.querySelectorAll("div[role='row'], div[data-id]");
    const mensagens = [];

    linhas.forEach(linhaEl => {
      const dataId = linhaEl.getAttribute("data-id") || "";
      const classList = linhaEl.className || "";
      const ehOperador = dataId.startsWith("true_") || classList.includes("message-out") || !!linhaEl.querySelector("[data-icon='msg-check'], [data-icon='msg-dblcheck']");
      const remetente = ehOperador ? `[${nomeOperador}]` : `[CLIENTE]`;

      const textSpan = linhaEl.querySelector(".selectable-text");
      if (textSpan && textSpan.innerText && textSpan.innerText.trim()) {
        const copyable = linhaEl.querySelector(".copyable-text");
        const timestampWpp = copyable ? copyable.getAttribute("data-pre-plain-text") : "";
        const texto = textSpan.innerText.trim();
        
        if (texto.includes("criptografia de ponta a ponta")) return;

        const linhaFormatada = timestampWpp ? `${timestampWpp.trim()} ${texto}` : `${remetente}: ${texto}`;
        if (!mensagens.includes(linhaFormatada)) mensagens.push(linhaFormatada);
        return;
      }

      if (linhaEl.querySelector("audio, [data-icon='audio-play'], [data-icon='ptt-play']")) {
        const duracaoEl = linhaEl.querySelector("span[data-testid='audio-duration']");
        const duracao = duracaoEl ? duracaoEl.innerText.trim() : "Áudio";
        const linhaAudio = `${remetente} 🎙️ [ÁUDIO (${duracao})]`;
        if (!mensagens.includes(linhaAudio)) mensagens.push(linhaAudio);
      }
    });

    return { contacto, mensagens };
  }

  // Envio de Histórico de Conversa
  async function enviarParaFirestore(dados, dadosOcorrencia = null) {
    if (!dados || !dados.contacto || dados.mensagens.length === 0) return false;

    const agora = new Date();
    const horaRegistro = agora.toLocaleTimeString("pt-BR");
    const safeContact = encodeURIComponent(dados.contacto.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 25));
    const safeOperador = encodeURIComponent(nomeOperador.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 15));
    
    const docId = `${safeContact}_${safeOperador}_${obterDataHoje()}_${Date.now()}`;
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/${COLLECTION_CONVERSAS}/${docId}`;

    const fields = {
      cliente: { stringValue: dados.contacto },
      operador_responsavel: { stringValue: nomeOperador },
      total_mensagens: { integerValue: dados.mensagens.length },
      ultima_sincronizacao: { stringValue: `${obterDataHoje()} ${horaRegistro}` },
      dataAuditoria: { stringValue: obterDataHoje() },
      horarioRegistro: { stringValue: horaRegistro },
      historico_conversa: {
        arrayValue: {
          values: dados.mensagens.map(m => ({ stringValue: m }))
        }
      }
    };

    if (dadosOcorrencia) {
      fields.tabulacao = { stringValue: dadosOcorrencia.tabulacao };
      fields.resumo_atendimento = { stringValue: dadosOcorrencia.observacao };
    }

    const payload = { fields };

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: "enviarFirestore",
        url: url,
        method: "PATCH",
        docData: payload
      }, async (response) => {
        if (response && response.ok) {
          resolve(true);
        } else {
          try {
            const resDirect = await fetch(url, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            resolve(resDirect.ok);
          } catch (err) {
            resolve(false);
          }
        }
      });
    });
  }

  // --- HEARTBEAT: SINAL DE VIDA EM TEMPO REAL ---
  async function enviarHeartbeat(status = "online") {
    if (!nomeOperador) return;

    const safeOperadorId = encodeURIComponent(nomeOperador.replace(/[^a-zA-Z0-9]/g, "_"));
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/${COLLECTION_STATUS}/${safeOperadorId}`;
    
    const contatoAberto = extrairNomeContato() || "Nenhum chat aberto";
    const agora = new Date();

    const fields = {
      operador: { stringValue: nomeOperador },
      status: { stringValue: status },
      ultimo_sinal_timestamp: { integerValue: String(agora.getTime()) },
      ultimo_sinal_hora: { stringValue: agora.toLocaleTimeString("pt-BR") },
      data: { stringValue: obterDataHoje() },
      cliente_em_atendimento: { stringValue: contatoAberto }
    };

    const payload = { fields };

    try {
      await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      // Falha silenciosa para não incomodar o operador
    }
  }

  // Dispara o primeiro sinal de imediato e depois a cada 45 segundos
  enviarHeartbeat("online");
  setInterval(() => {
    enviarHeartbeat("online");
  }, 45000);

  // Sinal de offline ao fechar a janela/aba
  window.addEventListener("beforeunload", () => {
    enviarHeartbeat("offline");
  });

  // --- INJEÇÃO VISUAL NO WHATSAPP WEB ---
  function injetarControlesNoTopo() {
    const mainHeader = document.querySelector("#main header");
    if (!mainHeader) return;

    let container = document.getElementById("cofre-wpp-controles");
    if (!container) {
      container = document.createElement("div");
      container.id = "cofre-wpp-controles";
      container.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
        margin-right: 15px;
        z-index: 999;
      `;

      const badgeOp = document.createElement("div");
      badgeOp.id = "badge-operador-topo";
      badgeOp.title = "Clique para alterar o operador responsável nesta máquina";
      badgeOp.style.cssText = `
        background-color: #e0f2fe;
        color: #0369a1;
        border: 1px solid #bae6fd;
        padding: 5px 10px;
        border-radius: 16px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        user-select: none;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      `;
      badgeOp.innerText = `🟢 👤 ${nomeOperador}`;
      badgeOp.onclick = () => {
        const novoNome = prompt("Alterar operador responsável para:", nomeOperador);
        if (novoNome && novoNome.trim()) {
          nomeOperador = novoNome.trim();
          localStorage.setItem("auditoria_nome_operador", nomeOperador);
          badgeOp.innerText = `🟢 👤 ${nomeOperador}`;
          enviarHeartbeat("online");
        }
      };

      const btnOcorrencia = document.createElement("button");
      btnOcorrencia.id = "btn-registrar-ocorrencia";
      btnOcorrencia.innerText = "📝 Registrar Ocorrência";
      btnOcorrencia.style.cssText = `
        background-color: #00a884;
        color: #ffffff;
        border: none;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(0,0,0,0.15);
        transition: background 0.2s;
      `;
      btnOcorrencia.onmouseover = () => btnOcorrencia.style.backgroundColor = "#008069";
      btnOcorrencia.onmouseout = () => btnOcorrencia.style.backgroundColor = "#00a884";
      btnOcorrencia.onclick = (e) => {
        e.stopPropagation();
        abrirModalRegistro();
      };

      container.appendChild(badgeOp);
      container.appendChild(btnOcorrencia);

      mainHeader.insertBefore(container, mainHeader.lastElementChild);
    } else {
      const badge = document.getElementById("badge-operador-topo");
      if (badge && badge.innerText !== `🟢 👤 ${nomeOperador}`) {
        badge.innerText = `🟢 👤 ${nomeOperador}`;
      }
    }
  }

  function abrirModalRegistro() {
    if (document.getElementById("modal-ocorrencia-wpp")) return;

    const contacto = extrairNomeContato();
    const modal = document.createElement("div");
    modal.id = "modal-ocorrencia-wpp";
    modal.style.cssText = `
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
      z-index: 99999; font-family: sans-serif;
    `;

    modal.innerHTML = `
      <div style="background:#fff; width: 440px; border-radius: 8px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
        <h3 style="margin-top:0; color:#008069; font-size:16px;">📝 Registrar Resumo do Atendimento</h3>
        <p style="font-size:13px; color:#54656f; margin-bottom:12px;">Cliente: <strong>${contacto}</strong> | Operador: <strong>${nomeOperador}</strong></p>
        
        <label style="font-size:12px; font-weight:600; color:#3b4a54; display:block; margin-bottom:4px;">Motivo / Tabulação:</label>
        <select id="modal-tabulacao" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:12px; font-size:13px;">
          <option value="Acordo / Negociação Concluída">Acordo / Negociação Concluída</option>
          <option value="Cliente Interessado / Retorno Agendado">Cliente Interessado / Retorno Agendado</option>
          <option value="Sem Resposta / Aguardando">Sem Resposta / Aguardando</option>
          <option value="Cliente Recusou Proposta">Cliente Recusou Proposta</option>
          <option value="Número Errado / Terceiro">Número Errado / Terceiro</option>
          <option value="Outros">Outros</option>
        </select>

        <label style="font-size:12px; font-weight:600; color:#3b4a54; display:block; margin-bottom:4px;">Observações do Atendimento:</label>
        <textarea id="modal-obs" placeholder="Descreva brevemente o que foi alinhado..." style="width:100%; height:80px; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; box-sizing:border-box; resize:none;"></textarea>

        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
          <button id="modal-cancelar" style="background:#e2e8f0; border:none; padding:8px 14px; border-radius:6px; font-weight:600; cursor:pointer;">Cancelar</button>
          <button id="modal-salvar" style="background:#008069; color:#fff; border:none; padding:8px 14px; border-radius:6px; font-weight:600; cursor:pointer;">💾 Salvar Resumo</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("modal-cancelar").onclick = () => modal.remove();
    
    document.getElementById("modal-salvar").onclick = async () => {
      const btnSalvar = document.getElementById("modal-salvar");
      btnSalvar.disabled = true;
      btnSalvar.innerText = "Salvando...";

      const tabulacao = document.getElementById("modal-tabulacao").value;
      const observacao = document.getElementById("modal-obs").value.trim();

      const dadosChat = extrairMensagensAtivas();
      if (!dadosChat || dadosChat.mensagens.length === 0) {
        alert("Atenção: Nenhuma mensagem detectada nesta conversa para salvar.");
        btnSalvar.disabled = false;
        btnSalvar.innerText = "💾 Salvar Resumo";
        return;
      }

      const sucesso = await enviarParaFirestore(dadosChat, { tabulacao, observacao });
      modal.remove();

      if (sucesso) {
        alert("✅ Atendimento e tabulação salvos com sucesso no banco!");
      } else {
        alert("⚠️ Ocorreu um erro ao salvar no Firebase.");
      }
    };
  }

  const observer = new MutationObserver(() => {
    injetarControlesNoTopo();

    const nomeAberto = extrairNomeContato();
    if (nomeAberto && nomeAberto !== contactoAtual) {
      if (contactoAtual) {
        const dadosAnteriores = extrairMensagensAtivas();
        enviarParaFirestore(dadosAnteriores);
      }
      contactoAtual = nomeAberto;
      enviarHeartbeat("online");
    }

    clearTimeout(timeoutInatividade);
    timeoutInatividade = setTimeout(() => {
      const dados = extrairMensagensAtivas();
      enviarParaFirestore(dados);
    }, 12000);
  });

  const appEl = document.getElementById("app") || document.body;
  if (appEl) {
    observer.observe(appEl, { childList: true, subtree: true });
  }
})();

// Identificação automática por máquina
let NOME_OPERADOR = localStorage.getItem("OPERADOR_NOME");
if (!NOME_OPERADOR) {
  NOME_OPERADOR = prompt("Identificação do Operador (Digite seu nome ou matrícula):");
  if (NOME_OPERADOR) {
    localStorage.setItem("OPERADOR_NOME", NOME_OPERADOR.trim());
  } else {
    NOME_OPERADOR = "Operador_Nao_Identificado";
  }
}

const BASE_FIRESTORE_URL = "https://firestore.googleapis.com/v1/projects/cofre-wpp/databases/(default)/documents/conversas_completas";

function obterIdentificadorCliente() {
  try {
    const headerTitle = document.querySelector('header [role="button"] span[title]');
    if (headerTitle) {
      const title = headerTitle.getAttribute('title');
      const lower = (title || '').toLowerCase();
      if (title && !lower.includes('clique') && !lower.includes('visto por último') && lower !== 'online') {
        return title;
      }
    }

    const mainHeader = document.querySelector('#main header');
    if (mainHeader) {
      const spans = mainHeader.querySelectorAll('span[dir="auto"]');
      for (const span of spans) {
        const txt = span.innerText || '';
        const lower = txt.toLowerCase();
        if (txt && !lower.includes('clique') && !lower.includes('visto por último') && lower !== 'online' && !lower.includes('digitando')) {
          return txt;
        }
      }
    }
  } catch (e) {}

  return "Desconhecido";
}

let sincronizando = false;

async function sincronizarConversaCompleta() {
  if (sincronizando) return;
  sincronizando = true;

  try {
    const cliente = obterIdentificadorCliente();
    if (cliente === "Desconhecido") {
      sincronizando = false;
      return;
    }

    const containerChat = document.querySelector('#main');
    if (!containerChat) {
      sincronizando = false;
      return;
    }

    const baloes = containerChat.querySelectorAll('div[data-id]');
    if (baloes.length === 0) {
      sincronizando = false;
      return;
    }

    const listaFormatada = [];
    const mensagensProcessadas = new Set();

    baloes.forEach(balao => {
      const elemTexto = balao.querySelector('.selectable-text span') || 
                        balao.querySelector('.selectable-text') || 
                        balao.querySelector('.copyable-text') || 
                        balao.querySelector('span[dir="ltr"]') || 
                        balao.querySelector('span[dir="auto"]');

      let texto = elemTexto ? (elemTexto.innerText || '') : '';

      if (texto && texto.trim().length > 0 && !/^\d{1,2}:\d{2}$/.test(texto.trim())) {
        // Marcador estrutural nativo do WhatsApp (status de envio)
        const isOperador = !!(
          balao.querySelector('span[data-icon*="check"]') ||
          balao.querySelector('span[data-icon*="time"]') ||
          balao.querySelector('[aria-label*="Lida"]') ||
          balao.querySelector('[aria-label*="Entregue"]') ||
          balao.querySelector('[aria-label*="Enviada"]') ||
          balao.querySelector('[data-icon="msg-time"]') ||
          balao.querySelector('[data-icon="msg-dblcheck"]')
        );

        const autor = isOperador ? 'OPERADOR' : 'CLIENTE';

        const chaveUnica = `${balao.getAttribute('data-id')}_${texto.trim()}`;
        if (!mensagensProcessadas.has(chaveUnica)) {
          mensagensProcessadas.add(chaveUnica);
          listaFormatada.push({
            stringValue: `[${autor}]: ${texto.trim()}`
          });
        }
      }
    });

    if (listaFormatada.length > 0) {
      const idLimpo = `${NOME_OPERADOR}_${cliente}`.replace(/[\/\\#? ]/g, '_').trim();
      const clienteDocId = encodeURIComponent(idLimpo || 'Desconhecido');
      const urlDoc = `${BASE_FIRESTORE_URL}/${clienteDocId}`;

      const payload = {
        fields: {
          cliente: { stringValue: cliente },
          operador_responsavel: { stringValue: NOME_OPERADOR },
          ultima_sincronizacao: { timestampValue: new Date().toISOString() },
          total_mensagens: { integerValue: listaFormatada.length.toString() },
          historico_conversa: {
            arrayValue: {
              values: listaFormatada
            }
          }
        }
      };

      await fetch(urlDoc, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
  } catch (err) {
  } finally {
    sincronizando = false;
  }
}

const observer = new MutationObserver(() => {
  sincronizarConversaCompleta();
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
}

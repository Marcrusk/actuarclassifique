(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ExternalRequests = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /* ==========================================================================
       SOLICITAÇÕES EXTERNAS — CICLO DE VIDA
       O que entra pelo Portal de Prioridades não é uma prioridade ainda: é um pedido.
       Vira prioridade quando a gestão tria e distribui pelo rodízio. Este módulo guarda
       os estados e as transições possíveis; a tela só desenha o que ele permite.

       As etapas são as do processo real que hoje acontece por mensagem — alguém avisa, o
       gestor interpreta, procura o analista, encaminha e cobra retorno. Cada passo daquele
       vira um estado aqui, para parar de existir só na cabeça das pessoas.
       ========================================================================== */

    /* UMA COR POR ETAPA, na ordem em que o chamado anda: azul chegou, índigo a gestão olha,
       âmbar espera o solicitante, teal está pronta e espera a fila, violeta o analista está
       nela, laranja espera o cliente, rosa espera a gestão de novo, verde acabou.

       Antes as oito dividiam quatro tons — três eram `primary` e três `warning` —, então a
       cor não distinguia nada: a coluna dizia o nome, o cartão repetia, e achar onde um
       chamado estava exigia ler. O tom é nome de token, nunca cor: quem muda a paleta muda
       em um lugar. */
    const STAGES = Object.freeze([
        Object.freeze({ id: 'nova', label: 'Novas solicitações', hint: 'Chegaram do portal e ninguém olhou ainda.', tone: 'info' }),
        Object.freeze({ id: 'triagem', label: 'Em triagem', hint: 'A gestão está avaliando o pedido.', tone: 'primary' }),
        Object.freeze({ id: 'aguardando_info', label: 'Aguardando informação', hint: 'Devolvidas a quem registrou, à espera de complemento.', tone: 'warning' }),
        Object.freeze({ id: 'aguardando_distribuicao', label: 'Aguardando distribuição', hint: 'Validadas, esperando o rodízio liberar um analista.', tone: 'teal' }),
        Object.freeze({ id: 'em_atendimento', label: 'Em atendimento', hint: 'Com o analista, em execução.', tone: 'violet' }),
        /* Parado esperando o CLIENTE, não a equipe. Sem uma etapa própria, esse caso ficava
           indistinguível de "em atendimento" — e um chamado sem resposta há dias parecia
           trabalho em andamento, cobrando o analista por algo que não depende dele. */
        Object.freeze({ id: 'sem_retorno', label: 'Sem retorno do cliente', hint: 'O analista tentou contato e o cliente não respondeu.', tone: 'orange' }),
        /* Rosa, e não âmbar: das quatro esperas do quadro, esta é a única que depende da
           GESTÃO. Com o mesmo tom das outras três, "quem está me devendo" só se descobria
           lendo o rótulo de cada coluna. */
        Object.freeze({ id: 'aguardando_aprovacao', label: 'Aguardando aprovação', hint: 'Concluídas pelo analista, à espera da gestão.', tone: 'pink' }),
        Object.freeze({ id: 'concluida', label: 'Concluídas', hint: 'Aprovadas e pontuadas.', tone: 'success' })
    ]);

    /* Encerramentos. Não viram coluna: um quadro com uma coluna por exceção fica ilegível,
       e essas saem do fluxo em vez de avançar nele. Aparecem por filtro. */
    const CLOSED = Object.freeze({
        rejeitada: Object.freeze({ label: 'Rejeitada', tone: 'danger', hint: 'A gestão avaliou e não é prioridade.' }),
        duplicada: Object.freeze({ label: 'Duplicada', tone: 'neutral', hint: 'Já existe outra solicitação para o mesmo caso.' }),
        cancelada: Object.freeze({ label: 'Cancelada', tone: 'neutral', hint: 'Encerrada sem atendimento.' })
    });

    const STAGE_IDS = Object.freeze(STAGES.map(item => item.id));

    function stageMeta(id) {
        return STAGES.find(item => item.id === id)
            || (CLOSED[id] ? { id, ...CLOSED[id] } : { id, label: String(id || 'Sem etapa'), hint: '', tone: 'neutral' });
    }

    function isClosed(status) { return Object.prototype.hasOwnProperty.call(CLOSED, status); }

    /* A ÁREA QUE ABRIU, DENTRO DO PRÓPRIO CHAMADO
       "Aguardando informação" existe para devolver a solicitação a quem registrou — mas
       quem registrou não tinha tela nenhuma, então a devolução dependia de alguém avisar
       por fora e a solicitação ficava parada.

       O que a área pode fazer é deliberadamente pequeno: responder o complemento que a
       gestão pediu, e desistir de um chamado que ela mesma abriu por engano. Nada disso
       decide prioridade, ordem ou pontuação — isso continua sendo da gestão. */
    function belongsToArea(request, areaName) {
        const alvo = String(areaName || '').trim().toLocaleLowerCase('pt-BR');
        return Boolean(alvo) && String(request?.requesterDepartment || '').trim().toLocaleLowerCase('pt-BR') === alvo;
    }

    function canAreaRespond(request) { return stageOf(request) === 'aguardando_info'; }

    /* Cancelar só enquanto ninguém pegou o chamado. Depois que o analista está em
       atendimento, desistir por fora deixaria a vez dele no rodízio pendurada num caso que
       sumiu — quem encerra dali para a frente é a gestão, pelo painel dela. */
    const AREA_CANCELABLE_STAGES = Object.freeze(['nova', 'triagem', 'aguardando_info', 'aguardando_distribuicao']);
    function canAreaCancel(request) { return AREA_CANCELABLE_STAGES.includes(stageOf(request)); }

    function list(store) {
        return Array.isArray(store?.externalRequests) ? store.externalRequests : [];
    }

    /* O portal grava 'aguardando_triagem'. Traduzir aqui, e não no portal, mantém a porta
       externa ignorante do vocabulário interno do quadro. */
    function stageOf(request) {
        const status = request?.status === 'aguardando_triagem' ? 'nova' : request?.status;
        return STAGE_IDS.includes(status) || isClosed(status) ? status : 'nova';
    }

    function board(requests, filtro = {}) {
        const linhas = (Array.isArray(requests) ? requests : []).filter(item => {
            if (filtro.team && filtro.team !== 'Todos' && item.team !== filtro.team) return false;
            if (filtro.brand && filtro.brand !== 'Todas' && item.brand !== filtro.brand) return false;
            return true;
        });
        const colunas = STAGES.map(etapa => ({
            ...etapa,
            // Mais antigo primeiro: numa fila, quem espera há mais tempo aparece no topo.
            items: linhas.filter(item => stageOf(item) === etapa.id).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
        }));
        const encerradas = linhas.filter(item => isClosed(stageOf(item)))
            .sort((a, b) => Number(b.closedAt || b.createdAt || 0) - Number(a.closedAt || a.createdAt || 0));
        return { stages: colunas, closed: encerradas, total: linhas.length };
    }

    /* Duplicidade: mesmo cliente com pedido ainda aberto. Comparar por ID do cliente e por
       telefone cobre quem digitou o ID errado mas o contato certo — e o inverso. */
    function duplicatesOf(request, requests) {
        const idAlvo = String(request?.clientId || '').trim().toUpperCase();
        const foneAlvo = String(request?.phone || '').replace(/\D/g, '');
        return (Array.isArray(requests) ? requests : []).filter(outro => {
            if (!outro || outro.id === request?.id) return false;
            if (isClosed(stageOf(outro))) return false;
            const mesmoId = idAlvo && String(outro.clientId || '').trim().toUpperCase() === idAlvo;
            const mesmoFone = foneAlvo && String(outro.phone || '').replace(/\D/g, '') === foneAlvo;
            return mesmoId || mesmoFone;
        });
    }

    function event(type, actorId, text, timestamp) {
        return { type, at: timestamp, by: actorId || 'Gestão', text };
    }

    function assert(condition, message) {
        if (!condition) { const erro = new Error(message); erro.code = 'invalid_operation'; throw erro; }
    }

    /* Toda transição passa por aqui: um lugar só para registrar quem fez, quando e por quê.
       Sem isso, cada tela inventaria o próprio jeito de mexer no status e o histórico
       ficaria cheio de buracos. */
    function transition(request, proximo, options = {}) {
        assert(request && typeof request === 'object', 'Solicitação inválida.');
        assert(STAGE_IDS.includes(proximo) || isClosed(proximo), `Etapa desconhecida: ${proximo}`);
        const agora = options.now || Date.now();
        const anterior = stageOf(request);
        assert(anterior !== proximo, 'A solicitação já está nesta etapa.');
        if (options.reasonRequired) {
            assert(String(options.reason || '').trim().length >= 3, 'Informe o motivo desta decisão.');
        }
        const proximoRegistro = JSON.parse(JSON.stringify(request));
        proximoRegistro.status = proximo;
        proximoRegistro.updatedAt = agora;
        if (isClosed(proximo)) proximoRegistro.closedAt = agora;
        if (options.reason) proximoRegistro.lastReason = String(options.reason).trim();
        if (options.patch) Object.assign(proximoRegistro, options.patch);
        proximoRegistro.events = [
            ...(request.events || []),
            event(proximo, options.actorName, options.text || `${stageMeta(anterior).label} → ${stageMeta(proximo).label}${options.reason ? `: ${String(options.reason).trim()}` : ''}`, agora)
        ];
        return proximoRegistro;
    }

    /* Exclusão auditada, mesma régua de peças e lançamentos. Uma solicitação já concluída
       arrasta o lançamento de prioridade que ela gerou e os pontos dele: apagar só o card
       deixaria a pontuação de um atendimento que não existe mais. */
    function deletionEntry(request, actorId, reason, options = {}) {
        assert(request && request.id, 'Solicitação inválida.');
        assert(String(actorId || '').trim(), 'Usuário responsável não identificado.');
        assert(String(reason || '').trim().length >= 3, 'Informe o motivo da exclusão.');
        const logs = Array.isArray(options.removedLogs) ? options.removedLogs : [];
        return {
            id: request.id,
            protocol: request.protocol || '',
            clientName: request.clientName || '',
            clientId: request.clientId || '',
            team: request.team || '',
            requesterDepartment: request.requesterDepartment || '',
            stage: stageOf(request),
            deletedBy: actorId,
            deletedAt: options.now || Date.now(),
            reason: String(reason).trim(),
            removedPoints: logs.reduce((soma, log) => soma + Number(log.value || 0), 0),
            removedLogIds: logs.map(log => log.id),
            priorityRequestId: request.priorityRequestId || null,
            record: JSON.parse(JSON.stringify(request))
        };
    }

    // Resumo para o topo do quadro: o que está esperando alguém, e há quanto tempo.
    function summarize(requests, now = Date.now()) {
        const linhas = Array.isArray(requests) ? requests : [];
        const abertas = linhas.filter(item => !isClosed(stageOf(item)));
        const novas = linhas.filter(item => stageOf(item) === 'nova');
        const esperas = novas.map(item => now - Number(item.createdAt || now));
        return {
            total: linhas.length,
            abertas: abertas.length,
            novas: novas.length,
            emAtendimento: linhas.filter(item => stageOf(item) === 'em_atendimento').length,
            esperaMaisLonga: esperas.length ? Math.max(...esperas) : 0
        };
    }

    return { STAGES, STAGE_IDS, CLOSED, stageMeta, stageOf, isClosed, list, board, duplicatesOf, transition, deletionEntry, summarize,
        AREA_CANCELABLE_STAGES, belongsToArea, canAreaRespond, canAreaCancel };
});

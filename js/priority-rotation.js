(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PriorityRotation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const ROTATION_STATUS = Object.freeze({ ACTIVE: 'active', PAUSED: 'paused' });
    const PARTICIPANT_STATUS = Object.freeze({ ACTIVE: 'active', PAUSED: 'paused', UNAVAILABLE: 'unavailable', OUTSIDE: 'outside' });
    const ATTENDANCE_STATUS = Object.freeze({ IN_PROGRESS: 'in_progress', COMPLETED: 'completed', CANCELLED: 'cancelled' });

    /* Um status, um significado. O rótulo e a cor viviam duplicados nas telas: a gestão
       mostrava "Aguardando aprovação" e o analista "Pendente" para o mesmo estado, com
       paletas próprias — e "precisa de ajuste" usava o mesmo âmbar de "aguardando", os dois
       casos que mais importa distinguir (um espera a gestão, o outro espera o analista).
       Aqui fica a fonte única; a tela só pinta o que o domínio diz.
       O tom é nome de token do Design System, não cor: quem muda a paleta muda em um lugar. */
    const REQUEST_STATUS_META = Object.freeze({
        pendente: Object.freeze({ label: 'Aguardando aprovação', short: 'Aguardando', tone: 'warning', icon: 'fi-rr-clock', waitingOn: 'gestão' }),
        aprovado: Object.freeze({ label: 'Aprovado', short: 'Aprovado', tone: 'success', icon: 'fi-rr-check-circle', waitingOn: null }),
        reprovado: Object.freeze({ label: 'Reprovado', short: 'Reprovado', tone: 'danger', icon: 'fi-rr-cross-circle', waitingOn: null }),
        ajuste_solicitado: Object.freeze({ label: 'Precisa de ajuste', short: 'Ajuste', tone: 'primary', icon: 'fi-rr-edit', waitingOn: 'analista' })
    });

    /* MARCAS ATENDIDAS
       O Portal de Prioridades já pergunta "Cliente de qual marca?" e oferece estas quatro,
       escritas à mão no HTML dele. O encaminhamento interno não perguntava nada: o mesmo
       atendimento chegava identificado pelo portal e anônimo pelo despacho da gestão.
       A lista passa a viver aqui, onde o briefing é validado — e um teste guarda que as
       quatro do portal continuam sendo estas. */
    const BRANDS = Object.freeze(['Actuar', 'Ediz', 'Toletus', 'Fácil Fit']);

    /* FICHA DO ATENDIMENTO
       O atendimento prioritário só registrava protocolo e justificativa — dois campos de
       uma linha. Tudo o que aconteceu entre receber o cliente e encerrar (quantas vezes se
       tentou falar com ele, o que se descobriu no caminho, se resolveu e como) não tinha
       onde ser escrito. A gestão então aprovava 50 pontos sabendo apenas o número do
       protocolo, e o manual pedia "até 3 tentativas de contato" numa regra que nenhuma tela
       conseguia cumprir nem conferir.

       Canal e resultado são fechados de propósito: é o que permite CONTAR tentativas. Uma
       nota livre por tentativa continua existindo, para o que a lista não prevê. */
    const CONTACT_CHANNEL = Object.freeze({ CALL: 'call', WHATSAPP: 'whatsapp', EMAIL: 'email' });
    const CONTACT_RESULT = Object.freeze({ ANSWERED: 'answered', NO_ANSWER: 'no_answer' });
    const CONTACT_CHANNEL_LABEL = Object.freeze({ call: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail' });
    const CONTACT_RESULT_LABEL = Object.freeze({ answered: 'Falou com o cliente', no_answer: 'Sem resposta' });

    /* Resolvido responde COMO; não resolvido responde POR QUÊ. São duas perguntas
       diferentes, e é por isso que a lista de motivos depende do desfecho: oferecer as oito
       juntas deixaria "sem retorno do cliente" disponível para quem acabou de resolver. */
    const RESOLUTION = Object.freeze({ RESOLVED: 'resolved', UNRESOLVED: 'unresolved' });
    const RESOLUTION_REASONS = Object.freeze({
        resolved: Object.freeze(['guidance', 'fix_applied', 'part_dispatched', 'forwarded']),
        unresolved: Object.freeze(['no_answer', 'third_party', 'out_of_scope', 'rescheduled'])
    });
    const RESOLUTION_LABEL = Object.freeze({ resolved: 'Resolvido', unresolved: 'Não resolvido' });
    const RESOLUTION_REASON_LABEL = Object.freeze({
        guidance: 'Orientação ao cliente',
        fix_applied: 'Correção aplicada',
        part_dispatched: 'Peça enviada ou coletada',
        forwarded: 'Encaminhado a outra área',
        no_answer: 'Sem retorno do cliente',
        third_party: 'Depende de terceiro',
        out_of_scope: 'Fora do escopo do atendimento',
        rescheduled: 'Reagendado com o cliente'
    });

    /* A regra vem do manual ("Clientes sem retorno devem receber até 3 tentativas de
       contato durante a semana") e até agora vivia só como texto. Aqui ela vira condição:
       dar o cliente como sem retorno exige as três tentativas registradas. Vale só para
       este motivo — os outros sete não dependem de ter ligado para ninguém. */
    const NO_ANSWER_MIN_ATTEMPTS = 3;
    const RESOLUTION_DETAIL_MIN = 10;

    /* EXCLUSÃO AUDITADA DE LANÇAMENTO
       Mesma régua das peças: apagar a prioridade sem tirar os pontos mantém exatamente o
       erro que a exclusão existe para desfazer — um lançamento de teste que pontuou alguém.
       E apagar sem rastro impede conferir depois quem tirou o quê. Por isso a exclusão
       devolve um registro completo: snapshot, autor, motivo e pontos estornados.
       Prioridade credita por PRIORITY e pode ter PRIORITY_ADJUSTMENT em cima; os dois saem
       juntos, senão o extrato fica com um ajuste sobre algo que não existe mais. */
    const PRIORITY_LOG_TYPES = Object.freeze(['PRIORITY', 'PRIORITY_ADJUSTMENT']);

    function pointLogsOf(logs, requestId) {
        return (Array.isArray(logs) ? logs : [])
            .filter(log => log && PRIORITY_LOG_TYPES.includes(log.type) && log.relatedRequestId === requestId);
    }

    function deletionEntry(request, actorId, reason, removedLogs, timestamp = Date.now()) {
        assert(request && request.id, 'Lançamento inválido.');
        assert(String(actorId || '').trim(), 'Usuário responsável não identificado.');
        assert(String(reason || '').trim().length >= 3, 'Informe o motivo da exclusão.');
        const logs = Array.isArray(removedLogs) ? removedLogs : [];
        return {
            id: request.id,
            protocol: request.protocolo || '',
            analystId: request.userId || null,
            team: request.team || request.rotationTeam || '',
            status: request.status || '',
            deletedBy: actorId,
            deletedAt: timestamp,
            reason: String(reason).trim(),
            removedPoints: logs.reduce((soma, log) => soma + Number(log.value || 0), 0),
            removedLogIds: logs.map(log => log.id),
            record: clone(request)
        };
    }

    function statusMeta(status) {
        return REQUEST_STATUS_META[status]
            || { label: String(status || 'Sem status'), short: 'Sem status', tone: 'neutral', icon: 'fi-rr-interrogation', waitingOn: null };
    }

    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function rotationId(team) { return `priority-${String(team || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`; }
    function assert(condition, message, code = 'invalid_operation') {
        if (!condition) { const error = new Error(message); error.code = code; throw error; }
    }
    function requiredReason(reason) {
        assert(String(reason || '').trim().length >= 3, 'Informe uma justificativa para continuar.', 'reason_required');
        return String(reason).trim();
    }
    function event(type, rotation, options = {}) {
        return {
            id: options.id || `evt-${options.now}-${Math.random().toString(36).slice(2, 8)}`,
            type,
            rotationId: rotation.id,
            team: rotation.team,
            analystId: options.analystId || null,
            actorId: options.actorId || null,
            reason: options.reason || null,
            relatedPriorityId: options.relatedPriorityId || null,
            previousState: options.previousState || null,
            nextState: options.nextState || null,
            timestamp: options.now
        };
    }
    function appendEvents(rotation, events) {
        rotation.events = [...(rotation.events || []), ...events];
        rotation.version = Number(rotation.version || 0) + 1;
        rotation.updatedAt = events[events.length - 1]?.timestamp || rotation.updatedAt;
        return rotation;
    }

    function create(team, analystIds, now = Date.now()) {
        const queue = [...new Set((analystIds || []).filter(Boolean))];
        const participants = {};
        queue.forEach((id, index) => { participants[id] = { userId: id, position: index + 1, status: PARTICIPANT_STATUS.ACTIVE, enabled: true, joinedAt: now }; });
        return {
            id: rotationId(team), team, status: ROTATION_STATUS.ACTIVE, version: 1,
            queue, participants, current: null, lastCompleted: null, events: [], createdAt: now, updatedAt: now
        };
    }

    function normalizePositions(rotation) {
        rotation.queue.forEach((id, index) => {
            if (!rotation.participants[id]) rotation.participants[id] = { userId: id, joinedAt: rotation.updatedAt };
            rotation.participants[id].position = index + 1;
            if (rotation.participants[id].status !== PARTICIPANT_STATUS.PAUSED) rotation.participants[id].status = PARTICIPANT_STATUS.ACTIVE;
            rotation.participants[id].enabled = true;
        });
        Object.values(rotation.participants).forEach(participant => {
            if (!rotation.queue.includes(participant.userId)) participant.position = null;
        });
        return rotation;
    }

    function syncParticipants(input, eligibleIds, now = Date.now()) {
        const rotation = clone(input);
        const eligible = [...new Set((eligibleIds || []).filter(Boolean))];
        rotation.participants ||= {};
        rotation.queue ||= [];
        eligible.forEach(id => {
            if (!rotation.participants[id]) rotation.participants[id] = { userId: id, status: PARTICIPANT_STATUS.ACTIVE, enabled: true, joinedAt: now };
            if (rotation.participants[id].status === PARTICIPANT_STATUS.OUTSIDE || rotation.participants[id].status === PARTICIPANT_STATUS.UNAVAILABLE) {
                rotation.participants[id].status = PARTICIPANT_STATUS.ACTIVE;
                rotation.participants[id].enabled = true;
            }
            if (rotation.participants[id].status === PARTICIPANT_STATUS.ACTIVE && !rotation.queue.includes(id)) rotation.queue.push(id);
        });
        Object.keys(rotation.participants).forEach(id => {
            if (!eligible.includes(id) && rotation.participants[id].status !== PARTICIPANT_STATUS.PAUSED) {
                rotation.participants[id].status = PARTICIPANT_STATUS.OUTSIDE;
                rotation.participants[id].enabled = false;
                rotation.queue = rotation.queue.filter(item => item !== id);
            }
        });
        rotation.queue = rotation.queue.filter(id => eligible.includes(id) && rotation.participants[id]?.status === PARTICIPANT_STATUS.ACTIVE);
        return normalizePositions(rotation);
    }

    /* ATENDIMENTOS SIMULTÂNEOS
       O rodízio guardava UM atendimento (`rotation.current`), e `assign` recusava com "Já
       existe um atendimento em andamento". Numa hora de pico isso trava a operação inteira:
       chegam vários chamados prioritários, e o segundo tem de esperar o primeiro acabar,
       mesmo havendo gente livre na fila.

       Agora são vários (`rotation.active`), um por analista. Quem já está com um chamado
       não recebe outro — o limite é por PESSOA, não pela equipe. */
    function activeList(rotation) {
        // Tolera as rotinas gravadas antes da concorrência, que têm `current` único.
        if (Array.isArray(rotation?.active)) return rotation.active;
        return rotation?.current ? [rotation.current] : [];
    }
    function activeOf(rotation, analystId) { return activeList(rotation).find(item => item.analystId === analystId) || null; }
    function isBusy(rotation, analystId) { return Boolean(activeOf(rotation, analystId)); }
    function attendanceById(rotation, attendanceId) { return activeList(rotation).find(item => item.id === attendanceId) || null; }

    /* Materializa a lista na escrita: quem grava depois disto grava no formato novo, e o
       `current` antigo some em vez de virar uma segunda fonte de verdade. */
    function withActive(rotation) {
        rotation.active = activeList(rotation).slice();
        delete rotation.current;
        return rotation;
    }
    function replaceActive(rotation, attendance) {
        rotation.active = activeList(rotation).map(item => (item.id === attendance.id ? attendance : item));
        return rotation;
    }
    function dropActive(rotation, attendanceId) {
        rotation.active = activeList(rotation).filter(item => item.id !== attendanceId);
        return rotation;
    }
    /* Concluir devolve a vez ao fim da fila. Sai aqui porque quatro caminhos fazem o mesmo
       movimento — concluir, cancelar, pular e pausar —, e um deles esquecer seria a fila
       parar de girar sem ninguém perceber. */
    function sendToBack(rotation, analystId) {
        rotation.queue = rotation.queue.filter(id => id !== analystId);
        if (rotation.participants[analystId]?.status === PARTICIPANT_STATUS.ACTIVE) rotation.queue.push(analystId);
        return rotation;
    }

    function nextId(rotation) {
        if (!rotation?.queue?.length) return null;
        /* Quem está atendendo continua na fila, na posição dele — só sai do caminho de um
           novo encaminhamento. Tirá-lo aqui adiantaria a vez sem ele ter concluído nada. */
        const ocupados = new Set(activeList(rotation).map(item => item.analystId));
        return rotation.queue.find(id => !ocupados.has(id)) || null;
    }

    function snapshot(rotation) {
        return { status: rotation.status, queue: [...rotation.queue], active: activeList(rotation).map(item => ({ ...item })), version: rotation.version };
    }

    function canManage(actor, team) {
        if (!actor || actor.active === false) return false;
        if (actor.role === 'administrator' || actor.allTeamsAccess === true) return true;
        if (!['manager', 'Gestor Adm'].includes(actor.role)) return false;
        // Mesmo padrão do restante da gestão: sem equipes declaradas, responde por todas.
        const configured = actor.managedTeams || actor.managedTeamCodes || [];
        return configured.length ? (configured.includes(team) || actor.team === team) : true;
    }

    function start(input, actorId, now = Date.now(), attendanceId = null) {
        const rotation = withActive(clone(input));
        assert(rotation.status === ROTATION_STATUS.ACTIVE, 'O rodízio está pausado.', 'rotation_paused');
        assert(!isBusy(rotation, actorId), 'Você já está com um atendimento em andamento.', 'attendance_in_progress');
        assert(nextId(rotation), 'Nenhum analista está disponível para este rodízio.', 'empty_queue');
        assert(nextId(rotation) === actorId, 'Somente o próximo analista pode iniciar o atendimento.', 'not_next');
        const before = snapshot(rotation);
        rotation.active.push({
            id: attendanceId || `att-${now}-${actorId}`,
            analystId: actorId,
            team: rotation.team,
            status: ATTENDANCE_STATUS.IN_PROGRESS,
            startedAt: now,
            positionBefore: rotation.queue.indexOf(actorId) + 1
        });
        return appendEvents(rotation, [event('attendance_started', rotation, { analystId: actorId, actorId, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    function assign(input, analystId, actorId, details, now = Date.now(), attendanceId = null) {
        const rotation = withActive(clone(input));
        const briefing = {
            demand: String(details?.demand || '').trim(),
            product: String(details?.product || '').trim(),
            clientName: String(details?.clientName || '').trim(),
            clientId: String(details?.clientId || '').trim(),
            phone: String(details?.phone || '').trim(),
            instructions: String(details?.instructions || '').trim()
        };
        assert(rotation.status === ROTATION_STATUS.ACTIVE, 'O rodízio está pausado.', 'rotation_paused');
        /* O limite é por pessoa: outros analistas podem estar atendendo ao mesmo tempo, mas
           ninguém recebe um segundo chamado antes de fechar o primeiro. */
        assert(!isBusy(rotation, analystId), 'Este analista já está com um atendimento em andamento.', 'attendance_in_progress');
        assert(nextId(rotation), 'Todos os analistas da fila já estão em atendimento.', 'queue_busy');
        assert(nextId(rotation) === analystId, 'O atendimento só pode ser encaminhado ao próximo da fila.', 'not_next');
        assert(briefing.demand && briefing.clientName && briefing.clientId && briefing.phone && briefing.instructions, 'Preencha todas as informações do atendimento.', 'briefing_required');
        /* A marca é fechada: digitada livre, "Facil Fit", "fácil-fit" e "FÁCIL FIT" viram
           três produtos diferentes no primeiro relatório que agrupar por ela. */
        assert(BRANDS.includes(briefing.product), 'Escolha o produto do atendimento.', 'product_required');
        const before = snapshot(rotation);
        rotation.active.push({
            id: attendanceId || `att-${now}-${analystId}`,
            analystId,
            team: rotation.team,
            status: ATTENDANCE_STATUS.IN_PROGRESS,
            startedAt: now,
            positionBefore: rotation.queue.indexOf(analystId) + 1,
            assignedBy: actorId,
            briefing
        });
        return appendEvents(rotation, [event('attendance_assigned', rotation, { analystId, actorId, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    /* Quem está com o atendimento é quem escreve nele. A checagem de dono repete a de
       `complete()` de propósito: registrar tentativa e nota são portas novas para o mesmo
       objeto, e uma porta sem tranca torna a outra decorativa. */
    function assertOwnAttendance(rotation, actorId) {
        assert(activeList(rotation).length, 'Não existe atendimento em andamento.', 'no_attendance');
        assert(isBusy(rotation, actorId), 'Este atendimento pertence a outro analista.', 'not_owner');
        return activeOf(rotation, actorId);
    }

    function attemptsOf(attendance) {
        return Array.isArray(attendance?.contactAttempts) ? attendance.contactAttempts : [];
    }
    function notesOf(attendance) {
        return Array.isArray(attendance?.notes) ? attendance.notes : [];
    }
    /* Quanto falta para poder encerrar por falta de retorno. A tela usa isto para mostrar
       "2 de 3" em vez de deixar o analista descobrir o limite ao ser barrado. */
    function noAnswerProgress(attendance) {
        const feitas = attemptsOf(attendance).length;
        return { done: feitas, required: NO_ANSWER_MIN_ATTEMPTS, missing: Math.max(0, NO_ANSWER_MIN_ATTEMPTS - feitas), allowed: feitas >= NO_ANSWER_MIN_ATTEMPTS };
    }

    function logContact(input, actorId, details, now = Date.now()) {
        const rotation = withActive(clone(input));
        const atendimento = assertOwnAttendance(rotation, actorId);
        const channel = String(details?.channel || '');
        const result = String(details?.result || '');
        assert(Object.values(CONTACT_CHANNEL).includes(channel), 'Escolha o canal do contato.', 'invalid_channel');
        assert(Object.values(CONTACT_RESULT).includes(result), 'Escolha o resultado do contato.', 'invalid_result');
        const attempt = {
            id: `try-${now}-${attemptsOf(atendimento).length + 1}`,
            channel, result,
            note: String(details?.note || '').trim(),
            at: now, byId: actorId
        };
        replaceActive(rotation, { ...atendimento, contactAttempts: [...attemptsOf(atendimento), attempt] });
        return appendEvents(rotation, [event('contact_attempted', rotation, { analystId: actorId, actorId, now, reason: `${CONTACT_CHANNEL_LABEL[channel]} · ${CONTACT_RESULT_LABEL[result]}` })]);
    }

    function addNote(input, actorId, text, now = Date.now()) {
        const rotation = withActive(clone(input));
        const atendimento = assertOwnAttendance(rotation, actorId);
        const conteudo = String(text || '').trim();
        assert(conteudo.length >= 3, 'Escreva a nota antes de salvar.', 'note_required');
        const nota = { id: `note-${now}-${notesOf(atendimento).length + 1}`, text: conteudo, at: now, byId: actorId };
        replaceActive(rotation, { ...atendimento, notes: [...notesOf(atendimento), nota] });
        return appendEvents(rotation, [event('attendance_noted', rotation, { analystId: actorId, actorId, now })]);
    }

    /* O desfecho é obrigatório para encerrar: sem ele voltaríamos ao que existia, um
       protocolo sem história. Validado aqui, e não na tela, porque a tela não é o único
       caminho possível para o dado — e porque a regra das tentativas precisa olhar o
       atendimento, que só o domínio tem inteiro. */
    function normalizeOutcome(outcome, attendance) {
        const resolution = String(outcome?.resolution || '');
        assert(Object.values(RESOLUTION).includes(resolution), 'Escolha se o atendimento foi resolvido.', 'resolution_required');
        const reason = String(outcome?.reason || '');
        assert(RESOLUTION_REASONS[resolution].includes(reason),
            resolution === RESOLUTION.RESOLVED ? 'Escolha como o atendimento foi resolvido.' : 'Escolha por que o atendimento não foi resolvido.',
            'resolution_reason_required');
        const detail = String(outcome?.detail || '').trim();
        assert(detail.length >= RESOLUTION_DETAIL_MIN, `Descreva o desfecho em pelo menos ${RESOLUTION_DETAIL_MIN} caracteres.`, 'resolution_detail_required');
        if (reason === 'no_answer') {
            const progresso = noAnswerProgress(attendance);
            assert(progresso.allowed, `Registre ${NO_ANSWER_MIN_ATTEMPTS} tentativas de contato antes de encerrar por falta de retorno. Há ${progresso.done}.`, 'attempts_required');
        }
        return { resolution, reason, detail };
    }

    function complete(input, actorId, priorityId, now = Date.now(), outcome = null) {
        const rotation = withActive(clone(input));
        const atual = assertOwnAttendance(rotation, actorId);
        if (atual.priorityId === priorityId && atual.status === ATTENDANCE_STATUS.COMPLETED) return rotation;
        assert(!rotation.events?.some(item => item.type === 'priority_registered' && item.relatedPriorityId === priorityId), 'Esta prioridade já concluiu uma vez do rodízio.', 'duplicate_completion');
        const desfecho = normalizeOutcome(outcome, atual);
        const before = snapshot(rotation);
        const attendance = {
            ...atual, status: ATTENDANCE_STATUS.COMPLETED, completedAt: now, priorityId,
            resolution: desfecho.resolution, resolutionReason: desfecho.reason, resolutionDetail: desfecho.detail
        };
        dropActive(rotation, atual.id);
        sendToBack(rotation, actorId);
        rotation.lastCompleted = attendance;
        normalizePositions(rotation);
        const next = nextId(rotation);
        return appendEvents(rotation, [
            event('priority_registered', rotation, { analystId: actorId, actorId, now, relatedPriorityId: priorityId }),
            event('attendance_completed', rotation, { analystId: actorId, actorId, now, relatedPriorityId: priorityId, previousState: before }),
            event('rotation_advanced', rotation, { analystId: next, actorId: 'system', now, relatedPriorityId: priorityId, nextState: snapshot(rotation) })
        ]);
    }

    function skip(input, targetId, actorId, reason, now = Date.now()) {
        const rotation = withActive(clone(input)); reason = requiredReason(reason);
        assert(rotation.queue.includes(targetId), 'O participante não está na fila ativa.', 'participant_not_active');
        const before = snapshot(rotation);
        // Pular quem está atendendo cancela o atendimento DELE, e só o dele.
        const atendimento = activeOf(rotation, targetId);
        if (atendimento) {
            rotation.lastCompleted = { ...atendimento, status: ATTENDANCE_STATUS.CANCELLED, completedAt: now, endedBy: actorId, reason };
            dropActive(rotation, atendimento.id);
        }
        rotation.queue = rotation.queue.filter(id => id !== targetId);
        rotation.queue.push(targetId);
        normalizePositions(rotation);
        return appendEvents(rotation, [event('turn_skipped', rotation, { analystId: targetId, actorId, reason, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    function pauseParticipant(input, targetId, actorId, reason, now = Date.now(), currentHandling = 'keep') {
        const rotation = withActive(clone(input)); reason = requiredReason(reason);
        assert(rotation.participants[targetId], 'Participante não encontrado.', 'participant_not_found');
        const before = snapshot(rotation);
        const atendimento = activeOf(rotation, targetId);
        if (atendimento && currentHandling === 'keep') {
            replaceActive(rotation, { ...atendimento, pauseAfterCompletion: true });
        } else if (atendimento) {
            rotation.lastCompleted = { ...atendimento, status: ATTENDANCE_STATUS.CANCELLED, completedAt: now, endedBy: actorId, reason };
            dropActive(rotation, atendimento.id);
        }
        rotation.queue = rotation.queue.filter(id => id !== targetId);
        rotation.participants[targetId] = { ...rotation.participants[targetId], status: PARTICIPANT_STATUS.PAUSED, pausedAt: now, pauseReason: reason, position: null };
        normalizePositions(rotation);
        return appendEvents(rotation, [event('participant_paused', rotation, { analystId: targetId, actorId, reason, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    function reactivateParticipant(input, targetId, actorId, now = Date.now()) {
        const rotation = clone(input);
        assert(rotation.participants[targetId]?.status === PARTICIPANT_STATUS.PAUSED, 'O participante não está pausado.', 'participant_not_paused');
        const before = snapshot(rotation);
        rotation.participants[targetId] = { ...rotation.participants[targetId], status: PARTICIPANT_STATUS.ACTIVE, pausedAt: null, pauseReason: null, enabled: true };
        rotation.queue = rotation.queue.filter(id => id !== targetId);
        rotation.queue.push(targetId);
        normalizePositions(rotation);
        return appendEvents(rotation, [event('participant_reactivated', rotation, { analystId: targetId, actorId, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    function reorder(input, order, actorId, now = Date.now()) {
        const rotation = clone(input);
        const unique = [...new Set(order || [])];
        assert(unique.length === rotation.queue.length && unique.every(id => rotation.queue.includes(id)), 'A nova ordem deve conter todos os participantes ativos.', 'invalid_order');
        /* Quem está atendendo não muda de lugar. Antes a regra era "o atendimento tem de
           continuar em primeiro"; com vários simultâneos isso não se sustenta — o que
           precisa ficar parado é a posição de CADA um que já recebeu o chamado. */
        activeList(rotation).forEach(item => {
            const antes = rotation.queue.indexOf(item.analystId);
            if (antes === -1) return;
            assert(unique.indexOf(item.analystId) === antes, 'Um atendimento iniciado não pode mudar de posição.', 'current_position_locked');
        });
        const before = snapshot(rotation);
        rotation.queue = unique;
        normalizePositions(rotation);
        return appendEvents(rotation, [event('order_corrected', rotation, { actorId, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    function setPaused(input, paused, actorId, reason, now = Date.now()) {
        const rotation = clone(input);
        if (paused) reason = requiredReason(reason);
        const before = snapshot(rotation);
        rotation.status = paused ? ROTATION_STATUS.PAUSED : ROTATION_STATUS.ACTIVE;
        return appendEvents(rotation, [event(paused ? 'rotation_paused' : 'rotation_reactivated', rotation, { actorId, reason: reason || null, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    /* `attendanceId` passou a ser obrigatório na prática: com vários atendimentos abertos,
       "encerrar o atual" deixou de identificar um. Fica opcional só para o caso de haver um
       único aberto — encerrar o que existe, sem ambiguidade, continua sendo inequívoco. */
    function resolveCurrent(input, outcome, actorId, reason, now = Date.now(), attendanceId = null) {
        const rotation = withActive(clone(input)); reason = requiredReason(reason);
        const abertos = activeList(rotation);
        assert(abertos.length, 'Não existe atendimento em andamento.', 'no_attendance');
        const alvo = attendanceId ? attendanceById(rotation, attendanceId) : (abertos.length === 1 ? abertos[0] : null);
        assert(alvo, attendanceId ? 'Este atendimento não está mais em andamento.' : 'Há mais de um atendimento aberto: escolha qual encerrar.', 'attendance_ambiguous');
        assert(['end_move', 'cancel_keep', 'cancel_move'].includes(outcome), 'Escolha um resultado válido.', 'invalid_outcome');
        const before = snapshot(rotation), analystId = alvo.analystId;
        rotation.lastCompleted = { ...alvo, status: outcome === 'end_move' ? ATTENDANCE_STATUS.COMPLETED : ATTENDANCE_STATUS.CANCELLED, completedAt: now, endedBy: actorId, reason };
        dropActive(rotation, alvo.id);
        if (outcome.endsWith('move')) sendToBack(rotation, analystId);
        normalizePositions(rotation);
        return appendEvents(rotation, [event(outcome === 'end_move' ? 'attendance_ended_by_manager' : 'attendance_cancelled', rotation, { analystId, actorId, reason, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    function view(rotation) {
        if (!rotation) return { status: 'missing', queue: [], paused: [], active: [], next: null, upcoming: [], lastCompleted: null };
        const next = nextId(rotation);
        const ocupados = new Set(activeList(rotation).map(item => item.analystId));
        /* Os próximos são os livres depois do próximo. Antes a janela era calculada pela
           posição do único atendimento; com vários, o que importa é quem está livre. */
        const livres = rotation.queue.filter(id => !ocupados.has(id) && id !== next);
        return {
            status: rotation.status,
            active: activeList(rotation).slice().sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0)),
            next,
            upcoming: livres.slice(0, 3),
            queue: [...rotation.queue],
            paused: Object.values(rotation.participants || {}).filter(item => item.status === PARTICIPANT_STATUS.PAUSED),
            lastCompleted: rotation.lastCompleted,
            version: rotation.version
        };
    }

    /* Busca de chamado de prioridade.
       Quem procura tem na mão o que o cliente falou ao telefone: o protocolo, o ID
       do cliente ou o nome dele — raramente no formato exato que foi digitado no
       cadastro. Por isso a comparação ignora acento e caixa, e ainda tenta uma
       segunda passada só com letras e números, para "TZ-2244", "tz 2244" e "TZ2244"
       acharem o mesmo chamado. A busca por analista só faz sentido para a gestão;
       por isso o nome dele entra por `extras`, e não do próprio registro. */
    function normalizeSearch(value) {
        return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
    }
    function compactSearch(value) {
        return normalizeSearch(value).replace(/[^a-z0-9]/g, '');
    }
    function searchFields(request, extras = {}) {
        const row = request || {};
        return [row.protocolo, row.clientId, row.clientName, row.demand, row.justificativa, extras.analystName, extras.team].filter(Boolean);
    }
    function matchesSearch(request, query, extras = {}) {
        const termo = normalizeSearch(query);
        if (!termo) return true;
        const campos = searchFields(request, extras);
        if (campos.some(campo => normalizeSearch(campo).includes(termo))) return true;
        const compacto = compactSearch(query);
        // Campo a campo: juntar tudo antes de compactar criaria emenda entre um campo
        // e o outro, e "2244KM" acharia um chamado que não existe.
        return Boolean(compacto) && campos.some(campo => compactSearch(campo).includes(compacto));
    }
    function filterBySearch(requests, query, resolveExtras) {
        const lista = Array.isArray(requests) ? requests : [];
        if (!normalizeSearch(query)) return lista;
        return lista.filter(item => matchesSearch(item, query, typeof resolveExtras === 'function' ? resolveExtras(item) : {}));
    }

    return {
        ROTATION_STATUS, PARTICIPANT_STATUS, ATTENDANCE_STATUS, REQUEST_STATUS_META, statusMeta, PRIORITY_LOG_TYPES, pointLogsOf, deletionEntry, BRANDS,
        create, syncParticipants, nextId, canManage, start, assign, complete, skip, pauseParticipant, reactivateParticipant, reorder, setPaused, resolveCurrent,
        view, snapshot, matchesSearch, filterBySearch, normalizeSearch,
        // Atendimentos simultâneos
        activeList, activeOf, isBusy, attendanceById,
        // Ficha do atendimento
        CONTACT_CHANNEL, CONTACT_RESULT, CONTACT_CHANNEL_LABEL, CONTACT_RESULT_LABEL,
        RESOLUTION, RESOLUTION_REASONS, RESOLUTION_LABEL, RESOLUTION_REASON_LABEL,
        NO_ANSWER_MIN_ATTEMPTS, RESOLUTION_DETAIL_MIN,
        logContact, addNote, attemptsOf, notesOf, noAnswerProgress, normalizeOutcome
    };
});

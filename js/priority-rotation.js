(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PriorityRotation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const ROTATION_STATUS = Object.freeze({ ACTIVE: 'active', PAUSED: 'paused' });
    const PARTICIPANT_STATUS = Object.freeze({ ACTIVE: 'active', PAUSED: 'paused', UNAVAILABLE: 'unavailable', OUTSIDE: 'outside' });
    const ATTENDANCE_STATUS = Object.freeze({ IN_PROGRESS: 'in_progress', COMPLETED: 'completed', CANCELLED: 'cancelled' });

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

    function nextId(rotation) {
        if (!rotation?.queue?.length) return null;
        if (!rotation.current) return rotation.queue[0];
        const index = rotation.queue.indexOf(rotation.current.analystId);
        return rotation.queue[index + 1] || rotation.queue.find(id => id !== rotation.current.analystId) || null;
    }

    function snapshot(rotation) {
        return { status: rotation.status, queue: [...rotation.queue], current: rotation.current ? { ...rotation.current } : null, version: rotation.version };
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
        const rotation = clone(input);
        assert(rotation.status === ROTATION_STATUS.ACTIVE, 'O rodízio está pausado.', 'rotation_paused');
        assert(!rotation.current, 'Já existe um atendimento em andamento.', 'attendance_in_progress');
        assert(nextId(rotation), 'Nenhum analista está disponível para este rodízio.', 'empty_queue');
        assert(nextId(rotation) === actorId, 'Somente o próximo analista pode iniciar o atendimento.', 'not_next');
        const before = snapshot(rotation);
        rotation.current = {
            id: attendanceId || `att-${now}-${actorId}`,
            analystId: actorId,
            team: rotation.team,
            status: ATTENDANCE_STATUS.IN_PROGRESS,
            startedAt: now,
            positionBefore: rotation.queue.indexOf(actorId) + 1
        };
        return appendEvents(rotation, [event('attendance_started', rotation, { analystId: actorId, actorId, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    function assign(input, analystId, actorId, details, now = Date.now(), attendanceId = null) {
        const rotation = clone(input);
        const briefing = {
            demand: String(details?.demand || '').trim(),
            clientName: String(details?.clientName || '').trim(),
            clientId: String(details?.clientId || '').trim(),
            phone: String(details?.phone || '').trim(),
            instructions: String(details?.instructions || '').trim()
        };
        assert(rotation.status === ROTATION_STATUS.ACTIVE, 'O rodízio está pausado.', 'rotation_paused');
        assert(!rotation.current, 'Já existe um atendimento em andamento.', 'attendance_in_progress');
        assert(nextId(rotation) === analystId, 'O atendimento só pode ser encaminhado ao próximo da fila.', 'not_next');
        assert(briefing.demand && briefing.clientName && briefing.clientId && briefing.phone && briefing.instructions, 'Preencha todas as informações do atendimento.', 'briefing_required');
        const before = snapshot(rotation);
        rotation.current = {
            id: attendanceId || `att-${now}-${analystId}`,
            analystId,
            team: rotation.team,
            status: ATTENDANCE_STATUS.IN_PROGRESS,
            startedAt: now,
            positionBefore: rotation.queue.indexOf(analystId) + 1,
            assignedBy: actorId,
            briefing
        };
        return appendEvents(rotation, [event('attendance_assigned', rotation, { analystId, actorId, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    function complete(input, actorId, priorityId, now = Date.now()) {
        const rotation = clone(input);
        assert(rotation.current, 'Não existe atendimento em andamento.', 'no_attendance');
        assert(rotation.current.analystId === actorId, 'Este atendimento pertence a outro analista.', 'not_owner');
        if (rotation.current.priorityId === priorityId && rotation.current.status === ATTENDANCE_STATUS.COMPLETED) return rotation;
        assert(!rotation.events?.some(item => item.type === 'priority_registered' && item.relatedPriorityId === priorityId), 'Esta prioridade já concluiu uma vez do rodízio.', 'duplicate_completion');
        const before = snapshot(rotation);
        const attendance = { ...rotation.current, status: ATTENDANCE_STATUS.COMPLETED, completedAt: now, priorityId };
        rotation.queue = rotation.queue.filter(id => id !== actorId);
        if (rotation.participants[actorId]?.status === PARTICIPANT_STATUS.ACTIVE) rotation.queue.push(actorId);
        rotation.current = null;
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
        const rotation = clone(input); reason = requiredReason(reason);
        assert(rotation.queue.includes(targetId), 'O participante não está na fila ativa.', 'participant_not_active');
        const before = snapshot(rotation);
        if (rotation.current?.analystId === targetId) {
            rotation.current = { ...rotation.current, status: ATTENDANCE_STATUS.CANCELLED, completedAt: now, endedBy: actorId, reason };
            rotation.lastCompleted = rotation.current;
            rotation.current = null;
        }
        rotation.queue = rotation.queue.filter(id => id !== targetId);
        rotation.queue.push(targetId);
        normalizePositions(rotation);
        return appendEvents(rotation, [event('turn_skipped', rotation, { analystId: targetId, actorId, reason, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    function pauseParticipant(input, targetId, actorId, reason, now = Date.now(), currentHandling = 'keep') {
        const rotation = clone(input); reason = requiredReason(reason);
        assert(rotation.participants[targetId], 'Participante não encontrado.', 'participant_not_found');
        const before = snapshot(rotation);
        if (rotation.current?.analystId === targetId && currentHandling === 'keep') {
            rotation.current.pauseAfterCompletion = true;
        } else if (rotation.current?.analystId === targetId) {
            rotation.current = { ...rotation.current, status: ATTENDANCE_STATUS.CANCELLED, completedAt: now, endedBy: actorId, reason };
            rotation.lastCompleted = rotation.current;
            rotation.current = null;
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
        if (rotation.current) assert(unique[0] === rotation.current.analystId, 'Um atendimento iniciado não pode mudar de posição.', 'current_position_locked');
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

    function resolveCurrent(input, outcome, actorId, reason, now = Date.now()) {
        const rotation = clone(input); reason = requiredReason(reason);
        assert(rotation.current, 'Não existe atendimento em andamento.', 'no_attendance');
        assert(['end_move', 'cancel_keep', 'cancel_move'].includes(outcome), 'Escolha um resultado válido.', 'invalid_outcome');
        const before = snapshot(rotation), analystId = rotation.current.analystId;
        rotation.current = { ...rotation.current, status: outcome === 'end_move' ? ATTENDANCE_STATUS.COMPLETED : ATTENDANCE_STATUS.CANCELLED, completedAt: now, endedBy: actorId, reason };
        rotation.lastCompleted = rotation.current;
        rotation.current = null;
        if (outcome.endsWith('move')) {
            rotation.queue = rotation.queue.filter(id => id !== analystId);
            if (rotation.participants[analystId]?.status === PARTICIPANT_STATUS.ACTIVE) rotation.queue.push(analystId);
        }
        normalizePositions(rotation);
        return appendEvents(rotation, [event(outcome === 'end_move' ? 'attendance_ended_by_manager' : 'attendance_cancelled', rotation, { analystId, actorId, reason, now, previousState: before, nextState: snapshot(rotation) })]);
    }

    function view(rotation) {
        if (!rotation) return { status: 'missing', queue: [], paused: [], current: null, next: null, upcoming: [], lastCompleted: null };
        const next = nextId(rotation);
        const start = rotation.current ? Math.max(0, rotation.queue.indexOf(rotation.current.analystId) + 2) : 1;
        return {
            status: rotation.status,
            current: rotation.current,
            next,
            upcoming: rotation.queue.slice(start, start + 3),
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

    return { ROTATION_STATUS, PARTICIPANT_STATUS, ATTENDANCE_STATUS, create, syncParticipants, nextId, canManage, start, assign, complete, skip, pauseParticipant, reactivateParticipant, reorder, setPaused, resolveCurrent, view, snapshot, matchesSearch, filterBySearch, normalizeSearch };
});

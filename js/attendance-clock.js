/* Ponto e pausas do atendimento.
 *
 * Três coisas moram aqui e em nenhum outro lugar: a jornada esperada de cada
 * pessoa, o que aconteceu de fato no dia (login, pausas, retorno) e a escala
 * semanal de almoço e lanche montada pela gestão.
 *
 * Regra que dá sentido a todo o resto: almoço e lanche são direito, o resto do
 * tempo parado é ociosidade. É por isso que o módulo separa `restMs` de
 * `idleMs` em vez de somar tudo num "tempo em pausa" que não decide nada.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AttendanceClock = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MINUTE = 60000;

    /* Só almoço e lanche têm limite, porque só eles têm duração combinada.
       Banheiro, particular, reunião e feedback não recebem um teto inventado:
       eles são medidos, e a leitura do exagero é da gestão. */
    const BREAK_TYPES = {
        almoco: { key: 'almoco', label: 'Almoço', limitMin: 72, perDay: 1, idle: false, scheduled: true, icon: 'fi-rr-hamburger', tone: 'success' },
        lanche: { key: 'lanche', label: 'Lanche', limitMin: 15, perDay: 1, idle: false, scheduled: true, icon: 'fi-rr-coffee', tone: 'success' },
        banheiro: { key: 'banheiro', label: 'Banheiro', limitMin: null, perDay: null, idle: true, scheduled: false, icon: 'fi-rr-shower', tone: 'warning' },
        particular: { key: 'particular', label: 'Particular', limitMin: null, perDay: null, idle: true, scheduled: false, icon: 'fi-rr-user', tone: 'warning' },
        reuniao: { key: 'reuniao', label: 'Reunião', limitMin: null, perDay: null, idle: true, scheduled: false, icon: 'fi-rr-users-alt', tone: 'info' },
        feedback: { key: 'feedback', label: 'Feedback', limitMin: null, perDay: null, idle: true, scheduled: false, icon: 'fi-rr-comment-alt', tone: 'info' }
    };

    const BREAK_ORDER = ['almoco', 'lanche', 'banheiro', 'particular', 'reuniao', 'feedback'];
    const SCHEDULED_TYPES = BREAK_ORDER.filter(key => BREAK_TYPES[key].scheduled);

    const WEEKDAYS = [
        { day: 1, label: 'Segunda', short: 'Seg' },
        { day: 2, label: 'Terça', short: 'Ter' },
        { day: 3, label: 'Quarta', short: 'Qua' },
        { day: 4, label: 'Quinta', short: 'Qui' },
        { day: 5, label: 'Sexta', short: 'Sex' },
        { day: 6, label: 'Sábado', short: 'Sáb' },
        { day: 0, label: 'Domingo', short: 'Dom' }
    ];

    /* O padrão de um cadastro novo precisa ser um turno que existe na operação —
       09–18 não existe. Turnos reais: 07–17, 08–18 e 09–19; 08–18 é o do meio. */
    const DEFAULT_SHIFT = { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5], toleranceMin: 5 };

    /* ----- tempo ----- */

    function pad(value) { return String(value).padStart(2, '0'); }
    function toDate(ts) { return ts instanceof Date ? ts : new Date(ts); }
    function dateKey(ts) { const d = toDate(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    function timeLabel(ts) { const d = toDate(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

    /* A semana começa na segunda: é assim que a escala é lida na parede. */
    function weekKey(ts) {
        const d = toDate(ts);
        const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        return dateKey(monday);
    }

    function weekDates(key) {
        const [year, month, day] = String(key).split('-').map(Number);
        return WEEKDAYS.map((entry, index) => {
            const date = new Date(year, month - 1, day);
            date.setDate(date.getDate() + index);
            return { ...entry, key: dateKey(date), date };
        });
    }

    /* Identificação da semana como ela é lida na parede: mês por extenso, ordem
       dentro do mês e a posição em relação a hoje. Sem isso, "12/08 a 16/08"
       não diz se é a semana que está rodando, a passada ou uma futura. */
    const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

    function weekOfMonth(key) {
        const [year, month, day] = String(key).split('-').map(Number);
        const first = new Date(year, month - 1, 1);
        // Primeira segunda-feira dentro do mês: ancorar na semana que contém o dia 1
        // jogava a âncora para o mês anterior e inflava a contagem.
        const firstMonday = new Date(year, month - 1, 1 + ((8 - first.getDay()) % 7));
        return Math.round((new Date(year, month - 1, day) - firstMonday) / (7 * 24 * 3600 * 1000)) + 1;
    }

    function weekInfo(key, reference = Date.now()) {
        const dias = weekDates(key);
        const inicio = dias[0], fim = dias[6];
        const atual = weekKey(reference);
        const distancia = Math.round((new Date(key) - new Date(atual)) / (7 * 24 * 3600 * 1000));
        const relativo = distancia === 0 ? 'Semana atual'
            : distancia === 1 ? 'Próxima semana'
            : distancia === -1 ? 'Semana anterior'
            : distancia > 1 ? `Em ${distancia} semanas`
            : `Há ${Math.abs(distancia)} semanas`;
        // Uma semana pode cruzar a virada do mês; o mês é o do início.
        const [year, month] = String(key).split('-').map(Number);
        const curto = k => k.split('-').reverse().slice(0, 2).join('/');
        return {
            key, distancia, relativo, isCurrent: distancia === 0,
            month, year, monthName: MONTHS[month - 1],
            ordinal: weekOfMonth(key),
            startKey: inicio.key, endKey: fim.key,
            range: `${curto(inicio.key)} a ${curto(dias[4].key)}`,
            title: `${weekOfMonth(key)}ª semana de ${MONTHS[month - 1]}`,
            crossesMonth: Number(fim.key.split('-')[1]) !== month
        };
    }

    /* Janelas usadas na escala. Digitar hora em campo de tempo é lento e erra fácil;
       com a grade pronta a gestão escolhe em um clique. O passo de 15 minutos cobre
       como as pausas são combinadas na prática. */
    const SLOT_WINDOWS = {
        almoco: { from: '11:00', to: '15:00', step: 15 },
        lanche: { from: '09:00', to: '17:30', step: 15 }
    };

    function slotOptions(type) {
        const janela = SLOT_WINDOWS[type] || SLOT_WINDOWS.almoco;
        const inicio = parseTime(janela.from), fim = parseTime(janela.to);
        if (!inicio || !fim) return [];
        const saida = [];
        for (let minuto = inicio.minutes; minuto <= fim.minutes; minuto += janela.step) {
            saida.push(`${pad(Math.floor(minuto / 60))}:${pad(minuto % 60)}`);
        }
        return saida;
    }

    /* A grade oferecida no seletor, já marcada contra o expediente da pessoa. Quem
       escolhe o horário precisa ver na hora que 17:30 não serve para quem sai às 17h
       — descobrir isso depois, pela borda vermelha da célula, é tarde. */
    function slotChoices(type, profile) {
        return slotOptions(type).map(time => ({ time, withinShift: withinShift(profile, time) }));
    }

    function parseTime(value) {
        const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
        if (!match) return null;
        const hour = Number(match[1]); const minute = Number(match[2]);
        if (hour > 23 || minute > 59) return null;
        return { hour, minute, minutes: hour * 60 + minute, label: `${pad(hour)}:${pad(minute)}` };
    }

    function atTime(ts, value) {
        const time = parseTime(value);
        if (!time) return null;
        const d = toDate(ts);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), time.hour, time.minute, 0, 0).getTime();
    }

    function formatDuration(ms) {
        const total = Math.max(0, Math.round(Number(ms) || 0) / MINUTE);
        const hours = Math.floor(total / 60);
        const minutes = Math.floor(total % 60);
        if (hours && minutes) return `${hours}h ${minutes}min`;
        if (hours) return `${hours}h`;
        return `${minutes}min`;
    }

    function formatClock(ms) {
        const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
        const hours = Math.floor(total / 3600);
        const rest = total % 3600;
        const body = `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`;
        return hours ? `${pad(hours)}:${body}` : body;
    }

    /* ----- perfil de jornada ----- */

    function profileOf(profiles, userId) {
        const found = (profiles || {})[userId];
        if (!found || found.tracked !== true) return null;
        const shift = { ...DEFAULT_SHIFT, ...(found.shift || {}) };
        shift.days = Array.isArray(shift.days) && shift.days.length ? shift.days.map(Number) : [...DEFAULT_SHIFT.days];
        return { ...found, shift };
    }

    function isTracked(profiles, userId) { return profileOf(profiles, userId) !== null; }

    function worksOn(profile, ts) { return !!profile && profile.shift.days.includes(toDate(ts).getDay()); }

    /* Cada pessoa tem o seu expediente: 07–17, 08–18, 09–19. Nada no módulo
       assume um horário comum — o que existe é um padrão para o cadastro novo. */
    function shiftLabel(profile) {
        const shift = profile?.shift;
        return shift ? `${shift.start}–${shift.end}` : '';
    }

    function shiftSpanMinutes(profile) {
        const inicio = parseTime(profile?.shift?.start);
        const fim = parseTime(profile?.shift?.end);
        if (!inicio || !fim) return 0;
        // Jornada que atravessa a meia-noite continua sendo uma jornada.
        return fim.minutes > inicio.minutes ? fim.minutes - inicio.minutes : (24 * 60) - inicio.minutes + fim.minutes;
    }

    /* Com expedientes diferentes, marcar o lanche de todo mundo às 17:30 tira do
       ar quem sai às 17h. Esta é a checagem que impede a escala de virar erro. */
    function withinShift(profile, value) {
        const hora = parseTime(value);
        const inicio = parseTime(profile?.shift?.start);
        const fim = parseTime(profile?.shift?.end);
        if (!hora || !inicio || !fim) return true;
        return fim.minutes > inicio.minutes
            ? hora.minutes >= inicio.minutes && hora.minutes <= fim.minutes
            : hora.minutes >= inicio.minutes || hora.minutes <= fim.minutes;
    }

    /* Turnos que a operação usa hoje. Servem de atalho no cadastro — a jornada
       real continua sendo a que está gravada em cada ficha. */
    const SHIFT_PRESETS = [
        { label: '07–17', start: '07:00', end: '17:00' },
        { label: '08–18', start: '08:00', end: '18:00' },
        { label: '09–19', start: '09:00', end: '19:00' }
    ];

    function expectedStart(profile, ts) { return worksOn(profile, ts) ? atTime(ts, profile.shift.start) : null; }
    function expectedEnd(profile, ts) { return worksOn(profile, ts) ? atTime(ts, profile.shift.end) : null; }

    /* ----- registro do dia ----- */

    function emptyDay() { return { login: null, logout: null, breaks: [] }; }

    function dayOf(state, userId, ts) {
        return ((state || {})[dateKey(ts)] || {})[userId] || null;
    }

    function ensureDay(state, userId, ts) {
        const key = dateKey(ts);
        if (!state[key]) state[key] = {};
        if (!state[key][userId]) state[key][userId] = emptyDay();
        const day = state[key][userId];
        if (!Array.isArray(day.breaks)) day.breaks = [];
        return day;
    }

    function openBreak(day) { return (day?.breaks || []).find(item => !item.endedAt) || null; }

    function fail(message, code) { return { ok: false, code, message }; }

    /* O ponto abre sozinho no primeiro login do dia — ninguém precisa lembrar de
       "bater". Logins seguintes não reescrevem o horário: se reescrevessem, um
       refresh de página apagaria o atraso da manhã. */
    function registerLogin(state, userId, ts = Date.now()) {
        const day = ensureDay(state, userId, ts);
        if (day.login == null) { day.login = ts; day.logout = null; return { ok: true, opened: true, day }; }
        day.logout = null;
        return { ok: true, opened: false, day };
    }

    function registerLogout(state, userId, ts = Date.now()) {
        const day = dayOf(state, userId, ts);
        if (!day || day.login == null) return fail('Não há ponto aberto para encerrar.', 'clock_not_open');
        const open = openBreak(day);
        if (open) { open.endedAt = ts; open.closedBy = 'logout'; }
        day.logout = ts;
        return { ok: true, day, closedBreak: open || null };
    }

    function startBreak(state, userId, type, ts = Date.now(), options = {}) {
        const spec = BREAK_TYPES[type];
        if (!spec) return fail('Tipo de pausa desconhecido.', 'unknown_break');
        const day = ensureDay(state, userId, ts);
        if (day.login == null) return fail('Faça login para abrir o ponto antes de registrar pausa.', 'clock_not_open');
        if (openBreak(day)) return fail('Já existe uma pausa em andamento.', 'break_in_progress');
        if (spec.perDay && day.breaks.filter(item => item.type === type).length >= spec.perDay) {
            return fail(`${spec.label} já foi registrado hoje.`, 'break_limit_reached');
        }
        const entry = { id: `${type}-${ts}`, type, startedAt: ts, endedAt: null, note: options.note || '' };
        // Saída fora da janela combinada só existe com justificativa escrita: é o que
        // transforma "saiu cedo" em informação, em vez de mais um número solto.
        // `'  '` é truthy: sem o trim aqui, uma justificativa em branco criaria um
        // desvio sem motivo — exatamente o que a regra existe para impedir.
        if (String(options.offSchedule?.reason || '').trim()) {
            entry.offSchedule = {
                scheduledAt: options.offSchedule.scheduledAt || null,
                deltaMin: Number(options.offSchedule.deltaMin) || 0,
                status: options.offSchedule.status || 'atrasado',
                reason: String(options.offSchedule.reason).trim(),
                confirmedAt: ts
            };
        }
        day.breaks.push(entry);
        return { ok: true, day, entry };
    }

    function endBreak(state, userId, ts = Date.now()) {
        const day = dayOf(state, userId, ts);
        const open = day ? openBreak(day) : null;
        if (!open) return fail('Não há pausa em andamento.', 'no_open_break');
        open.endedAt = Math.max(ts, open.startedAt);
        return { ok: true, day, entry: open };
    }

    /* ----- leitura do dia ----- */

    function breakDuration(entry, reference) {
        return Math.max(0, (entry.endedAt || reference) - entry.startedAt);
    }

    function summarizeBreaks(day, reference) {
        const byType = {};
        BREAK_ORDER.forEach(key => { byType[key] = { ...BREAK_TYPES[key], count: 0, ms: 0, overMs: 0 }; });
        let idleMs = 0; let idleCount = 0; let restMs = 0; let overMs = 0;
        (day?.breaks || []).forEach(entry => {
            const bucket = byType[entry.type];
            if (!bucket) return;
            const ms = breakDuration(entry, reference);
            bucket.count += 1;
            bucket.ms += ms;
            if (bucket.limitMin != null) {
                const excess = Math.max(0, ms - bucket.limitMin * MINUTE);
                bucket.overMs += excess;
                overMs += excess;
            }
            if (bucket.idle) { idleMs += ms; idleCount += 1; } else { restMs += ms; }
        });
        return { byType, idleMs, idleCount, restMs, overMs };
    }

    /* Ociosidade é a soma das pausas que não são almoço nem lanche — em tempo E
       em quantidade. As duas leituras contam histórias diferentes: dez minutos
       numa ida ao banheiro não é o mesmo problema que dez idas de um minuto. */
    function daySummary(state, userId, ts = Date.now(), profile = null, reference = null) {
        const now = reference == null ? ts : reference;
        const day = dayOf(state, userId, ts);
        const stats = summarizeBreaks(day, now);
        const open = day ? openBreak(day) : null;
        const start = profile ? expectedStart(profile, ts) : null;
        const tolerance = (profile?.shift?.toleranceMin ?? DEFAULT_SHIFT.toleranceMin) * MINUTE;
        const lateMs = day?.login != null && start != null ? Math.max(0, day.login - start - tolerance) : 0;
        const closedAt = day?.logout || now;
        const onlineMs = day?.login != null ? Math.max(0, closedAt - day.login) : 0;

        return {
            userId,
            date: dateKey(ts),
            login: day?.login || null,
            logout: day?.logout || null,
            expectedStart: start,
            expectedEnd: profile ? expectedEnd(profile, ts) : null,
            scheduledToday: profile ? worksOn(profile, ts) : false,
            lateMs,
            late: lateMs > 0,
            onlineMs,
            // Tempo efetivamente à disposição do atendimento.
            availableMs: Math.max(0, onlineMs - stats.idleMs - stats.restMs),
            breaks: (day?.breaks || []).map(entry => ({ ...entry, ms: breakDuration(entry, now), spec: BREAK_TYPES[entry.type] || null })),
            byType: stats.byType,
            idleMs: stats.idleMs,
            idleCount: stats.idleCount,
            restMs: stats.restMs,
            overMs: stats.overMs,
            openBreak: open ? { ...open, ms: breakDuration(open, now), spec: BREAK_TYPES[open.type] || null } : null,
            offSchedule: (day?.breaks || []).filter(item => item.offSchedule?.reason).map(item => ({ type: item.type, ...item.offSchedule })),
            offScheduleCount: (day?.breaks || []).filter(item => item.offSchedule?.reason).length,
            status: !day || day.login == null ? 'offline' : day.logout ? 'encerrado' : open ? 'pausa' : 'disponivel'
        };
    }

    /* ----- escala semanal ----- */

    function board(schedule, week, team) {
        return ((schedule || {})[week] || {})[team] || { status: 'draft', publishedAt: null, publishedBy: null, slots: {} };
    }

    function ensureBoard(schedule, week, team) {
        if (!schedule[week]) schedule[week] = {};
        if (!schedule[week][team]) schedule[week][team] = { status: 'draft', publishedAt: null, publishedBy: null, slots: {} };
        const found = schedule[week][team];
        if (!found.slots) found.slots = {};
        return found;
    }

    /* Editar volta o quadro para rascunho: publicar de novo é o que avisa a
       equipe de que a janela mudou. Sem isso, a escala mudaria nas costas de
       quem já tinha se organizado com a versão anterior. */
    function setSlot(schedule, week, team, userId, weekday, type, value, actorId = null) {
        if (!SCHEDULED_TYPES.includes(type)) return fail('Só almoço e lanche entram na escala.', 'unscheduled_type');
        const time = value ? parseTime(value) : null;
        if (value && !time) return fail('Informe o horário no formato 00:00.', 'invalid_time');
        const found = ensureBoard(schedule, week, team);
        if (!found.slots[userId]) found.slots[userId] = {};
        if (!found.slots[userId][weekday]) found.slots[userId][weekday] = {};
        if (time) found.slots[userId][weekday][type] = time.label;
        else delete found.slots[userId][weekday][type];
        found.status = 'draft';
        found.updatedAt = Date.now();
        found.updatedBy = actorId;
        return { ok: true, board: found };
    }

    function publishWeek(schedule, week, team, actorId, ts = Date.now()) {
        const found = ensureBoard(schedule, week, team);
        const preenchidos = Object.values(found.slots).flatMap(days => Object.values(days || {}))
            .filter(slot => slot && (slot.almoco || slot.lanche)).length;
        if (!preenchidos) return fail('Preencha ao menos uma janela antes de publicar.', 'empty_schedule');
        found.status = 'published';
        found.publishedAt = ts;
        found.publishedBy = actorId;
        return { ok: true, board: found, slots: preenchidos };
    }

    /* Semanas diferentes começam o giro em pontos diferentes: é o que impede o
       mesmo analista de almoçar às 11:00 o ano inteiro. */
    function rotationSeed(week) {
        const [year, month, day] = String(week).split('-').map(Number);
        return Math.floor(Date.UTC(year, (month || 1) - 1, day || 1) / (7 * 24 * 3600 * 1000));
    }

    /* Monta um rascunho escalonado: cada pessoa recebe a janela ancorada no PRÓPRIO
       expediente (almoço 4h depois de entrar, lanche 7h), deslocada em faixas de 30
       minutos que giram por pessoa, por dia e por semana. Assim a equipe nunca para
       toda no mesmo minuto e o horário de cada um muda ao longo da semana.
       Não publica nada: entrega o rascunho para a gestão ajustar. */
    function distributeWeek(profiles, ids, week, options = {}) {
        const passo = options.stepMin || 30;
        const faixas = Math.max(1, Math.min((ids || []).length || 1, options.spreadSlots || 4));
        const giro = Number.isInteger(options.rotate) ? options.rotate : rotationSeed(week);
        const ancoras = { almoco: options.lunchAfterMin ?? 4 * 60, lanche: options.snackAfterMin ?? 7 * 60 };
        const plano = {};

        (ids || []).forEach((id, indice) => {
            const perfil = profileOf(profiles, id);
            const inicio = parseTime(perfil?.shift?.start);
            if (!perfil || !inicio) return;
            plano[id] = {};
            perfil.shift.days.filter(dia => dia >= 1 && dia <= 5).forEach(dia => {
                const faixa = (indice + dia + giro) % faixas;
                const dentroDoTurno = depois => {
                    const minuto = (inicio.minutes + depois + faixa * passo) % (24 * 60);
                    const rotulo = `${pad(Math.floor(minuto / 60))}:${pad(minuto % 60)}`;
                    return withinShift(perfil, rotulo) ? rotulo : null;
                };
                const janela = {};
                SCHEDULED_TYPES.forEach(tipo => {
                    const hora = dentroDoTurno(ancoras[tipo]);
                    if (hora) janela[tipo] = hora;
                });
                if (Object.keys(janela).length) plano[id][dia] = janela;
            });
            if (!Object.keys(plano[id]).length) delete plano[id];
        });
        return plano;
    }

    function applyPlan(schedule, week, team, plano, actorId = null) {
        let aplicados = 0;
        Object.entries(plano || {}).forEach(([userId, dias]) => {
            Object.entries(dias).forEach(([dia, janela]) => {
                Object.entries(janela).forEach(([tipo, hora]) => {
                    if (setSlot(schedule, week, team, userId, Number(dia), tipo, hora, actorId).ok) aplicados += 1;
                });
            });
        });
        return { ok: aplicados > 0, aplicados };
    }

    /* Copiar a semana anterior é o atalho mais honesto: a escala real muda pouco de
       uma semana para a outra, e recomeçar do zero toda segunda é o que faz a gestão
       desistir de manter o quadro em dia. */
    function copyWeek(schedule, fromWeek, toWeek, team, actorId = null) {
        const origem = board(schedule, fromWeek, team);
        const preenchidas = Object.values(origem.slots || {})
            .flatMap(dias => Object.values(dias || {}))
            .filter(janela => janela && (janela.almoco || janela.lanche)).length;
        if (!preenchidas) return fail('A semana anterior não tem nenhuma janela para copiar.', 'empty_source');
        const plano = {};
        Object.entries(origem.slots).forEach(([userId, dias]) => {
            const copia = {};
            Object.entries(dias || {}).forEach(([dia, janela]) => {
                const limpo = {};
                SCHEDULED_TYPES.forEach(tipo => { if (janela?.[tipo]) limpo[tipo] = janela[tipo]; });
                if (Object.keys(limpo).length) copia[dia] = limpo;
            });
            if (Object.keys(copia).length) plano[userId] = copia;
        });
        return { ok: true, plano, ...applyPlan(schedule, toWeek, team, plano, actorId) };
    }

    function slotFor(schedule, week, team, userId, weekday) {
        const found = board(schedule, week, team);
        if (found.status !== 'published') return null;
        return (found.slots[userId] || {})[weekday] || null;
    }

    /* Aderência compara a janela publicada com a hora em que a pausa começou de
       fato. Sem escala publicada não existe aderência — e dizer "fora do
       horário" sem horário combinado seria injusto. */
    /* Distância entre o horário combinado e o que aconteceu. "-364min" não se lê, e
       ainda por cima parece duração da pausa — que é outra coisa. Acima de uma hora e
       meia vira horas. O "de quê" fica no tooltip, para a célula não ficar longa. */
    function formatDelta(deltaMin) {
        if (deltaMin === null || deltaMin === undefined || Number.isNaN(deltaMin)) return '';
        const minutos = Math.abs(deltaMin);
        if (minutos === 0) return 'no horário';
        if (minutos >= 90) return `${formatDuration(minutos * MINUTE)} ${deltaMin < 0 ? 'antes' : 'depois'}`;
        return `${deltaMin > 0 ? '+' : '-'}${minutos}min`;
    }

    function adherence(summary, slot, toleranceMin = SCHEDULE_TOLERANCE_MIN) {
        if (!slot) return [];
        return SCHEDULED_TYPES.filter(type => slot[type]).map(type => {
            const planned = atTime(summary.login || Date.now(), slot[type]);
            const entry = (summary.breaks || []).find(item => item.type === type);
            if (!entry) return { type, planned, actual: null, deltaMin: null, deltaLabel: '', status: 'nao_registrada', label: BREAK_TYPES[type].label };
            const deltaMin = Math.round((entry.startedAt - planned) / MINUTE);
            const status = Math.abs(deltaMin) <= toleranceMin ? 'no_horario' : deltaMin < 0 ? 'adiantada' : 'atrasada';
            return { type, planned, actual: entry.startedAt, deltaMin, deltaLabel: formatDelta(deltaMin), status, label: BREAK_TYPES[type].label };
        });
    }

    /* ----- leitura da gestão ----- */

    function teamSummary(state, profiles, users, ts = Date.now(), options = {}) {
        const reference = options.reference == null ? ts : options.reference;
        const rows = Object.keys(users || {})
            .filter(id => isTracked(profiles, id))
            .filter(id => !options.team || options.team === 'Todos' || users[id].team === options.team)
            .filter(id => users[id].active !== false)
            .map(id => {
                const profile = profileOf(profiles, id);
                const summary = daySummary(state, id, ts, profile, reference);
                const slot = options.schedule ? slotFor(options.schedule, weekKey(ts), users[id].team, id, toDate(ts).getDay()) : null;
                return { ...summary, name: users[id].name, team: users[id].team, photo: users[id].photo, initial: users[id].initial, slot, adherence: adherence(summary, slot) };
            })
            .sort((a, b) => b.idleMs - a.idleMs || String(a.name).localeCompare(String(b.name), 'pt-BR'));

        const totals = rows.reduce((acc, row) => ({
            analistas: acc.analistas + 1,
            emPausa: acc.emPausa + (row.status === 'pausa' ? 1 : 0),
            disponiveis: acc.disponiveis + (row.status === 'disponivel' ? 1 : 0),
            offline: acc.offline + (row.status === 'offline' ? 1 : 0),
            atrasos: acc.atrasos + (row.late ? 1 : 0),
            idleMs: acc.idleMs + row.idleMs,
            idleCount: acc.idleCount + row.idleCount,
            overMs: acc.overMs + row.overMs
        }), { analistas: 0, emPausa: 0, disponiveis: 0, offline: 0, atrasos: 0, idleMs: 0, idleCount: 0, overMs: 0 });

        totals.idleMedioMs = totals.analistas ? Math.round(totals.idleMs / totals.analistas) : 0;
        return { rows, totals };
    }

    /* Quem está em pausa não pode receber chamado: o rodízio usa esta lista. */
    /* Amarra a escala publicada ao cronômetro: o horário programado diz quando a
       pessoa deveria sair; a partir da confirmação da saída, conta o tempo corrido
       e compara com o limite do tipo de pausa. É o que a gestão acompanha ao vivo. */
    /* Uma tolerância só, usada nos dois momentos: na hora de liberar a saída e
       depois, ao ler o que aconteceu. Dois números diferentes fariam o sistema
       avisar o analista de uma coisa e mostrar outra para a gestão. */
    const SCHEDULE_TOLERANCE_MIN = 15;

    function scheduleWindow(scheduledAt, toleranceMin = SCHEDULE_TOLERANCE_MIN) {
        const previsto = parseTime(scheduledAt);
        if (!previsto) return null;
        const rotulo = minuto => `${pad(Math.floor(((minuto + 1440) % 1440) / 60))}:${pad(((minuto + 1440) % 1440) % 60)}`;
        return { scheduledAt: previsto.label, from: rotulo(previsto.minutes - toleranceMin), to: rotulo(previsto.minutes + toleranceMin), toleranceMin };
    }

    /* Responde à pergunta que o botão de pausa precisa fazer antes de liberar:
       está na hora combinada? Sem escala publicada não existe hora combinada —
       e cobrar horário que ninguém combinou seria injusto. */
    function windowCheck(type, scheduledAt, ts = Date.now(), toleranceMin = SCHEDULE_TOLERANCE_MIN) {
        const janela = SCHEDULED_TYPES.includes(type) ? scheduleWindow(scheduledAt, toleranceMin) : null;
        if (!janela) return { status: 'sem_escala', deltaMin: null, scheduledAt: null, window: null, offSchedule: false };
        const previsto = atTime(ts, janela.scheduledAt);
        const deltaMin = Math.round((ts - previsto) / MINUTE);
        const status = Math.abs(deltaMin) <= toleranceMin ? 'no_horario' : deltaMin < 0 ? 'adiantado' : 'atrasado';
        return { status, deltaMin, scheduledAt: janela.scheduledAt, window: janela, offSchedule: status !== 'no_horario' };
    }

    function breakWatch(openBreak, scheduledAt, ts = Date.now(), toleranceMin = SCHEDULE_TOLERANCE_MIN) {
        if (!openBreak) return null;
        const spec = BREAK_TYPES[openBreak.type] || {};
        const decorrido = Math.max(0, ts - Number(openBreak.startedAt || ts));
        const limite = spec.limitMin ? spec.limitMin * MINUTE : null;
        const previsto = parseTime(scheduledAt);
        const saidaPrevista = previsto ? atTime(openBreak.startedAt, previsto.label) : null;
        const atrasoSaida = saidaPrevista ? Math.round((openBreak.startedAt - saidaPrevista) / MINUTE) : null;
        return {
            type: openBreak.type,
            label: spec.label || openBreak.type,
            startedAt: openBreak.startedAt,
            elapsedMs: decorrido,
            limitMs: limite,
            remainingMs: limite === null ? null : limite - decorrido,
            exceeded: limite !== null && decorrido > limite,
            scheduledAt: previsto ? previsto.label : null,
            // Positivo, saiu depois do combinado; negativo, saiu antes.
            startDelayMin: atrasoSaida,
            startStatus: atrasoSaida === null ? 'sem_escala' : atrasoSaida > toleranceMin ? 'atrasado' : atrasoSaida < -toleranceMin ? 'adiantado' : 'no_horario',
            // O desvio confirmado na hora da saída viaja junto: é o que a gestão lê.
            offSchedule: openBreak.offSchedule || null
        };
    }

    /* Lista das saídas fora do combinado, com o motivo que o analista escreveu.
       É o que o painel da gestão mostra — sem o motivo, seria só uma acusação. */
    /* Fecha o dia para leitura: num dia passado, "agora" é o fim do expediente, não
       o relógio de hoje. Sem isso, uma pausa esquecida em aberto na terça contaria
       até este instante e inventaria horas que nunca existiram. */
    function endOfDayReference(ts, profile = null) {
        const d = toDate(ts);
        const hoje = dateKey(Date.now()) === dateKey(ts);
        if (hoje) return Date.now();
        const fim = profile ? expectedEnd(profile, ts) : null;
        return fim || new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime();
    }

    /* Comparação entre dois dias: mesmos números, lado a lado, com a diferença.
       É a leitura que responde "como foi ontem?" e "segunda rendeu mais que terça?". */
    const COMPARABLE = ['onlineMs', 'availableMs', 'idleMs', 'restMs', 'overMs', 'lateMs', 'idleCount'];

    function compareDays(state, profiles, users, tsA, tsB, options = {}) {
        const ladoA = teamSummary(state, profiles, users, tsA, { ...options, reference: endOfDayReference(tsA) });
        const ladoB = teamSummary(state, profiles, users, tsB, { ...options, reference: endOfDayReference(tsB) });
        const porPessoa = new Map();
        ladoA.rows.forEach(row => porPessoa.set(row.userId, { userId: row.userId, name: row.name, team: row.team, a: row, b: null }));
        ladoB.rows.forEach(row => {
            const atual = porPessoa.get(row.userId) || { userId: row.userId, name: row.name, team: row.team, a: null, b: null };
            atual.b = row; porPessoa.set(row.userId, atual);
        });
        const rows = [...porPessoa.values()].map(item => ({
            ...item,
            delta: COMPARABLE.reduce((acc, campo) => ({ ...acc, [campo]: Number(item.b?.[campo] || 0) - Number(item.a?.[campo] || 0) }), {})
        })).sort((x, y) => String(x.name).localeCompare(String(y.name), 'pt-BR'));

        // Somar das linhas, não de teamSummary().totals: aquele objeto só agrega parte
        // dos campos, e comparar por ele devolvia zero em restMs, availableMs e onlineMs.
        const soma = (lista, campo) => lista.reduce((total, row) => total + Number(row[campo] || 0), 0);
        const totals = COMPARABLE.reduce((acc, campo) => {
            const a = soma(ladoA.rows, campo), b = soma(ladoB.rows, campo);
            return { ...acc, [campo]: { a, b, delta: b - a } };
        }, {});

        return { dateA: dateKey(tsA), dateB: dateKey(tsB), a: ladoA, b: ladoB, rows, totals, fields: [...COMPARABLE] };
    }

    function offScheduleToday(state, ts = Date.now()) {
        const dia = (state || {})[dateKey(ts)] || {};
        return Object.entries(dia).flatMap(([userId, registro]) => (registro?.breaks || [])
            .filter(item => item.offSchedule?.reason)
            .map(item => ({ userId, type: item.type, label: BREAK_TYPES[item.type]?.label || item.type, startedAt: item.startedAt, ...item.offSchedule })));
    }

    function pausedNow(state, ts = Date.now()) {
        const dia = (state || {})[dateKey(ts)] || {};
        return Object.keys(dia).filter(id => openBreak(dia[id]));
    }

    return {
        BREAK_TYPES, BREAK_ORDER, SCHEDULED_TYPES, WEEKDAYS, DEFAULT_SHIFT, MINUTE,
        dateKey, weekKey, weekDates, weekInfo, weekOfMonth, timeLabel, slotOptions, slotChoices, SLOT_WINDOWS, parseTime, atTime, formatDuration, formatClock,
        profileOf, isTracked, worksOn, expectedStart, expectedEnd,
        shiftLabel, shiftSpanMinutes, withinShift, SHIFT_PRESETS,
        emptyDay, dayOf, ensureDay, openBreak,
        registerLogin, registerLogout, startBreak, endBreak,
        daySummary, summarizeBreaks, teamSummary, pausedNow, breakWatch,
        board, ensureBoard, setSlot, publishWeek, slotFor, adherence, formatDelta,
        distributeWeek, applyPlan, copyWeek, rotationSeed,
        SCHEDULE_TOLERANCE_MIN, scheduleWindow, windowCheck, offScheduleToday, endOfDayReference, compareDays
    };
});

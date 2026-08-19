(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ManagerExperience = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TEAMS = ['Sistema', 'Catraca'];
    /* Departamentos de cadastro. TEAMS continua sendo só onde há ranking de analistas;
       as áreas de apoio existem no organograma mas não competem entre si, então entram
       aqui sem contaminar pódio, filtros gerenciais nem autorização por equipe. */
    /* As áreas do Portal de Prioridades entram aqui. Elas já existiam no organograma —
       são elas que abrem chamado — mas não existiam no cadastro, então não havia como
       registrar alguém do Comercial: o campo Departamento só oferecia Sistema, Catraca e
       as três de apoio. Um teste garante que as duas listas não voltem a divergir. */
    const SUPPORT_DEPARTMENTS = ['Logística', 'Toletus Lab', 'Administrativo', 'Comercial', 'Retenção', 'Financeiro', 'Implantação'];
    const DEPARTMENTS = [...TEAMS, ...SUPPORT_DEPARTMENTS];
    const PERIODS = ['ALL', 'Semana 1', 'Semana 2', 'Semana 3', 'Semana 4', 'Semana 5'];
    const DEFAULT_FILTERS = Object.freeze({ team: 'Todos', analyst: 'Todos', category: 'Geral', month: 'atual', period: 'ALL', cycle: 'atual', cycleStatus: 'Todos' });

    function authorizedTeams(manager, allTeams = TEAMS) {
        if (!manager || manager.active === false || manager.role !== 'Gestor Adm') return [];
        if (manager.allTeamsAccess === true) return allTeams.slice();
        const configured = Array.isArray(manager.managedTeams) ? manager.managedTeams.filter(team => allTeams.includes(team)) : [];
        if (configured.length) return [...new Set(configured)];
        // Sem restrição declarada, a gestão responde pelas duas equipes. Antes o padrão
        // era a própria equipe do gestor, o que escondia Catraca de quem era de Sistema
        // e Sistema de quem era de Catraca — inclusive no módulo de prioridades.
        return allTeams.slice();
    }

    /* Perfis que executam a operação não competem no ranking. A lista estava parada em
       Envio/Coleta e não acompanhou Faturamento, Expedição, Logística e Toletus Lab:
       qualquer um deles lotado em Sistema ou Catraca entrava na lista de analistas. */
    /* `Gestor de Área` entra aqui: quem acompanha o que a própria área abriu no Portal não
       atende chamado, então não entra em ranking, bônus nem premiação — mesma régua do
       Gestor Adm e dos papéis de peça. */
    const NON_RANKED_ROLES = ['Gestor Adm', 'Gestor de Área', 'Envio/Coleta', 'Faturamento', 'Expedição', 'Logística/Faturamento', 'Toletus Lab'];

    function isRankable(user) {
        return Boolean(user && user.active !== false && !NON_RANKED_ROLES.includes(user.role));
    }

    function authorizedAnalysts(users, teams) {
        const allowed = new Set(teams || []);
        return Object.entries(users || {}).filter(([, user]) => isRankable(user) && allowed.has(user.team)).map(([id, user]) => ({ id, ...user }));
    }

    function normalizeFilters(input, context = {}) {
        const filters = { ...DEFAULT_FILTERS, ...(input || {}) };
        const teams = context.authorizedTeams || TEAMS;
        const analysts = context.analysts || [];
        const months = context.months || ['atual'];
        if (filters.team !== 'Todos' && !teams.includes(filters.team)) filters.team = teams.length === 1 ? teams[0] : 'Todos';
        const visibleAnalysts = analysts.filter(item => filters.team === 'Todos' || item.team === filters.team);
        if (filters.analyst !== 'Todos' && !visibleAnalysts.some(item => item.id === filters.analyst)) filters.analyst = 'Todos';
        if (!PERIODS.includes(filters.period)) filters.period = 'ALL';
        if (!months.includes(filters.month)) filters.month = 'atual';
        if (!months.includes(filters.cycle)) filters.cycle = filters.month;
        if (!['Todos', 'Aberto', 'Fechado'].includes(filters.cycleStatus)) filters.cycleStatus = 'Todos';
        if (!['Geral', 'Software', 'Catraca'].includes(filters.category)) filters.category = 'Geral';
        return filters;
    }

    function filterRows(rows, filters, teams) {
        const allowed = new Set(teams || []);
        return (rows || []).filter(row => {
            if (!allowed.has(row.team)) return false;
            if (filters.team !== 'Todos' && row.team !== filters.team) return false;
            if (filters.analyst !== 'Todos' && row.id !== filters.analyst) return false;
            if (filters.category === 'Software' && row.team !== 'Sistema') return false;
            if (filters.category === 'Catraca' && row.team !== 'Catraca') return false;
            return true;
        });
    }

    function rankRows(rows) {
        const grouped = {};
        (rows || []).forEach(row => {
            if (!grouped[row.team]) grouped[row.team] = [];
            grouped[row.team].push({ ...row, confirmedPoints: Number(row.confirmedPoints ?? row.total ?? 0), pendingPoints: Number(row.pendingPoints || 0) });
        });
        // Pontuação igual, posição igual: numerar por ordem alfabética faria dois
        // analistas com os mesmos pontos aparecerem em 1º e 2º sem motivo.
        return Object.values(grouped).flatMap(group => {
            const sorted = group.sort((a, b) => b.confirmedPoints - a.confirmedPoints || a.name.localeCompare(b.name, 'pt-BR'));
            let position = 0; let anterior = null;
            return sorted.map((row, index) => {
                if (anterior === null || row.confirmedPoints !== anterior) { position = index + 1; anterior = row.confirmedPoints; }
                return { ...row, position, tied: false };
            }).map((row, index, todos) => ({ ...row, tied: todos.some((outro, i) => i !== index && outro.position === row.position) }));
        });
    }

    function canViewAnalyst(manager, user, allTeams = TEAMS) {
        return isRankable(user) && authorizedTeams(manager, allTeams).includes(user.team);
    }

    function summarize(rows, requests = []) {
        const safeRows = rows || [];
        const confirmed = safeRows.reduce((sum, row) => sum + Number(row.confirmedPoints || 0), 0);
        const pendingRequests = (requests || []).filter(request => ['pending', 'pendente', 'pending_review', 'in_review', 'correction_requested', 'resubmitted', 'Pendente', 'Em análise', 'Correção solicitada', 'Reenviada'].includes(request.status));
        return {
            analysts: safeRows.length,
            confirmed,
            pending: pendingRequests.reduce((sum, request) => sum + Number(request.expectedPoints || request.points || 0), 0),
            average: safeRows.length ? Math.round(confirmed / safeRows.length) : 0,
            pendingRequests: pendingRequests.length,
            pendingPriorities: pendingRequests.filter(request => request.type === 'priority').length,
            pendingTransfers: pendingRequests.filter(request => request.type === 'transfer').length,
            byTeam: TEAMS.map(team => ({ team, count: safeRows.filter(row => row.team === team).length, points: safeRows.filter(row => row.team === team).reduce((sum, row) => sum + Number(row.confirmedPoints || 0), 0) }))
        };
    }

    function tvProjection(rows) {
        return rankRows(rows).map(row => ({ position: row.position, name: row.name, avatar: row.photo || '', initials: row.initial || '', team: row.team, confirmedPoints: row.confirmedPoints }));
    }

    /* Modo TV: a lista inteira não cabe na tela e vira rolagem que ninguém rola.
       Ficam as quatro primeiras posições e a última — a disputa de cima e a lanterna.
       Time com até TV_TOP+1 pessoas aparece inteiro: recortar 5 para mostrar 5 só
       tiraria gente sem ganhar espaço. O índice original é preservado para que o
       número da posição continue verdadeiro depois do corte. */
    const TV_TOP = 4;
    function tvSlice(list, top = TV_TOP) {
        const rows = Array.isArray(list) ? list : [];
        const limite = Math.max(1, Number(top) || TV_TOP);
        const marcado = rows.map((item, index) => ({ item, index, position: index + 1, isLast: index === rows.length - 1 && rows.length > 1 }));
        if (marcado.length <= limite + 1) return marcado;
        return [...marcado.slice(0, limite), marcado[marcado.length - 1]];
    }

    function serializeFilters(filters) {
        return JSON.stringify({ ...DEFAULT_FILTERS, ...(filters || {}) });
    }

    function restoreFilters(value, context) {
        try { return normalizeFilters(JSON.parse(value || '{}'), context); }
        catch (_) { return normalizeFilters({}, context); }
    }

    return { TEAMS, DEPARTMENTS, SUPPORT_DEPARTMENTS, NON_RANKED_ROLES, PERIODS, DEFAULT_FILTERS, authorizedTeams, authorizedAnalysts, normalizeFilters, filterRows, rankRows, canViewAnalyst, summarize, tvProjection, tvSlice, TV_TOP, serializeFilters, restoreFilters, isRankable };
});

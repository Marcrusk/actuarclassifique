const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const manager = require('../js/manager-experience.js');

const users = {
    gestor: { name: 'Gestor', role: 'Gestor Adm', team: 'Sistema', active: true, managedTeams: ['Sistema'] },
    admin: { name: 'Admin', role: 'Gestor Adm', team: 'Sistema', active: true, allTeamsAccess: true },
    lucas: { name: 'Lucas', role: 'Analista de sistema', team: 'Sistema', active: true },
    arthur: { name: 'Arthur', role: 'Analista de sistema', team: 'Sistema', active: true },
    dyego: { name: 'Dyego', role: 'Analista de catraca', team: 'Catraca', active: true },
    coleta: { name: 'Coleta', role: 'Envio/Coleta', team: 'Catraca', active: true }
};

test('gestor acessa somente equipes explicitamente autorizadas', () => {
    assert.deepEqual(manager.authorizedTeams(users.gestor), ['Sistema']);
    assert.deepEqual(manager.authorizedTeams(users.admin), ['Sistema', 'Catraca']);
});

test('lista gerencial exclui usuários operacionais e respeita departamento', () => {
    assert.deepEqual(manager.authorizedAnalysts(users, ['Sistema']).map(item => item.id), ['lucas', 'arthur']);
    assert.deepEqual(manager.authorizedAnalysts(users, ['Catraca']).map(item => item.id), ['dyego']);
});

test('filtro de departamento limita o conjunto de analistas', () => {
    const analysts = manager.authorizedAnalysts(users, ['Sistema', 'Catraca']);
    const filters = manager.normalizeFilters({ team: 'Catraca', analyst: 'dyego' }, { authorizedTeams: ['Sistema', 'Catraca'], analysts, months: ['atual'] });
    assert.equal(filters.analyst, 'dyego');
    assert.deepEqual(manager.filterRows(analysts, filters, ['Sistema', 'Catraca']).map(row => row.id), ['dyego']);
});

test('analista de outro departamento é removido quando o departamento muda', () => {
    const analysts = manager.authorizedAnalysts(users, ['Sistema', 'Catraca']);
    const filters = manager.normalizeFilters({ team: 'Sistema', analyst: 'dyego' }, { authorizedTeams: ['Sistema', 'Catraca'], analysts, months: ['atual'] });
    assert.equal(filters.analyst, 'Todos');
});

test('período, mês e ciclo inválidos retornam aos valores seguros', () => {
    const filters = manager.normalizeFilters({ period: 'Semana 9', month: 'inexistente', cycle: 'inexistente' }, { authorizedTeams: ['Sistema'], analysts: [], months: ['atual', 'm1'] });
    assert.equal(filters.period, 'ALL');
    assert.equal(filters.month, 'atual');
    assert.equal(filters.cycle, 'atual');
});

test('filtros são preservados e restaurados durante a navegação', () => {
    const context = { authorizedTeams: ['Sistema', 'Catraca'], analysts: manager.authorizedAnalysts(users, ['Sistema', 'Catraca']), months: ['atual', 'm1'] };
    const source = { team: 'Sistema', analyst: 'lucas', month: 'm1', cycle: 'm1', period: 'Semana 2' };
    assert.deepEqual(manager.restoreFilters(manager.serializeFilters(source), context), manager.normalizeFilters(source, context));
});

test('tentativa de equipe pela URL não amplia o escopo do gestor', () => {
    const analysts = manager.authorizedAnalysts(users, ['Sistema']);
    const filters = manager.normalizeFilters({ team: 'Catraca', analyst: 'dyego' }, { authorizedTeams: ['Sistema'], analysts, months: ['atual'] });
    assert.equal(filters.team, 'Sistema');
    assert.equal(filters.analyst, 'Todos');
});

test('gestor abre ficha autorizada e recebe bloqueio para outra equipe', () => {
    assert.equal(manager.canViewAnalyst(users.gestor, users.lucas), true);
    assert.equal(manager.canViewAnalyst(users.gestor, users.dyego), false);
});

test('ranking usa somente pontuação confirmada e preserva a pendência separada', () => {
    const ranked = manager.rankRows([
        { id: 'lucas', name: 'Lucas', team: 'Sistema', confirmedPoints: 100, pendingPoints: 500 },
        { id: 'arthur', name: 'Arthur', team: 'Sistema', confirmedPoints: 120, pendingPoints: 0 }
    ]);
    assert.equal(ranked.find(row => row.id === 'arthur').position, 1);
    assert.equal(ranked.find(row => row.id === 'lucas').position, 2);
});

test('totais do resumo utilizam a mesma pontuação confirmada do ranking', () => {
    const rows = manager.rankRows([{ id: 'lucas', name: 'Lucas', team: 'Sistema', confirmedPoints: 100 }, { id: 'arthur', name: 'Arthur', team: 'Sistema', confirmedPoints: 120 }]);
    assert.equal(manager.summarize(rows, []).confirmed, 220);
    assert.equal(manager.summarize(rows, []).average, 110);
});

test('solicitações pendentes aparecem como previsão sem alterar o total oficial', () => {
    const summary = manager.summarize([{ id: 'lucas', team: 'Sistema', confirmedPoints: 100 }], [{ type: 'priority', status: 'Pendente', expectedPoints: 50 }]);
    assert.equal(summary.confirmed, 100);
    assert.equal(summary.pending, 50);
    assert.equal(summary.pendingPriorities, 1);
});

test('Modo TV expõe somente campos públicos permitidos', () => {
    const tv = manager.tvProjection([{ id: 'lucas', name: 'Lucas', team: 'Sistema', photo: 'foto', email: 'privado@actuar.com', status: 'active', evidence: 'sigilosa', confirmedPoints: 100, pendingPoints: 50 }]);
    assert.deepEqual(Object.keys(tv[0]).sort(), ['avatar', 'confirmedPoints', 'initials', 'name', 'position', 'team'].sort());
    assert.equal(JSON.stringify(tv).includes('privado@actuar.com'), false);
    assert.equal(JSON.stringify(tv).includes('sigilosa'), false);
});

test('estado sem resultado é representado por lista e resumo vazios', () => {
    assert.deepEqual(manager.filterRows([], manager.DEFAULT_FILTERS, ['Sistema']), []);
    assert.equal(manager.summarize([], []).analysts, 0);
});

test('módulo de prioridades integra visão, aprovações, lançamentos, ranking e configuração do Modo TV', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    for (const marker of ['priorityModuleShell', 'priorityModuleTabOverview', 'priorityModuleTabApprovals', 'priorityModuleTabLaunches', 'priorityModuleTabRanking', 'admPanelPriorityLaunches', 'priorityApprovalReviewDrawer', 'priorityComplementModal', 'priorityDecisionReviewModal', 'priorityAttendanceRecordsForTeam', 'evaluationComplements', 'evaluationVersion', 'PRIORITY_ADJUSTMENT', 'managerTvConfigModal', 'renderPriorityRotationOverviewPanel', 'renderPriorityRotationLast', 'renderPriorityRotationPrimary', 'renderPriorityRotationSequence', 'openManagerAnalyst', 'closeRankingPresentation', 'togglePresentationFullscreen']) assert.match(html, new RegExp(marker));
});

test('fluxos gerenciais principais possuem adaptação responsiva', () => {
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    assert.match(css, /@media \(max-width: 768px\)[\s\S]*manager-filter-grid/);
    assert.match(css, /manager-kpi-grid/);
    assert.match(css, /manager-consultation-banner/);
    assert.match(css, /priority-module-tabs/);
    assert.match(css, /priority-approval-filters/);
    assert.match(css, /priority-ranking-summary/);
    assert.match(css, /priority-attendance-card/);
    assert.match(css, /priority-detail-evaluation/);
    assert.match(css, /priority-opinion-complement/);
    assert.match(css, /rotation-ops-primary/);
    assert.match(css, /rotation-ops-sequence-row/);
    assert.match(css, /rotation-ops-footer/);
});

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

test('pontuação igual compartilha a mesma posição no ranking', () => {
    const rows = [
        { id: 'dyego', name: 'Dyego Antônio', team: 'Catraca', confirmedPoints: 150 },
        { id: 'vitor', name: 'Vitor Massaki', team: 'Catraca', confirmedPoints: 150 },
        { id: 'felipe', name: 'Felipe Lima', team: 'Catraca', confirmedPoints: 100 },
        { id: 'ana', name: 'Ana Souza', team: 'Catraca', confirmedPoints: 80 }
    ];
    const ranked = manager.rankRows(rows);
    const posicao = id => ranked.find(row => row.id === id).position;

    // Antes a ordem alfabética desempatava e Vitor caía em 2º com os mesmos 150 pts.
    assert.equal(posicao('dyego'), 1);
    assert.equal(posicao('vitor'), 1);
    assert.equal(posicao('felipe'), 3, 'depois de um empate duplo a próxima posição é a terceira');
    assert.equal(posicao('ana'), 4);

    assert.equal(ranked.find(row => row.id === 'dyego').tied, true);
    assert.equal(ranked.find(row => row.id === 'felipe').tied, false);
});

test('cabeçalho de card acomoda a ação ao lado do texto', () => {
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    // Sem layout no header, o botão de ação caía para baixo da descrição.
    assert.match(css, /\.actuar-card-header \{ display: flex;[^}]*justify-content: space-between;/);
    // A prévia do ranking tem uma coluna a mais que a lista de pendências:
    // posição, avatar, nome e pontos — quem estica é o nome.
    assert.match(css, /\.priority-preview-ranking > button \{ grid-template-columns: auto auto minmax\(0,1fr\) auto;/);
});

test('gestão responde pelas duas equipes quando não há restrição declarada', () => {
    const marco = { name: 'Marco Nunes', team: 'Sistema', role: 'Gestor Adm', active: true };
    const joao = { name: 'João Gabriel', team: 'Catraca', role: 'Gestor Adm', active: true };

    // Antes o padrão era a própria equipe: Marco não via Catraca e João não via Sistema.
    assert.deepEqual(manager.authorizedTeams(marco), ['Sistema', 'Catraca']);
    assert.deepEqual(manager.authorizedTeams(joao), ['Sistema', 'Catraca']);

    // Restrição explícita continua valendo, para quando existir configuração.
    assert.deepEqual(manager.authorizedTeams({ ...joao, managedTeams: ['Catraca'] }), ['Catraca']);
    assert.deepEqual(manager.authorizedTeams({ ...joao, allTeamsAccess: true }), ['Sistema', 'Catraca']);

    // Quem não é gestão, ou está inativo, segue sem escopo nenhum.
    assert.deepEqual(manager.authorizedTeams({ ...joao, role: 'Analista de catraca' }), []);
    assert.deepEqual(manager.authorizedTeams({ ...joao, active: false }), []);
});

test('todo asset local é versionado para a correção chegar ao navegador', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const build = fs.readFileSync('scripts/build-check.cjs', 'utf8');

    const referencias = [...html.matchAll(/(?:src|href)="((?:js|styles)\/[^"]+)"/g)].map(m => m[1]);
    assert.ok(referencias.length >= 7, 'esperava as referências locais de js e css');
    const semVersao = referencias.filter(ref => !/\?v=[^"]+$/.test(ref));
    assert.deepEqual(semVersao, [], `asset servido sem versão: ${semVersao.join(', ')}`);

    // Uma única versão por publicação: arquivos com versões diferentes escondem regressões.
    const versoes = [...new Set(referencias.map(ref => ref.split('?v=')[1]))];
    assert.equal(versoes.length, 1, `versões divergentes entre assets: ${versoes.join(', ')}`);

    // E o build recusa a publicação se alguém esquecer.
    assert.match(build, /Asset local sem versão na URL/);
});

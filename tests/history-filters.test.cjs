const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');

/* A tela de histórico desenhava uma linha diferente por tipo, com colspan invadindo colunas
   que só faziam sentido no lançamento semanal — a tabela mudava de forma a cada linha. E o
   tipo PECA não tinha ramo nenhum: a pontuação de peça simplesmente não aparecia. */

function bloco(inicio, fim) {
    const start = html.indexOf(inicio);
    const end = html.indexOf(fim, start + 1);
    assert.ok(start > -1 && end > start, `bloco não encontrado: ${inicio}`);
    return html.slice(start, end);
}

// historyRows() monta as linhas a partir do store: extrai e executa com um store falso.
function carregarHistoryRows({ store, admin = false, auditor = true }) {
    const fonte = bloco('function historyRows()', 'function filteredHistoryRows()');
    const factory = new Function(
        'getStore', 'defaultUsers', 'isAdminLoggedIn', 'isRankableUser', 'canManagerViewAnalyst',
        'canAuditDeletedPieces', 'escapeHtml',
        `${fonte}; return historyRows;`
    );
    return factory(() => store, store.users, admin, () => true, () => true, () => auditor, value => String(value ?? ''));
}

const store = {
    users: {
        dyego: { name: 'Dyego', team: 'Catraca', role: 'Analista de catraca', active: true },
        lucas: { name: 'Lucas', team: 'Sistema', role: 'Analista de sistema', active: true },
        marco_adm: { name: 'Marco Nunes', team: 'Sistema', role: 'Gestor Adm', active: true }
    },
    logs: [
        { id: 'l1', type: 'WEEKLY', userId: 'dyego', week: 'Semana 1', resolvidos: 10, atendidos: 12, nps: 90, value: 30, timestamp: 1000 },
        { id: 'l2', type: 'PENALTY', userId: 'lucas', reason: 'Atraso', value: -5, timestamp: 2000 },
        { id: 'l3', type: 'PRIORITY', userId: 'dyego', protocolo: 'PR-77', value: 50, timestamp: 3000 },
        { id: 'l4', type: 'PECA', userId: 'lucas', tipo: 'Envio', clientId: 'CLI-9', value: 12, timestamp: 4000 },
        { id: 'l5', type: 'DESCONHECIDO', userId: 'dyego', value: 1, timestamp: 5000 }
    ],
    deletedPieceOperations: [
        { id: 'piece_1', protocol: 'PC-001', analystId: 'dyego', deletedBy: 'marco_adm', deletedAt: 6000, reason: 'chamado de teste', removedPoints: 12 }
    ]
};

test('a pontuação de peça passa a aparecer no histórico', () => {
    const rows = carregarHistoryRows({ store })();
    const peca = rows.find(row => row.type === 'PECA');
    assert.ok(peca, 'o tipo PECA não tinha ramo de renderização e ficava invisível');
    assert.equal(peca.points, 12);
    assert.match(peca.detail, /Envio/);
    assert.match(peca.detail, /CLI-9/);
});

test('a exclusão entra como linha de estorno, com autor e motivo', () => {
    const rows = carregarHistoryRows({ store })();
    const excluida = rows.find(row => row.type === 'DELETED');
    assert.equal(excluida.points, -12, 'o estorno aparece como pontuação negativa');
    assert.match(excluida.detail, /PC-001/);
    assert.match(excluida.detail, /chamado de teste/);
    assert.match(excluida.note, /Marco Nunes/);
    assert.equal(excluida.removable, false, 'registro de auditoria não se apaga pela lista');
});

test('sem permissão de auditoria, a exclusão não vaza para a tabela', () => {
    const rows = carregarHistoryRows({ store, auditor: false })();
    assert.equal(rows.filter(row => row.type === 'DELETED').length, 0);
});

test('tipo desconhecido não vira linha torta', () => {
    // Antes o log caía fora de todos os if/else e sumia sem aviso; agora é descarte explícito.
    const rows = carregarHistoryRows({ store })();
    assert.equal(rows.some(row => row.id === 'l5'), false);
});

test('as linhas vêm da mais recente para a mais antiga', () => {
    const rows = carregarHistoryRows({ store })();
    const marcas = rows.map(row => row.timestamp);
    assert.deepEqual(marcas, [...marcas].sort((a, b) => b - a));
});

test('cada linha carrega um texto de busca com os campos que o gestor digitaria', () => {
    const rows = carregarHistoryRows({ store })();
    assert.match(rows.find(row => row.id === 'l3').search, /PR-77/);
    assert.match(rows.find(row => row.id === 'l3').search, /Dyego/);
    assert.match(rows.find(row => row.type === 'DELETED').search, /chamado de teste/);
});

test('a tabela tem colunas fixas, sem colspan disputando o layout', () => {
    const painel = bloco('id="admPanelHistorico"', 'FIM PAINEL HISTÓRICO');
    for (const coluna of ['Data/Hora', 'Usuário', 'Tipo', 'Detalhe', 'Pontos', 'Ações']) {
        assert.ok(painel.includes(`<th class="p-3">${coluna}</th>`), `coluna ausente: ${coluna}`);
    }
    // As colunas antigas só serviam ao lançamento semanal e eram sequestradas pelos demais tipos.
    assert.doesNotMatch(painel, /<th class="p-3">Resolvidos \/ Atendidos<\/th>/);
    assert.doesNotMatch(painel, /<th class="p-3">NPS<\/th>/);

    const render = bloco('function renderAdminLogs()', '\n        // Uma lista só de departamentos');
    assert.doesNotMatch(render, /colspan="2"/, 'nenhuma linha deve invadir a coluna vizinha');
    assert.match(render, /colspan="6"/, 'só o estado vazio ocupa a largura toda');
});

test('os filtros cobrem analista, tipo, período e busca livre', () => {
    const painel = bloco('id="admPanelHistorico"', 'FIM PAINEL HISTÓRICO');
    for (const campo of ['admHistorySearch', 'admHistoryUser', 'admHistoryType', 'admHistoryFrom', 'admHistoryTo']) {
        assert.ok(painel.includes(`id="${campo}"`), `filtro ausente: ${campo}`);
    }
    assert.match(painel, /onclick="clearHistoryFilters\(\)"/);
    assert.match(painel, /oninput="applyHistoryFilters\(\)"/, 'a busca responde enquanto se digita');
    assert.match(painel, /id="admHistorySummary"/, 'o recorte precisa dizer quantos registros sobraram');
});

test('o recorte por data cobre o dia inteiro nas duas pontas', () => {
    // Com 'De' e 'Até' no mesmo dia, um recorte por meia-noite devolveria lista vazia.
    const filtro = bloco('function filteredHistoryRows()', 'function applyHistoryFilters()');
    assert.match(filtro, /T00:00:00/);
    assert.match(filtro, /T23:59:59/);
});

test('a lista de analistas do filtro sai de quem tem registro', () => {
    const popula = bloco('function populateHistoryUserFilter()', 'function renderAdminLogs()');
    assert.match(popula, /historyRows\(\)\.map\(row => row\.userId\)/);
    assert.match(popula, /localeCompare/, 'ordem alfabética para achar a pessoa na lista');
});

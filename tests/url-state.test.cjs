const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const manager = require('../js/manager-experience.js');

/* A URL só deve carregar o que foge do padrão. Antes os dois escritores gravavam todos os
   filtros sempre, e o endereço virava uma fila de defaults
   (?analyst=dyego&ranking=Sistema&month=atual&period=ALL&mgrTeam=Todos&...#/admin/visao)
   que escondia justamente o filtro que estava valendo. */

const html = fs.readFileSync('index.html', 'utf8');

// syncUrlParams é declarada no script inline do shell: extrai o trecho e executa de verdade,
// em vez de conferir a regra por regex.
function loadSyncUrlParams() {
    const start = html.indexOf('function syncUrlParams(entries) {');
    const end = html.indexOf('function persistViewContext()');
    assert.ok(start > -1 && end > start, 'syncUrlParams precisa continuar no shell do index.html');
    const source = html.slice(start, end);
    return new Function('window', `${source}; return syncUrlParams;`);
}

function fakeWindow(href) {
    const current = { href };
    return {
        location: { get href() { return current.href; } },
        history: {
            state: { actuarRoute: { name: 'admin', section: 'visao' } },
            replaceState(state, _title, url) {
                this.state = state;
                current.href = new URL(url, current.href).href;
            }
        },
        get href() { return current.href; }
    };
}

test('filtro no padrão sai da URL e a rota é preservada', () => {
    const win = fakeWindow('http://127.0.0.1:8000/?analyst=dyego&ranking=Sistema&month=atual&period=ALL#/admin/visao');
    loadSyncUrlParams()(win)([
        ['analyst', null, null],
        ['ranking', 'Sistema', 'Sistema'],
        ['month', 'atual', 'atual'],
        ['period', 'ALL', 'ALL']
    ]);
    assert.equal(win.href, 'http://127.0.0.1:8000/#/admin/visao');
});

test('filtro fora do padrão continua na URL, e só ele', () => {
    const win = fakeWindow('http://127.0.0.1:8000/#/admin/visao');
    loadSyncUrlParams()(win)([
        ['mgrTeam', 'Catraca', 'Todos'],
        ['mgrAnalyst', 'Todos', 'Todos'],
        ['mgrRanking', 'Geral', 'Geral'],
        ['mgrMonth', 'atual', 'atual'],
        ['mgrPeriod', 'Semana 2', 'ALL'],
        ['mgrCycle', 'atual', 'atual'],
        ['mgrCycleStatus', 'Todos', 'Todos']
    ]);
    const url = new URL(win.href);
    assert.deepEqual([...url.searchParams.keys()], ['mgrTeam', 'mgrPeriod']);
    assert.equal(url.searchParams.get('mgrTeam'), 'Catraca');
    assert.equal(url.searchParams.get('mgrPeriod'), 'Semana 2');
    assert.equal(url.hash, '#/admin/visao');
});

test('voltar ao padrão remove o parâmetro que estava na URL', () => {
    const win = fakeWindow('http://127.0.0.1:8000/?mgrTeam=Catraca#/admin/visao');
    loadSyncUrlParams()(win)([['mgrTeam', 'Todos', 'Todos']]);
    assert.equal(win.href, 'http://127.0.0.1:8000/#/admin/visao');
});

test('a sincronização preserva o estado de histórico da navegação', () => {
    const win = fakeWindow('http://127.0.0.1:8000/#/admin/visao');
    const antes = win.history.state;
    loadSyncUrlParams()(win)([['mgrTeam', 'Catraca', 'Todos']]);
    assert.deepEqual(win.history.state, antes, 'trocar filtro não pode apagar actuarRoute/actuarBackRoute');
});

test('a URL nunca volta a expor a identidade do analista', () => {
    // ?analyst= deixou de ser lido pelo restore: mantê-lo só vazava o id de um colega em
    // link compartilhado. Segue na lista de escrita para limpar endereços antigos.
    const win = fakeWindow('http://127.0.0.1:8000/?analyst=dyego#/dashboard');
    loadSyncUrlParams()(win)([['analyst', null, null]]);
    assert.equal(win.href, 'http://127.0.0.1:8000/#/dashboard');

    const trecho = html.slice(html.indexOf('function persistViewContext()'), html.indexOf('function restoreViewContext()'));
    assert.doesNotMatch(trecho, /searchParams\.set\('analyst'/);
    assert.match(html, /userId: analystSession/, 'a identidade continua vindo da sessão autenticada');
});

test('o padrão dos filtros gerenciais vem do domínio, sem literal duplicado no shell', () => {
    const trecho = html.slice(html.indexOf('function persistManagerFilters()'), html.indexOf('function restoreManagerFilters()'));
    assert.match(trecho, /ManagerExperience\?\.DEFAULT_FILTERS/);
    assert.match(trecho, /syncUrlParams\(/);
    assert.doesNotMatch(trecho, /searchParams\.set\(/, 'a escrita passa a ser centralizada em syncUrlParams');
});

test('a abertura normaliza uma URL antiga cheia de defaults', () => {
    // Regressão: restore* rodava no boot, persist* só na troca de filtro. Um endereço vindo de
    // favorito, histórico ou autocomplete da barra atravessava a sessão inteira sujo.
    const trecho = html.slice(html.indexOf("document.getElementById('loadingOverlay').classList.add('hidden');"), html.indexOf('function getStore()'));
    assert.match(trecho, /restoreViewContext\(\);[\s\S]*if \(isAdminLoggedIn\) persistManagerFilters\(\);/, 'a limpeza precisa vir depois do restore');
    assert.match(trecho, /initializeNavigation\(\);/, 'a rota continua sendo aplicada após a limpeza');

    // Os parâmetros de visão saem pelo persistViewContext() que fecha populateDropdowns():
    // é o que dispensa uma segunda chamada no boot.
    const inicio = html.indexOf('function populateDropdowns()');
    assert.ok(inicio > -1, 'populateDropdowns precisa continuar no shell do index.html');
    const dropdowns = html.slice(inicio, html.indexOf('\n        }', inicio));
    assert.match(dropdowns, /persistViewContext\(\);/);
});

test('sem o domínio carregado a URL não é reescrita por precaução', () => {
    // O shell é avaliado antes de js/manager-experience.js. Cair para {} faria todo valor
    // diferir de undefined e gravar os sete mgr* de volta — o ruído que a mudança removeu.
    const trecho = html.slice(html.indexOf('function persistManagerFilters()'), html.indexOf('function restoreManagerFilters()'));
    assert.match(trecho, /const defaults = window\.ManagerExperience\?\.DEFAULT_FILTERS;/);
    assert.match(trecho, /if \(!defaults\) return;/);
    assert.doesNotMatch(trecho, /DEFAULT_FILTERS \|\| \{\}/);
});

test('omitir o parâmetro entrega exatamente o filtro padrão no restore', () => {
    // É o que sustenta a limpeza: o que sai da URL é reconstruído idêntico pelo domínio.
    const context = { authorizedTeams: ['Sistema', 'Catraca'], analysts: [], months: ['atual'] };
    assert.deepEqual(manager.normalizeFilters({}, context), { ...manager.DEFAULT_FILTERS });
    assert.deepEqual(
        manager.normalizeFilters({ team: 'Catraca', period: 'Semana 2' }, context),
        { ...manager.DEFAULT_FILTERS, team: 'Catraca', period: 'Semana 2' }
    );
});

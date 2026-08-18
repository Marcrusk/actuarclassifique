const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nav = require('../js/actuar-navigation.js');

const html = fs.readFileSync('index.html', 'utf8');
const item = (arvore, id) => arvore.flatMap(g => g.items).find(i => i.id === id);

/* O histórico de prioridades do analista existia só como trecho no fim de uma tela longa:
   quem queria consultar um lançamento antigo precisava saber que ele estava lá embaixo.
   Virou seção da rota (#/priorities/historico), então entra no menu e vira link. */

test('o analista alcança o histórico pelo menu, dentro de Prioridades', () => {
    const arvore = nav.build({ mode: 'analyst', publicTabs: {} });
    const prioridades = item(arvore, 'priorities');
    assert.ok(prioridades.children, 'Prioridades ramifica: são duas rotas de verdade');
    assert.deepEqual(prioridades.children.map(filho => filho.label), ['Visão geral', 'Histórico']);
    assert.deepEqual(prioridades.children.map(filho => filho.route), [
        { name: 'priorities' },
        { name: 'priorities', section: 'historico' }
    ]);
});

test('o menu marca o item certo em cada uma das duas rotas', () => {
    const arvore = nav.build({ mode: 'analyst', publicTabs: {} });
    assert.deepEqual(nav.activeFor(arvore, { name: 'priorities', section: 'historico' }),
        { groupId: 'desempenho', itemId: 'priorities', childId: 'priorities-historico' });
    assert.deepEqual(nav.activeFor(arvore, { name: 'priorities' }),
        { groupId: 'desempenho', itemId: 'priorities', childId: 'priorities-visao' });

    assert.deepEqual(nav.breadcrumb(arvore, { name: 'priorities', section: 'historico' }), ['Prioridades', 'Histórico']);
});

test('a subseção navega, para o endereço acompanhar o que está na tela', () => {
    // Sem rota, clicar na subseção deixava a URL apontando para a outra tela — e recarregar
    // devolvia a pessoa para o topo.
    const cabecalho = html.slice(html.indexOf('<nav aria-label="Seções de Prioridades">'),
        html.indexOf('</nav>', html.indexOf('<nav aria-label="Seções de Prioridades">')));
    assert.match(cabecalho, /id="analystPriorityTabHistory"/);
    assert.match(cabecalho, /navigateTo\(\{ name: 'priorities', section: 'historico' \}\)/);
});

test('a gestão chega ao histórico pelo módulo de Prioridades', () => {
    const arvore = nav.build({ mode: 'manager' });
    const filhos = item(arvore, 'prioridades').children;
    const lancamentos = filhos.find(filho => filho.route.section === 'priorityLaunches');
    assert.ok(lancamentos, 'a tela de lançamentos precisa continuar no menu de Prioridades');
    assert.deepEqual(nav.activeFor(arvore, { name: 'admin', section: 'priorityLaunches' }).itemId, 'prioridades');
});

test('acesso operacional não ganha prioridades', () => {
    // Toletus Lab, Logística e Envio/Coleta estão em NON_RANKED_ROLES: não registram
    // atendimento prioritário, então a tela viria vazia e só confundiria.
    const lab = nav.build({ mode: 'operations', publicTabs: { envio: true, coleta: true } });
    const rotulos = lab.flatMap(g => g.items).flatMap(i => [i.label, ...(i.children || []).map(c => c.label)]);
    assert.ok(!rotulos.includes('Prioridades'));
    assert.ok(!rotulos.includes('Histórico'));
});

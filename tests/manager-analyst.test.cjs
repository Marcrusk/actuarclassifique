const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nav = require('../js/actuar-navigation.js');

/* ==========================================================================
   TELA ANALISTA
   Ranking geral e a ficha de um analista eram a mesma entrada de menu: a ficha
   era um sub-estado alcançável só por clique no pódio, e por isso o filtro de
   Departamento/Analista tinha de aparecer no Ranking para servir aos dois. Quem
   entrava para ver a classificação levava junto um seletor de pessoa que não
   mudava classificação nenhuma — e mexer nele desviava a tela.

   Agora são duas telas: Ranking geral mostra o ranking, e Analista é item
   próprio da sidebar, governado inteiramente pelo filtro do topo.
   ========================================================================== */

const html = () => fs.readFileSync('index.html', 'utf8');

test('Ranking geral e Analista são dois itens do menu, no mesmo grupo', () => {
    const arvore = nav.build({ mode: 'manager' });
    const desempenho = arvore.find(grupo => grupo.id === 'desempenho');

    assert.deepEqual(desempenho.items.map(item => item.label),
        ['Ranking geral', 'Analista', 'Métricas operacionais', 'Ciclos e Fechamento']);

    const analista = desempenho.items.find(item => item.id === 'analista');
    assert.deepEqual(analista.route, { name: 'admin', section: 'analista' });
    // Sem filhos: a ficha é uma tela só, o recorte é do filtro e não do menu.
    assert.equal(analista.children, undefined);

    // Cada rota acende o seu item, e só o seu.
    assert.equal(nav.activeFor(arvore, { name: 'admin', section: 'analista' }).itemId, 'analista');
    assert.equal(nav.activeFor(arvore, { name: 'admin', section: 'rankingGeral' }).itemId, 'rankingGeral');
});

test('o filtro do topo vive na tela Analista e sumiu do Ranking geral', () => {
    const escopo = html().slice(html().indexOf('const TOOLBAR_SCOPE = {'), html().indexOf('const TOOLBAR_ROUTES = {'));

    assert.match(escopo, /analista:\s*\{ periodo: true,  contexto: true  \}/);
    assert.match(escopo, /rankingGeral:\s*\{ periodo: false, contexto: false \}/);
});

test('sem analista escolhido a tela convida a escolher, em vez de abrir a ficha de alguém', () => {
    const doc = html();

    // O estado vazio existe e é irmão do host onde a ficha é encaixada.
    assert.match(doc, /id="managerAnalystEmpty"/);
    assert.ok(doc.indexOf('id="managerSectionHost"') < doc.indexOf('id="managerAnalystEmpty"'));

    /* A ficha só é exibida com alguém escolhido. Sem esta condição, abrir "Analista"
       pelo menu mostraria o primeiro da lista — dado de uma pessoa que ninguém pediu. */
    assert.match(doc, /const comAnalista = noAnalista && Boolean\(managerSelectedAnalystId\(\)\);/);
    assert.match(doc, /document\.getElementById\('viewAgent'\)\?\.classList\.toggle\('hidden', !comAnalista\);/);
    assert.match(doc, /document\.getElementById\('managerAnalystEmpty'\)\?\.classList\.toggle\('hidden', !\(noAnalista && !comAnalista\)\);/);
    assert.match(doc, /parkManagerView\('viewAgent', comAnalista\);/);

    // E o título da página acompanha: sem escolha, não inventa nome.
    assert.match(doc, /\{ title: 'Analista', description: 'Escolha um analista no filtro do topo/);
});

test('quem está à vista vem do filtro, e "Todos" significa ninguém ainda', () => {
    const doc = html();
    const trecho = doc.slice(doc.indexOf('function managerSelectedAnalystId()'), doc.indexOf('function parkManagerView'));

    assert.match(trecho, /const id = managerFilters\.analyst;/);
    assert.match(trecho, /if \(!id \|\| id === 'Todos'\) return '';/);
    // A permissão continua valendo: filtro guardado não vira acesso.
    assert.match(trecho, /return canManagerViewAnalyst\(id\) \? id : '';/);
});

test('clicar no pódio e escolher no filtro chegam ao mesmo estado', () => {
    const doc = html();
    const trecho = doc.slice(doc.indexOf('function openManagerAnalyst(id'), doc.indexOf('function renderManagerConsultationBanner'));

    /* O clique no ranking preenche o MESMO filtro que a barra preenche. Sem isto a
       tela mostraria a pessoa clicada enquanto o filtro seguia em "Todos" — e o
       estado vazio brigaria com a ficha aberta. */
    assert.match(trecho, /managerFilters\.analyst = id;/);
    assert.match(trecho, /navigateTo\(\{ name: 'admin', section: 'analista' \}\);/);
    // A volta ao ranking guarda o filtro de antes, então o snapshot vem primeiro.
    assert.ok(trecho.indexOf('managerConsultationSource = {') < trecho.indexOf('managerFilters.analyst = id;'));
});

test('o vazio do seletor desfaz a escolha em vez de acusar o gestor', () => {
    const doc = html();
    const trecho = doc.slice(doc.indexOf('function switchAgent(val)'), doc.indexOf('function changeMonthView'));

    /* `canOpenAnalystDetails('')` é falso, então sem este ramo escolher "Selecione um
       analista" mostraria "este analista não pertence ao seu escopo de gestão". */
    assert.match(trecho, /if \(!val && isAdminLoggedIn\) \{ clearManagerAnalystSelection\(\); return; \}/);

    const limpa = doc.slice(doc.indexOf('function clearManagerAnalystSelection()'), doc.indexOf('function openManagerAnalyst'));
    // O padrão vem do domínio, não de um literal repetido no shell.
    assert.match(limpa, /managerFilters\.analyst = window\.ManagerExperience\.DEFAULT_FILTERS\.analyst;/);
    assert.match(limpa, /persistManagerFilters\(\);/);
});

test('o seletor oferece o vazio só para a gestão, e nunca vira identidade', () => {
    const doc = html();
    const trecho = doc.slice(doc.indexOf('function populateAnalystDropdown(team)'), doc.indexOf('let attendanceFilters'));

    // O analista não tem estado vazio: ele só tem a si mesmo.
    assert.match(trecho, /const semEscolha = isAdminLoggedIn && !managerSelectedAnalystId\(\);/);
    assert.match(trecho, /isAdminLoggedIn \? '<option value="">Selecione um analista<\/option>' : ''/);
    assert.match(trecho, /if \(semEscolha\) \{ select\.value = ''; return; \}/);

    /* O placeholder nunca pode ser adotado como `currentActiveUser`: é sobre ele que a
       tela de ponto age, e uma identidade vazia em contexto é pior que nenhuma. */
    assert.match(trecho, /const opcoesReais = \[\.\.\.select\.options\]\.filter\(option => option\.value\);/);
    assert.match(trecho, /if \(opcoesReais\.length > 0\) \{/);
});

test('a faixa da tela Analista diz quem está à vista e sob que identidade', () => {
    const doc = html();
    const trecho = doc.slice(doc.indexOf('function renderManagerSectionHeader()'), doc.indexOf('function clearManagerAnalystSelection'));

    // Só aparece com alguém escolhido — sem escolha, quem fala é o estado vazio.
    assert.match(trecho, /const id = managerSection\(\) === 'analista' \? managerSelectedAnalystId\(\) : '';/);
    assert.match(trecho, /faixa\.classList\.toggle\('hidden', !id\);/);
    // A garantia que o commit do isolamento deixou: consulta não é atuação.
    assert.match(trecho, /Somente leitura · você é/);
    // A trilha não aponta mais para o Ranking geral como tela mãe.
    assert.doesNotMatch(trecho, /switchAdminTab\('rankingGeral'\)/);
});

test('o estado vazio usa tokens do Design System, sem hex solto', () => {
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    const bloco = css.slice(css.indexOf('.manager-analyst-empty {'), css.indexOf('.manager-analyst-empty strong'));

    assert.ok(bloco.length > 0, 'o estado vazio precisa de estilo próprio');
    assert.doesNotMatch(bloco, /#[0-9a-fA-F]{3,8}\b/, 'cor literal no lugar de token --actuar-*');
    assert.match(bloco, /var\(--actuar-primary\)/);
    assert.match(bloco, /var\(--actuar-text-secondary\)/);
});

test('trocar de departamento não deixa filtro e ficha apontando para pessoas diferentes', () => {
    const doc = html();
    const trecho = doc.slice(doc.indexOf('function onTeamSelectChange(team)'), doc.indexOf('function populateAnalystDropdown'));

    /* Sem isto, escolher Catraca com um analista de Software selecionado deixava a
       barra oferecendo os de Catraca e a ficha do de Software aberta por baixo. */
    assert.match(trecho, /const escolhido = isAdminLoggedIn \? managerSelectedAnalystId\(\) : '';/);
    assert.match(trecho, /if \(escolhido && getStore\(\)\?\.users\?\.\[escolhido\]\?\.team !== team\) \{/);

    /* E o departamento da barra segue o filtro, não o analista que ficou em contexto:
       seguindo `currentActiveUser`, a troca era desfeita no render seguinte. */
    const dropdowns = doc.slice(doc.indexOf('function populateDropdowns()'), doc.indexOf('function populateCatracaAnalystOptions'));
    assert.match(dropdowns, /const emFoco = isAdminLoggedIn \? managerSelectedAnalystId\(\) : currentActiveUser;/);
    assert.match(dropdowns, /const selectedUser = usersList\[emFoco\];/);
});

test('entrar em Analista pelo menu preenche o seletor da barra', () => {
    const doc = html();
    const admin = doc.slice(doc.indexOf('const analistaNaGestao = secao'), doc.indexOf("} else if (currentRoute.name === 'pecas')"));

    /* `populateDropdowns()` só era chamado no login, no initApp e no clique do pódio
       (`openManagerAnalyst`) — nunca ao navegar. Enquanto a ficha só era alcançável
       pelo pódio isso passava despercebido, porque aquele caminho preenchia de
       passagem; chegando pelo menu, a tela abria com o seletor em branco. */
    assert.match(admin, /if \(analistaNaGestao\) populateDropdowns\(\);/);
    assert.ok(admin.indexOf('populateDropdowns()') < admin.indexOf('syncManagerSectionViews()'),
        'a barra precisa estar preenchida antes de a seção decidir o que exibir');

    // Sem escolha não há ficha para desenhar: quem fala é o estado vazio.
    assert.match(admin, /if \(analistaNaGestao && managerSelectedAnalystId\(\)\) \{/);
    assert.match(admin, /renderAnalystDashboard\(usersList\[currentActiveUser\] \|\| user, usersList, metrics\);/);
});

test('preencher a barra dentro do render não reentra no render', () => {
    const doc = html();
    /* populateDropdowns() passou a rodar DENTRO do render. Se algum passo dele
       chamasse render() de volta, seria laço infinito. `switchRankingTab` chama —
       `syncRankingViewControls`, que é quem populateDropdowns usa, não. */
    const sync = doc.slice(doc.indexOf('function syncRankingViewControls(team)'), doc.indexOf('function switchRankingTab(team)'));
    assert.doesNotMatch(sync, /\brender\(\);/, 'syncRankingViewControls voltou a chamar render');

    const popula = doc.slice(doc.indexOf('function populateDropdowns()'), doc.indexOf('function populateCatracaAnalystOptions'));
    assert.doesNotMatch(popula, /\brender\(\);/, 'populateDropdowns voltou a chamar render');
});

test('os itens que ramificam na sidebar têm a mesma letra dos demais', () => {
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    /* Prioridades e Métricas operacionais ramificam, então são <button>; as folhas são
       <a>. E `body.actuar-app button { font: inherit }` vale 0,1,2 — vence o
       `.actuar-nav-item` (0,1,0) e, por ser atalho, devolve font-size e font-weight ao
       herdado. Os dois saíam em 16px/400 no meio de vizinhos de 12px/600. */
    assert.match(css, /\.actuar-nav-body \.actuar-nav-item \{ font-size: 12px; font-weight: 600; \}/);

    // A regra global continua de pé: consertá-la na origem mexe em 112 dos 156 botões.
    assert.match(css, /body\.actuar-app button,\n(?:body\.actuar-app \w+,\n)*body\.actuar-app textarea \{ font: inherit; \}/);

    // E a que corrige precisa vir DEPOIS da que atrapalha, além de ser mais específica.
    assert.ok(css.indexOf('body.actuar-app button,') < css.indexOf('.actuar-nav-body .actuar-nav-item'));
});

test('o Feedback de Monitoramento não usa cor literal do tema claro', () => {
    const doc = html();
    const bloco = doc.slice(doc.indexOf('function renderMonitoringFeedback'), doc.indexOf('function renderLeaderboard'));

    /* Vinha com `bg-bg/60`: `bg` é literal CLARO do tailwind.config e a variante com
       opacidade escapa ao remapeamento `.bg-bg → var(--actuar-canvas)`, que só cobre a
       classe sem barra. No escuro virava placa clara comendo o contraste. */
    // Só os atributos class: os comentários do código citam as utilidades que saíram.
    const classes = (bloco.match(/class="[^"]*"/g) || []).join(' ');
    assert.doesNotMatch(classes, /bg-bg\//, 'utilidade de cor do tema claro voltou ao cartão');
    assert.doesNotMatch(classes, /text-emerald-|text-amber-|text-red-|border-emerald-|border-red-/,
        'cor de estado voltou a sair de utilidade do Tailwind em vez de token');
    assert.match(bloco, /class="monitoring-feedback-item"/);
    assert.match(bloco, /monitoring-feedback-chip \$\{d\.earned > 0 \? 'is-earned' : 'is-missed'\}/);

    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    // Fundo e borda por token: viram com o tema sem precisar de par html.dark.
    assert.match(css, /\.monitoring-feedback-item \{[^}]*background: var\(--actuar-surface-muted\)/);
    assert.match(css, /\.monitoring-feedback-item \{[^}]*border: 1px solid var\(--actuar-border\)/);
    assert.match(css, /\.monitoring-feedback-note \{[^}]*color: var\(--actuar-text-secondary\)/);
});

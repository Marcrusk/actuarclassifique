const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nav = require('../js/actuar-navigation.js');

const rotulos = (arvore) => arvore.flatMap(grupo => grupo.items.map(item => item.label));
const grupo = (arvore, id) => arvore.find(item => item.id === id);
const item = (arvore, id) => arvore.flatMap(g => g.items).find(i => i.id === id);

test('a árvore da gestão traz os módulos reais, agrupados, com dois níveis no máximo', () => {
    const arvore = nav.build({ mode: 'manager' });

    assert.deepEqual(arvore.map(g => g.title), ['Operação', 'Desempenho', 'Gestão']);
    assert.deepEqual(rotulos(arvore), [
        'Prioridades', 'Peças', 'Ponto e pausas',
        'Ranking geral', 'Métricas operacionais', 'Ciclos e Fechamento',
        'Pessoas e Acessos', 'Histórico e auditoria'
    ]);

    // Só ramifica onde existe mais de uma rota de verdade.
    assert.deepEqual(item(arvore, 'prioridades').children.map(c => c.label), ['Visão geral', 'Aprovações', 'Lançamentos', 'Ranking do rodízio']);
    assert.deepEqual(item(arvore, 'metricas').children.map(c => c.label), ['Lançamentos', 'Transferências']);
    assert.equal(item(arvore, 'pecas').children, undefined, 'Peças usa abas internas de estado, não rotas: não deve ramificar');
    assert.equal(item(arvore, 'ciclos').children, undefined);

    // Nenhum terceiro nível.
    for (const modulo of arvore.flatMap(g => g.items)) {
        for (const filho of modulo.children || []) {
            assert.equal(filho.children, undefined, `${filho.label} criou um terceiro nível`);
        }
    }

    // Toda rota aponta para uma seção de gestão existente.
    const secoes = ['visao', 'prioridades', 'priorityLaunches', 'ranking', 'rankingGeral', 'pecas', 'ponto', 'lancamentos', 'transferencias', 'ciclos', 'cadastros', 'historico'];
    for (const modulo of arvore.flatMap(g => g.items)) {
        for (const alvo of [modulo, ...(modulo.children || [])]) {
            assert.equal(alvo.route.name, 'admin');
            assert.ok(secoes.includes(alvo.route.section), `seção inexistente no menu: ${alvo.route.section}`);
        }
    }
});

test('o menu não aponta para seção que não existe mais, e pai com um filho só vira acesso direto', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const arvore = nav.build({ mode: 'manager' });

    /* "Excluídos" tinha painel próprio e saiu: o que a gestão exclui virou uma linha
       do tipo "Excluído" dentro do Histórico. Um item de menu apontando para a seção
       morta levaria a gestão para a Visão geral sem explicação. */
    assert.ok(!JSON.stringify(arvore).includes('excluidos'), 'o menu voltou a oferecer uma seção removida');
    assert.ok(!html.includes("id=\"admPanelExcluidos\""), 'painel de Excluídos ressuscitou sem o item de menu');
    assert.equal(item(arvore, 'historico').children, undefined);

    // A regra de colapso continua valendo para qualquer grupo podado por permissão.
    const podado = nav.build({ mode: 'operations', publicTabs: { envio: true } });
    assert.deepEqual(rotulos(podado), ['Operação de peças', 'Envio', 'Ranking geral', 'Métricas e regras']);
});

test('analista e acesso operacional recebem árvores próprias, pela mesma configuração', () => {
    const software = nav.build({ mode: 'analyst', publicTabs: { tasks: true } });
    const catraca = nav.build({ mode: 'analyst', publicTabs: { envio: true, coleta: true } });
    const lab = nav.build({ mode: 'operations', publicTabs: { envio: true, coleta: true } });

    // A mesma regra das abas por equipe: Catraca movimenta peça, Software é Tasks.
    assert.ok(rotulos(software).includes('Tasks'));
    assert.ok(!rotulos(software).includes('Envio') && !rotulos(software).includes('Coleta'));
    assert.ok(rotulos(catraca).includes('Envio') && rotulos(catraca).includes('Coleta'));
    assert.ok(!rotulos(catraca).includes('Tasks'));

    // Nenhum analista enxerga módulo de gestão.
    for (const arvore of [software, catraca, lab]) {
        for (const modulo of arvore.flatMap(g => g.items)) {
            assert.notEqual(modulo.route.name, 'admin', `${modulo.label} expõe rota de gestão`);
        }
    }
    assert.deepEqual(rotulos(lab), ['Operação de peças', 'Envio', 'Coleta', 'Ranking geral', 'Métricas e regras']);

    // Grupo sem nenhum item permitido não sobra vazio na tela.
    const semAbas = nav.build({ mode: 'operations', publicTabs: {} });
    assert.deepEqual(rotulos(semAbas), ['Operação de peças', 'Ranking geral', 'Métricas e regras']);
    assert.ok(semAbas.every(g => g.items.length > 0));
});

test('o item ativo vem da rota, inclusive nas telas que não são item de menu', () => {
    const arvore = nav.build({ mode: 'manager' });

    assert.deepEqual(nav.activeFor(arvore, { name: 'admin', section: 'prioridades' }),
        { groupId: 'operacao', itemId: 'prioridades', childId: 'prioridades-aprovacoes' });
    assert.deepEqual(nav.activeFor(arvore, { name: 'admin', section: 'ponto' }),
        { groupId: 'operacao', itemId: 'ponto', childId: null });

    // A consulta de um analista é alcançada pelo Ranking geral: o módulo continua marcado.
    assert.equal(nav.activeFor(arvore, { name: 'admin', section: 'analista' }).itemId, 'rankingGeral');
    // Rota desconhecida não marca ninguém — melhor nada do que marcar errado.
    assert.deepEqual(nav.activeFor(arvore, { name: 'admin', section: 'inexistente' }), { groupId: null, itemId: null, childId: null });

    // Nunca dois ativos ao mesmo tempo.
    const ativo = nav.activeFor(arvore, { name: 'admin', section: 'priorityLaunches' });
    const marcados = arvore.flatMap(g => g.items).filter(i => i.id === ativo.itemId);
    assert.equal(marcados.length, 1);
});

test('o grupo aberto acompanha a rota, e a expansão manual não sobrevive à troca de módulo', () => {
    const arvore = nav.build({ mode: 'manager' });

    // Estando dentro do módulo, o grupo dele abre sozinho.
    assert.equal(nav.expandedFor(arvore, { name: 'admin', section: 'prioridades' }, null), 'prioridades');
    assert.equal(nav.expandedFor(arvore, { name: 'admin', section: 'transferencias' }, null), 'metricas');
    // Fora de qualquer grupo, nada fica aberto por inércia.
    assert.equal(nav.expandedFor(arvore, { name: 'admin', section: 'ciclos' }, null), null);
    // O usuário pode abrir um grupo só para espiar.
    assert.equal(nav.expandedFor(arvore, { name: 'admin', section: 'ciclos' }, 'metricas'), 'metricas');
    /* E o clique tem a palavra final enquanto a pessoa não navega.
       Esta asserção era o contrário — a rota vencia o clique — e travava o menu: estando em
       Prioridades, clicar em "Métricas operacionais" não abria nada, porque o grupo da rota
       reassumia. Quem garante que a expansão "só para espiar" não fica guardada é o navGoTo,
       que zera o manual ao trocar de tela. */
    assert.equal(nav.expandedFor(arvore, { name: 'admin', section: 'prioridades' }, 'metricas'), 'metricas');
    // Item sem filhos não "abre".
    assert.equal(nav.expandedFor(arvore, { name: 'admin', section: 'ciclos' }, 'ciclos'), null);

    // Fechamento explícito: sem o '', fechar o grupo da rota atual seria desfeito na hora.
    assert.equal(nav.expandedFor(arvore, { name: 'admin', section: 'prioridades' }, ''), null);
    assert.equal(nav.expandedFor(arvore, { name: 'admin', section: 'transferencias' }, ''), null);
    // Grupo inexistente no perfil não abre nada.
    assert.equal(nav.expandedFor(arvore, { name: 'admin', section: 'ciclos' }, 'inexistente'), null);
});

test('clicar em outro módulo abre esse módulo, e clicar no aberto fecha', () => {
    // Regressão de menu travado: o toggle compara com o que está aberto de fato — o grupo da
    // rota abre sozinho, sem passar pelo clique — e não com o último clique registrado.
    const html = fs.readFileSync('index.html', 'utf8');
    const toggle = html.slice(html.indexOf('function toggleNavGroup('), html.indexOf('function navGoTo('));
    assert.match(toggle, /ActuarNavigation\.expandedFor\(currentNavTree\(\), currentRoute, globalNavManualGroup\)/);
    assert.match(toggle, /globalNavManualGroup = abertoAgora === id \? '' : id;/);
    assert.doesNotMatch(toggle, /globalNavManualGroup === id \? null : id/, 'comparar com o último clique ignora o grupo aberto pela rota');

    // Navegar limpa a escolha manual, para o menu voltar a seguir a rota.
    const navegar = html.slice(html.indexOf('function navGoTo('), html.indexOf('function navGoTo(') + 600);
    assert.match(navegar, /globalNavManualGroup = null;/);
});

test('a trilha do cabeçalho é módulo e página, na ordem da árvore', () => {
    const arvore = nav.build({ mode: 'manager' });
    assert.deepEqual(nav.breadcrumb(arvore, { name: 'admin', section: 'prioridades' }), ['Prioridades', 'Aprovações']);
    assert.deepEqual(nav.breadcrumb(arvore, { name: 'admin', section: 'cadastros' }), ['Pessoas e Acessos']);
    assert.deepEqual(nav.breadcrumb(arvore, { name: 'admin', section: 'transferencias' }), ['Métricas operacionais', 'Transferências']);
    assert.deepEqual(nav.breadcrumb(arvore, { name: 'admin', section: 'inexistente' }), []);
});

test('a sidebar é a única navegação de módulos: as barras horizontais saíram', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // As três barras que existiam antes.
    assert.ok(!html.includes('class="manager-navigation"'), 'a barra horizontal da gestão voltou');
    assert.ok(!html.includes('id="publicTabsContainer"'), 'a barra horizontal do analista voltou');
    assert.ok(!html.includes('class="priority-module-tabs"'), 'as abas internas de Prioridades voltaram (viraram filhos na sidebar)');
    // E nenhuma referência órfã a elas.
    for (const orfao of ['btnTabDashboard', 'admNavRankingGeral', 'admTabBtnCadastros']) {
        assert.ok(!html.includes(`id="${orfao}"`), `elemento removido ainda declarado: ${orfao}`);
    }

    // A casca do menu e o acionador.
    assert.match(html, /<aside id="globalNav" class="actuar-nav" aria-label="Navegação principal" aria-hidden="true">/);
    assert.match(html, /<div id="globalNavOverlay" class="actuar-nav-overlay hidden" onclick="closeGlobalNav\(\)"/);
    assert.match(html, /id="navToggle"[\s\S]{0,220}aria-expanded="false" aria-controls="globalNav"/);

    // Uma configuração só, carregada antes de quem depende dela.
    assert.ok(html.indexOf('js/actuar-navigation.js') < html.indexOf('js/actuar-fields.js'), 'o módulo de navegação precisa carregar antes');
    assert.match(html, /ActuarNavigation\.build\(navContext\(\)\)/);
    assert.equal((html.match(/function renderGlobalNav\(\)/g) || []).length, 1, 'o menu não pode ser desenhado em dois lugares');

    // Acessibilidade: modal com Esc, foco de volta e trap de Tab.
    assert.match(html, /if \(event\.key === 'Escape'\) \{ event\.preventDefault\(\); closeGlobalNav\(\); return; \}/);
    assert.match(html, /globalNavReturnFocus = document\.activeElement;/);
    assert.match(html, /if \(globalNavReturnFocus && document\.contains\(globalNavReturnFocus\)\) globalNavReturnFocus\.focus\(\);/);
    assert.match(html, /aria-expanded="\$\{expandido\}" aria-controls="navGroup_\$\{item\.id\}"/);
    assert.match(html, /aria-current="page"/);

    // O menu não inventa contagem: reaproveita os IDs que as telas preenchem.
    const config = fs.readFileSync('js/actuar-navigation.js', 'utf8');
    for (const id of ['admPriorityPendingBadge', 'admPiecesPendingBadge', 'admBreakLiveBadge', 'admTransferPendingBadge']) {
        assert.ok(config.includes(`badgeId: '${id}'`), `contador perdido: ${id}`);
    }
    assert.match(html, /function snapshotNavBadges\(\)/);
    assert.match(html, /restoreNavBadges\(contadores\);/);

    // Estado ativo não depende só de cor, e o menu respeita quem pediu menos movimento.
    assert.match(css, /\.actuar-nav-item\.is-active \{[\s\S]*?border-left-color: var\(--actuar-primary\);/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.actuar-nav \{ transition: none; \}/);
    // Área de toque no mobile.
    assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.actuar-nav-item \{ min-height: 44px; \}/);
    // O contador é filho direto e não pode herdar o flex do rótulo.
    assert.match(css, /\.actuar-nav-item > span:not\(\.actuar-nav-badge\) \{ flex: 1;/);
});

test('cada seção da gestão tem título próprio no cabeçalho', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    // Sem isso, "Modo Gestão" aparecia no topo de todas as telas e a trilha não dizia nada.
    for (const [secao, titulo] of [['cadastros', 'Pessoas e Acessos'], ['lancamentos', 'Métricas operacionais'],
        ['ponto', 'Ponto e pausas'], ['ciclos', 'Ciclos e Fechamento'], ['historico', 'Histórico e auditoria']]) {
        assert.ok(html.includes(`${secao}: { title: '${titulo}'`), `seção sem título próprio: ${secao}`);
    }
});

test('sem sessão não existe menu de módulos, nem botão para abri-lo', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    /* Desenhar a árvore do analista para quem ainda não entrou mostraria opções que a
       pessoa não tem — e o §15 do próprio pedido pede para não exibir itens antes de
       as permissões estarem resolvidas. */
    const inicio = html.indexOf('function renderGlobalNav()');
    assert.ok(inicio > 0, 'renderGlobalNav não encontrado');
    const corpo = html.slice(inicio, inicio + 1200);
    assert.match(corpo, /if \(!hasAnySession\(\)\) \{[\s\S]*?corpo\.innerHTML = '';[\s\S]*?gatilho\?\.classList\.add\('hidden'\);[\s\S]*?closeGlobalNav\(\);[\s\S]*?return;/);
    // A guarda vem ANTES de montar a árvore: nada é desenhado e depois retirado.
    assert.ok(corpo.indexOf('hasAnySession()') < corpo.indexOf('snapshotNavBadges()'), 'a árvore está sendo montada antes da checagem de sessão');
});

test('endereço não abre seção nem área que não existe para quem digitou', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    // Seção de gestão fora da lista real cai na Visão geral — e o endereço acompanha,
    // em vez de anunciar uma seção que sumiu.
    assert.match(html, /const ADMIN_SECTIONS = \['visao', 'prioridades', 'priorityLaunches', 'ranking', 'rankingGeral', 'analista', 'pecas', 'ponto', 'lancamentos', 'transferencias', 'ciclos', 'cadastros', 'historico'\];/);
    assert.match(html, /if \(name === 'admin' && section && !ADMIN_SECTIONS\.includes\(section\)\) return \{ name, section: 'visao' \};/);
    assert.ok(!html.includes("'excluidos'"), 'seção removida voltou a ser rota válida');

    /* As 11 rotas da plataforma nova respondiam para qualquer perfil, inclusive sem
       sessão: o cabeçalho dizia "Central de aprovações" e por baixo aparecia o
       dashboard do analista. Sem tela, a rota não existe. */
    assert.match(html, /const PLATFORM_ONLY_ROUTES = \['overview', 'newRequest', 'requests', 'ledger', 'approvals', 'team', 'usersTeams', 'rules', 'cycles', 'audit', 'notifications'\];/);
    assert.match(html, /if \(PLATFORM_ONLY_ROUTES\.includes\(name\) && !window\.PerformancePlatform\?\.isSecureRoute\(name\)\) name = 'dashboard';/);
    // `profile` tem tela nos dois mundos e não pode entrar nessa lista.
    assert.ok(!/PLATFORM_ONLY_ROUTES = \[[^\]]*'profile'/.test(html), "profile não pode ser barrada: ela existe fora da plataforma");

    // A gestão continua barrada para quem não entrou por lá.
    assert.match(html, /if \(next\.name === 'admin' && !isAdminLoggedIn\) \{\s*currentRoute = \{ name: 'dashboard' \};/);
});

test('o menu abre e fecha pela mesma seta, que gira em vez de trocar de ícone', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // Um ícone só nos dois botões: hambúrguer para abrir e X para fechar eram
    // dois símbolos para a mesma ideia, e nenhum dizia para que lado o painel vai.
    assert.ok(!html.includes('fi-rr-hamburger'), 'o hambúrguer voltou ao gatilho do menu');
    assert.ok(!/actuar-nav-close[\s\S]{0,160}fi-rr-cross-small/.test(html), 'o X voltou ao botão de fechar');
    assert.equal((html.match(/fi fi-rr-angle-right actuar-nav-arrow/g) || []).length, 2, 'gatilho e fechar precisam usar a mesma seta');

    // Fechada aponta para a direita; aberta, gira para a esquerda.
    assert.match(css, /\.actuar-nav-arrow \{[\s\S]*?transition: transform 220ms/);
    assert.match(css, /\.actuar-nav-toggle\[aria-expanded="true"\] \.actuar-nav-arrow,\s*\.actuar-nav-close \.actuar-nav-arrow \{ transform: rotate\(180deg\); \}/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.actuar-nav-arrow \{ transition: none; \}/);

    // O rótulo acompanha o estado — a direção da seta não pode ser a única pista.
    assert.match(html, /aria-label="Abrir menu" title="Abrir menu"/);
    assert.match(html, /gatilho\?\.setAttribute\('aria-label', 'Fechar menu'\)/);
    assert.match(html, /gatilho\?\.setAttribute\('aria-label', 'Abrir menu'\)/);
});

test('Prioridades abre direto no histórico pelo endereço, e a tela perdeu o desperdício', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    const nav = require('../js/actuar-navigation.js');

    // A parte da tela vira endereço: menu, recarga, voltar e link salvo caem no mesmo ponto.
    const arvore = nav.build({ mode: 'analyst', publicTabs: {} });
    const prioridades = arvore.flatMap(g => g.items).find(item => item.id === 'priorities');
    assert.ok(prioridades?.children, 'Prioridades deveria ramificar');
    assert.deepEqual(prioridades.children.map(c => c.label), ['Visão geral', 'Histórico']);
    assert.deepEqual(prioridades.children[1].route, { name: 'priorities', section: 'historico' });
    assert.deepEqual(nav.breadcrumb(arvore, { name: 'priorities', section: 'historico' }), ['Prioridades', 'Histórico']);
    assert.equal(nav.activeFor(arvore, { name: 'priorities', section: 'historico' }).childId, 'priorities-historico');

    assert.match(html, /const PRIORITY_SECTION_ANCHORS = \{ historico: 'priorityInlineHistorySection', visao: 'priorityRotationCard' \};/);
    assert.match(html, /if \(currentRoute\.name === 'priorities'\) focusPrioritySection\(currentRoute\.section\);/);
    // Subir ao topo no fim do applyRoute desfaria a ida à âncora.
    assert.match(html, /const rotaAncorada = currentRoute\.name === 'priorities' && currentRoute\.section;/);
    assert.match(html, /if \(!options\.preserveScroll && !rotaAncorada\) window\.scrollTo/);

    // O cabeçalho do módulo repetia, palavra por palavra, o título e a descrição da
    // página logo acima. Ficou só a navegação.
    const moduloInicio = html.indexOf('<section class="analyst-priority-module-header">');
    const modulo = html.slice(moduloInicio, html.indexOf('</section>', moduloInicio));
    assert.ok(!modulo.includes('<h2>'), 'o título repetido voltou ao cabeçalho do módulo');
    assert.ok(!modulo.includes('Acompanhe o rodízio, registre atendimentos'), 'a descrição repetida voltou');
    assert.equal((html.match(/Acompanhe o rodízio, registre atendimentos e consulte seus lançamentos\./g) || []).length, 1);

    /* O card de registrar virou faixa de largura cheia: em meia tela as quatro
       colunas do formulário se espremiam e sobrava coluna vazia embaixo. Como a
       visibilidade de #viewAgent é por exceção, ele precisa constar na lista —
       fora dela, o card simplesmente some da tela. */
    assert.match(css, /\.priority-workspace \{ display: grid; grid-template-columns: 1fr;[^}]*align-items: start; \}/);
    assert.match(css, /#viewAgent\.priorities-mode > :not\(\.analyst-priority-module-header\):not\(\.priority-registration-card\)/);
    assert.match(css, /#viewAgent\.dashboard-mode > [^{]*\.priority-registration-card/);

    // Uma justificativa de relatório inteiro esticava a linha da tabela.
    assert.match(css, /#myPriorityRequestsTable td:nth-child\(2\) \{[\s\S]*?-webkit-line-clamp: 2;/);
});

test('cabeçalho igual em todo perfil: marca à esquerda, perfil à direita, menu numa faixa própria', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    const inicio = html.indexOf('<header id="globalHeader"');
    const header = html.slice(inicio, html.indexOf('</header>', inicio));

    /* A grade tem três colunas. Com o gatilho do menu dentro, havia um quarto item:
       as ações caíam para uma segunda linha e o avatar aparecia à esquerda — foi
       exatamente o que apareceu no acesso do analista. */
    assert.ok(!header.includes('id="navToggle"'), 'o gatilho do menu voltou para dentro do cabeçalho');
    assert.match(css, /\.actuar-global-header \{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\) auto;/);
    assert.match(css, /\.actuar-header-actions \{ justify-self: end; \}/);

    // Ordem fixa: marca, trilha, ações — e o perfil é o último item das ações.
    assert.ok(header.indexOf('actuar-brand') < header.indexOf('id="headerContext"'), 'a marca precisa vir antes da trilha');
    assert.ok(header.indexOf('id="headerContext"') < header.indexOf('actuar-header-actions'), 'as ações vêm por último');
    assert.ok(header.includes('id="profileMenuButton"'), 'o menu do perfil saiu do cabeçalho');

    // "Nuvem conectada" saiu de todos os escopos.
    assert.ok(!html.includes('Nuvem conectada'), 'o selo de nuvem voltou');
    assert.ok(!html.includes('actuar-cloud-status'), 'sobrou marcação do selo de nuvem');
    assert.ok(!css.includes('.actuar-cloud-status'), 'sobrou estilo do selo de nuvem');

    // O gatilho vive numa faixa própria, colada à esquerda, abaixo do cabeçalho.
    assert.match(html, /<div class="actuar-nav-rail">\s*<button id="navToggle"/);
    assert.match(css, /\.actuar-nav-rail \{[\s\S]*?position: sticky;[\s\S]*?top: var\(--actuar-header-h\);/);

    /* E o painel abre ABAIXO do cabeçalho: cobrir a marca tirava a referência de
       onde a pessoa está justo na hora de trocar de lugar. */
    assert.match(css, /\.actuar-nav \{[\s\S]*?top: var\(--actuar-header-h, 56px\);/);
    assert.match(css, /\.actuar-nav-overlay \{[\s\S]*?inset: var\(--actuar-header-h, 56px\) 0 0 0;/);
    assert.match(css, /:root \{ --actuar-header-h: 56px; \}/);
});

test('menu do perfil abre por cima de tudo, e a barra de filtros só aparece onde filtra', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    /* O menu desce do canto superior direito e atravessa a faixa do gatilho. Com a
       faixa em z-index 71 (acima do cabeçalho, 70), ela cobria o topo do menu — o
       nome e o e-mail apareciam cortados. */
    assert.match(css, /\.actuar-profile-menu \{[\s\S]*?z-index: 95;/);
    assert.match(css, /\.actuar-nav-rail \{[\s\S]*?z-index: 60;/);
    const rail = css.slice(css.indexOf('.actuar-nav-rail {'));
    assert.ok(Number(rail.match(/z-index: (\d+);/)[1]) < 70, 'a faixa do menu precisa ficar abaixo do cabeçalho');

    /* Regra da barra do topo: ela existe onde é o ÚNICO recorte da tela. Onde a
       página já tem Departamento, Período, analista ou busca, dois controles para a
       mesma coisa fazem o usuário mexer num e não entender por que o número não muda. */
    const escopo = html.slice(html.indexOf('const TOOLBAR_SCOPE = {'), html.indexOf('const TOOLBAR_ROUTES = {'));
    for (const secao of ['visao', 'prioridades', 'priorityLaunches', 'ranking']) {
        assert.match(escopo, new RegExp(`${secao}:\\s*\\{ periodo: false, contexto: false \\}`), `${secao} tem seletores próprios; a barra do topo duplica`);
    }
    for (const secao of ['rankingGeral', 'analista']) {
        assert.match(escopo, new RegExp(`${secao}:\\s*\\{ periodo: true,  contexto: true  \\}`), `${secao} depende da barra do topo`);
    }
    // Transferências não tem filtro nenhum na página: sem a barra, fica sem saída.
    assert.match(escopo, /transferencias:\s*\{ periodo: true,  contexto: true  \}/);
    assert.match(escopo, /historico:\s*\{ periodo: false, contexto: false \}/);

    const rotas = html.slice(html.indexOf('const TOOLBAR_ROUTES = {'), html.indexOf('function toolbarScope()'));
    assert.match(rotas, /dashboard:\s*\{ periodo: true,  contexto: false \}/);
    assert.match(rotas, /priorities: \{ periodo: false, contexto: false \}/);
    for (const rota of ['envio', 'coleta', 'tasks']) {
        assert.match(rotas, new RegExp(`${rota}:\\s*\\{ periodo: false, contexto: false \\}`), `${rota} não tem o que filtrar por período`);
    }
});

/* Um painel que quebra ao montar não pode prender a navegação. O erro subia pelo
   navigateTo, o closeGlobalNav() da linha seguinte nunca rodava, e o resultado era o pior
   dos mundos: a tela não trocava, o menu ficava aberto e nada avisava. */

test('escolher uma seção sempre fecha o menu, dando certo ou não', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const inicio = html.indexOf('function navGoTo(name, section)');
    assert.ok(inicio > -1, 'navGoTo precisa continuar no shell');
    const navegar = html.slice(inicio, html.indexOf('\n        }', html.indexOf('finally', inicio)));
    assert.match(navegar, /try \{[\s\S]*navigateTo\(/, 'a navegação precisa ser isolada');
    assert.match(navegar, /\} finally \{[\s\S]*closeGlobalNav\(\);/, 'o menu fecha no finally, não depois da chamada');
    assert.match(navegar, /console\.error\('Falha ao abrir a seção:'/);
    assert.match(navegar, /showToast\(/, 'falha silenciosa vira clique morto sem explicação');
});

test('um painel da gestão com defeito não derruba os outros nem a troca de seção', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const helper = html.slice(html.indexOf('function renderManagerPanel(nome, montar)'), html.indexOf('function managerEmpty('));
    assert.match(helper, /try \{ montar\(\); \}/);
    assert.match(helper, /catch \(erro\)/);
    assert.match(helper, /console\.error/);

    // Todos os painéis passam pelo isolamento, nenhum sobrou solto.
    const abre = html.lastIndexOf("if (currentRoute.name === 'admin' && isAdminLoggedIn) {");
    assert.ok(abre > -1, 'o ramo da gestão precisa continuar no render');
    const admin = html.slice(abre, html.indexOf('updatePiecesPendingBadge', abre));
    for (const painel of ['renderAdminLogs', 'renderUsersManagementTable', 'renderAdminPriorityRequests', 'renderAdminTransferRequests', 'renderManagerExperience']) {
        assert.ok(admin.includes(`, ${painel});`), `${painel} continua podendo abortar o render`);
        assert.ok(!new RegExp('\\n\\s+' + painel + '\\(\\);').test(admin), `${painel} ainda é chamado direto`);
    }
});

test('a troca de rota não é refém do desenho da tela', () => {
    /* Enquanto render() podia abortar applyRoute, uma tela quebrada impedia a navegação:
       a seção não trocava, o menu não fechava e nada explicava o porquê. */
    const html = fs.readFileSync('index.html', 'utf8');
    const inicio = html.indexOf('function applyRoute(route, options = {})');
    assert.ok(inicio > -1, 'applyRoute precisa continuar no shell');
    const aplica = html.slice(inicio, html.indexOf('\n        }', html.indexOf('window.scrollTo', inicio)));

    assert.match(aplica, /try \{\s*\n\s*render\(\);\s*\n\s*\} catch/, 'render precisa ser isolado');
    assert.match(aplica, /console\.error\('Falha ao desenhar a tela:'/);

    // E o que decide a seção roda DEPOIS, então continua rodando mesmo com o desenho falho.
    const posRender = aplica.indexOf('} catch');
    const posSecao = aplica.indexOf('switchAdminTabView(currentRoute.section)');
    assert.ok(posSecao > posRender, 'a troca de seção precisa vir depois do render isolado');
});

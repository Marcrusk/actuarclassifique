const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const E = require('../js/external-requests.js');

/* ==========================================================================
   QUEM ACOMPANHA A PRÓPRIA ÁREA NO PORTAL
   A área abria chamado com PIN e nunca mais via o que aconteceu com ele. Havia
   até uma etapa "Aguardando informação — devolvidas a quem registrou", que
   dependia de alguém avisar por fora: sem tela, a solicitação ficava parada.
   ========================================================================== */

const html = fs.readFileSync('index.html', 'utf8');
const req = (extra = {}) => ({ id: 'r1', protocol: 'PP-1', requesterDepartment: 'Comercial', status: 'nova', ...extra });

test('a área que ela acompanha É o departamento dela, num campo só', () => {
    const manager = require('../js/manager-experience.js');
    /* Decisão do usuário: função genérica. O portal tem cinco áreas, e uma função por área
       significaria cinco funções e uma alteração de código a cada nova. */
    assert.ok(manager.NON_RANKED_ROLES.includes('Gestor de Área'));
    assert.match(html, /<option value="Gestor de Área">Gestor de Área \(acompanha o Portal\)<\/option>/);

    /* Havia dois campos — Departamento e "Área do Portal" — e o Departamento nem oferecia
       Comercial. Dois campos para a mesma coisa podiam discordar: alguém com Departamento
       "Comercial" e Área "Financeiro" veria a fila errada. */
    assert.ok(!html.includes('inputUserPortalArea'), 'o campo duplicado voltou');

    // Toda área do Portal precisa existir no cadastro, senão não há como registrar quem é dela.
    const areas = [...html.matchAll(/\{ id: '[a-z]+', name: '([^']+)', icon:/g)].map(item => item[1]);
    assert.ok(areas.length >= 5, 'não encontrei as áreas do Portal no shell');
    for (const area of areas) {
        assert.ok(manager.DEPARTMENTS.includes(area), `a área "${area}" do Portal não existe no cadastro`);
    }
    // E nenhuma delas entra na disputa do ranking.
    for (const area of areas) assert.ok(!manager.TEAMS.includes(area), `"${area}" não deveria competir no ranking`);

    // Salvar confere: Gestor de Área sem departamento do Portal não passa.
    assert.match(html, /if \(role === 'Gestor de Área' && !isPortalAreaTeam\(team\)\)/);
    assert.match(html, /function isPortalAreaTeam\(team\)/);
});

test('ela vê só o que a própria área registrou, e o recorte não é filtro de tela', () => {
    assert.equal(E.belongsToArea(req(), 'Comercial'), true);
    assert.equal(E.belongsToArea(req(), 'comercial'), true, 'a comparação não pode depender de caixa');
    assert.equal(E.belongsToArea(req({ requesterDepartment: 'Financeiro' }), 'Comercial'), false);
    assert.equal(E.belongsToArea(req({ requesterDepartment: '' }), ''), false, 'área vazia não casa com tudo');

    /* O recorte é aplicado ANTES dos filtros: filtro é conveniência, e conveniência não
       pode ser o que separa uma área da outra. */
    const recorte = html.slice(html.indexOf('function portalAreaRequests()'), html.indexOf('function renderPortalAreaBoard()'));
    assert.match(recorte, /dominio\.list\(getStore\(\)\)\.filter\(item => dominio\.belongsToArea\(item, portalAreaSession\.area\)\)/);
    const quadro = html.slice(html.indexOf('function renderPortalAreaBoard()'), html.indexOf('function portalAreaCard(item)'));
    assert.match(quadro, /const lista = portalAreaRequests\(\)\.filter\(combina\);/);
});

test('entra com senha conferida no banco, e a sessão não vira permissão', () => {
    const login = html.slice(html.indexOf('async function portalAreaLogin(event)'), html.indexOf('function portalAreaLogout()'));
    assert.match(login, /if \(!await verifyLoginRemote\(id, senha\)\)/, 'a senha vive no banco, nunca no frontend');

    /* Sessão guardada é conveniência: a ficha é reconferida a cada abertura, então quem foi
       inativado ou trocou de função não volta com o acesso antigo. */
    const sessao = html.slice(html.indexOf('function readPortalAreaSession()'), html.indexOf('function portalToggleAreaDoor()'));
    assert.match(sessao, /if \(!user \|\| user\.active === false \|\| user\.role !== 'Gestor de Área' \|\| !isPortalAreaTeam\(user\.team\)\) return null;/);
});

test('uma tela só: quem acompanha não vê o formulário de registro', () => {
    const render = html.slice(html.indexOf('function renderPortal() {'), html.indexOf('const identificado = Boolean(portalSession);'));
    assert.match(render, /document\.getElementById\('portalAccess'\)\?\.classList\.add\('hidden'\);/);
    assert.match(render, /document\.getElementById\('portalForm'\)\?\.classList\.add\('hidden'\);/);
    assert.match(render, /renderPortalAreaBoard\(\);\s*\n\s*return;/);
    /* O Portal não monta a aplicação (isPortalRoute corta o render antes), então não há
       sidebar nem cabeçalho interno para esconder — é por isso que ele é o lugar certo. */
    assert.match(html, /if \(isPortalRoute\(\)\) \{[\s\S]{0,400}renderPortal\(\);\s*\n\s*return;/);
});

test('o quadro é o mesmo da gestão, recortado — não um segundo kanban', () => {
    /* Duas telas montando as colunas por conta própria divergiriam na primeira etapa nova.
       As colunas saem de ExternalRequests.board(), como no painel da gestão. */
    const quadro = html.slice(html.indexOf('function renderPortalAreaBoard()'), html.indexOf('function portalAreaCard(item)'));
    assert.match(quadro, /const quadro = dominio\.board\(lista\);/);
    assert.match(quadro, /dominio\.STAGES\.map\(item => `<option value="\$\{escapeHtml\(item\.id\)\}"/);
    // Busca por protocolo, que foi o pedido explícito, e pelos campos vizinhos.
    assert.match(quadro, /\[item\.protocol, item\.clientId, item\.clientName, item\.phone, item\.brand, item\.demand\]/);
});

test('as duas ações da área têm limite no domínio, não no botão', () => {
    assert.equal(E.canAreaRespond(req({ status: 'aguardando_info' })), true);
    assert.equal(E.canAreaRespond(req({ status: 'triagem' })), false);

    /* Cancelar só enquanto ninguém pegou o chamado: depois que o analista está em
       atendimento, desistir por fora deixaria a vez dele no rodízio pendurada num caso que
       sumiu. */
    assert.deepEqual([...E.AREA_CANCELABLE_STAGES], ['nova', 'triagem', 'aguardando_info', 'aguardando_distribuicao']);
    for (const aberto of E.AREA_CANCELABLE_STAGES) assert.equal(E.canAreaCancel(req({ status: aberto })), true, aberto);
    for (const fechado of ['em_atendimento', 'sem_retorno', 'aguardando_aprovacao', 'concluida', 'cancelada']) {
        assert.equal(E.canAreaCancel(req({ status: fechado })), false, fechado);
    }

    // A tela reconfere antes de salvar: sumir botão não é permissão.
    const escrita = html.slice(html.indexOf('async function portalAreaMutate(id, proximo, opcoes)'), html.indexOf('function portalAreaRespond(id)'));
    assert.match(escrita, /const atual = portalAreaRequests\(\)\.find\(item => item\.id === id\);/, 'a escrita revalida o recorte da área');
    assert.match(escrita, /if \(!opcoes\.permitido\(atual\)\) \{ showToast\('Esta solicitação já saiu desta etapa\.'/);
    // Motivo obrigatório e registrado em nome de quem escreveu, como o resto do sistema.
    assert.match(escrita, /reason: texto, reasonRequired: true/);
    assert.match(escrita, /actorName: `\$\{portalAreaSession\.name\} · \$\{portalAreaSession\.area\}`/);
    // Falha de salvamento devolve a lista ao estado anterior.
    assert.match(escrita, /appStore\.externalRequests = anterior;/);
});

test('responder devolve à triagem; cancelar sai do fluxo', () => {
    const responder = html.slice(html.indexOf('function portalAreaRespond(id)'), html.indexOf('function portalAreaCancel(id)'));
    assert.match(responder, /portalAreaMutate\(id, 'triagem'/);
    const cancelar = html.slice(html.indexOf('function portalAreaCancel(id)'), html.indexOf('function refreshPortalAreaBoard()'));
    assert.match(cancelar, /portalAreaMutate\(id, 'cancelada'/);
    assert.match(cancelar, /tone: 'danger'/);

    // E o domínio recusa uma transição para a etapa em que a solicitação já está.
    assert.throws(() => E.transition(req({ status: 'triagem' }), 'triagem', { reason: 'texto' }), /já está nesta etapa/);
});

/* ==========================================================================
   A SEGUNDA PORTA COMO PARTE DO CARD, NÃO COMO REMENDO
   Ela nasceu com <select> nativo, sem recuo lateral e encostando na borda de
   baixo — o card tem `overflow: hidden`, então não sobrava nem a folga da sombra.
   Duas linguagens de controle no mesmo card fazem a segunda parecer colada.
   ========================================================================== */

const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

test('a escolha da pessoa usa o mesmo seletor da área, não um <select> nativo', () => {
    const porta = html.slice(html.indexOf('<div class="actuar-portal-second-door">'), html.indexOf('<!-- QUADRO DA ÁREA'));
    // Sem os comentários: eles citam o controle que saiu, para explicar por que saiu.
    const markup = porta.replace(/<!--[\s\S]*?-->/g, '');

    assert.doesNotMatch(markup, /<select/, 'o controle nativo entrega o visual do sistema operacional, não o do produto');
    assert.match(markup, /class="actuar-picker-trigger"/);
    assert.match(markup, /class="actuar-picker-panel"/);
    // O valor continua num campo escondido, como no seletor de área.
    assert.match(markup, /<input type="hidden" id="portalAreaUser" value="">/);
    // Avatar com iniciais e a área na segunda linha: é ela que distingue dois nomes iguais.
    assert.match(html, /portalAreaInitials\(user\)/);
    assert.match(html, /<small>\$\{escapeHtml\(user\.team\)\}<\/small>/);

    // Teclado igual ao de cima: setas, Enter, Escape, e clicar fora fecha.
    for (const fn of ['portalToggleAreaMembers', 'portalPickAreaMember', 'portalAreaMemberKey', 'portalAreaTriggerKey']) {
        assert.ok(html.includes(`function ${fn}(`), `falta ${fn}`);
    }
    assert.match(html, /if \(portalAreaMembersOpen\(\) && !event\.target\.closest\('\.actuar-picker'\)\) portalToggleAreaMembers\(false\);/);
});

test('o bloco respira dentro do card e acompanha o recuo do formulário do PIN', () => {
    assert.match(css, /\.actuar-portal-second-door \{ padding: 4px 32px 26px;/, 'sem respiro embaixo o link encosta na borda');
    /* O filete atravessa o card inteiro; o conteúdo é que fica recuado. Uma linha que para
       antes da borda lê como erro de alinhamento, não como divisão. */
    assert.match(css, /\.actuar-portal-second-door::before \{ content: ""; display: block; height: 1px; margin: 0 -32px 14px;/);
    /* O formulário já está num bloco recuado: repetir o padding do PIN estreitaria os campos
       em relação ao seletor de área logo acima. */
    assert.match(css, /\.actuar-portal-shell \.actuar-portal-second-door \.actuar-portal-form \{ padding: 0; \}/);
});

test('a senha não anuncia de onde vem, e dá para conferir o que foi digitado', () => {
    const porta = html.slice(html.indexOf('<div class="actuar-portal-second-door">'), html.indexOf('<!-- QUADRO DA ÁREA'));
    assert.ok(!porta.includes('A mesma senha do Classifique'), 'o texto sobre a origem da senha saiu');
    assert.doesNotMatch(porta, /id="portalAreaPassword"[^>]*placeholder=/, 'o campo não precisa de placeholder: o rótulo já diz o que é');

    // Revelar existe porque senha às cegas erra, e errar aqui custa uma tentativa inteira.
    assert.match(porta, /class="actuar-field-with-action"/);
    assert.match(html, /function portalToggleAreaPassword\(\)/);
    assert.match(html, /campo\.type = revelando \? 'text' : 'password';/);
    assert.match(html, /botao\.setAttribute\('aria-label', revelando \? 'Ocultar senha' : 'Mostrar senha'\);/);

    /* O recuo do texto vem da base do Design System, que carrega a cadeia de :not() para
       ganhar dela mesma. Uma regra curta aqui perderia e o olho voltaria por cima da senha. */
    assert.ok(!/\.actuar-portal-second-door \.actuar-field-with-action input\s*\{/.test(css));
});

test('a lista de nomes não flutua: o card recorta o que sai dele', () => {
    /* Mesma lição que o seletor de área já tinha aprendido — `overflow: hidden` existe para
       arredondar o bloco da marca, e um painel absoluto some por baixo dele. */
    assert.ok(!/\.actuar-portal-second-door \.actuar-picker-panel \{[^}]*position: absolute/.test(css));
    // Sem ninguém cadastrado, a lista diz o que falta em vez de abrir vazia.
    assert.match(html, /Nenhum acompanhamento cadastrado\. Peça à gestão um acesso com a função Gestor de Área\./);
    assert.match(css, /\.actuar-picker-empty \{/);
});

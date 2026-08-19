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

test('a área é do cadastro da pessoa, não do código', () => {
    /* Decisão do usuário: função genérica. O portal tem cinco áreas, e uma função por área
       significaria cinco funções e uma alteração de código a cada nova. */
    assert.ok(require('../js/manager-experience.js').NON_RANKED_ROLES.includes('Gestor de Área'));
    assert.match(html, /<option value="Gestor de Área">Gestor de Área \(acompanha o Portal\)<\/option>/);
    assert.match(html, /id="inputUserPortalAreaField"/);
    // As opções saem da mesma lista que o Portal usa para se identificar.
    assert.match(html, /portalDepartments\(\)\.map\(item => `<option value="\$\{escapeHtml\(item\.name\)\}"/);
    // O campo só aparece para quem vai usá-lo, e some ao trocar de função.
    assert.match(html, /areaField\.classList\.toggle\('hidden', !gestorDeArea\);/);
    assert.match(html, /appStore\.users\[editId\]\.portalArea = portalArea \|\| undefined;/);
    assert.match(html, /if \(role === 'Gestor de Área' && !portalArea\) \{ showToast\('Escolha a área do Portal desta pessoa\.'/);
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
    assert.match(sessao, /if \(!user \|\| user\.active === false \|\| user\.role !== 'Gestor de Área' \|\| !user\.portalArea\) return null;/);
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

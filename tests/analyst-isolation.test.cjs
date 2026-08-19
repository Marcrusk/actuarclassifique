const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');

/* FURO GRAVE: um analista clicava na foto de um colega no ranking e virava aquele colega.
   `currentActiveUser` é o analista EM CONTEXTO, e o ponto age sobre ele — então não era
   consulta, era assumir a conta: dashboard, pausa, almoço e banheiro do outro. */

function permissao(estado) {
    const fonte = html.slice(html.indexOf('function canOpenAnalystDetails(id)'), html.indexOf('function switchAgent(val)'));
    const factory = new Function('isAdminLoggedIn', 'isPecaLoggedIn', 'isAnalystLoggedIn', 'currentActiveUser', 'canManagerViewAnalyst',
        `${fonte}; return canOpenAnalystDetails;`);
    return factory(estado.admin || false, estado.peca || false, estado.analista || false, estado.contexto || null, estado.escopo || (() => true));
}

test('o analista só abre a própria ficha', () => {
    const abrir = permissao({ analista: true, contexto: 'dyego' });
    assert.equal(abrir('dyego'), true, 'a própria ficha continua acessível');
    assert.equal(abrir('lucas'), false, 'a ficha do colega, nunca');
    assert.equal(abrir(''), false);
    assert.equal(abrir(null), false);
});

test('a gestão consulta quem administra, e só', () => {
    const noEscopo = permissao({ admin: true, escopo: id => id === 'dyego' });
    assert.equal(noEscopo('dyego'), true);
    assert.equal(noEscopo('lucas'), false, 'fora do escopo autorizado não abre');
});

test('acesso de peças e visitante não consultam ninguém', () => {
    assert.equal(permissao({ peca: true, contexto: 'dyego' })('dyego'), false);
    assert.equal(permissao({})('dyego'), false, 'sem sessão não há consulta');
});

test('as duas portas que trocavam a identidade passam pela mesma régua', () => {
    // Ranking (foto no pódio) e seletor de analista — as duas trocavam currentActiveUser.
    const podium = html.slice(html.indexOf('function viewAnalystFromPodium(id, team)'), html.indexOf('function switchAgent(val)'));
    assert.match(podium, /if \(!canOpenAnalystDetails\(id\)\)/);
    assert.match(podium, /O ranking mostra o resultado de todos\. A ficha individual é só a sua\./);

    const seletor = html.slice(html.indexOf('function switchAgent(val)'), html.indexOf('function switchAgent(val)') + 900);
    assert.match(seletor, /if \(!canOpenAnalystDetails\(val\)\)/);
    assert.match(seletor, /Você só pode abrir a sua própria ficha\./);

    /* A guarda antiga devolvia `true` de imediato com a autenticação nova desligada — que é
       sempre, porque ACTUAR_AUTHENTICATION_ENABLED nunca é definido. Nunca protegeu nada.
       Comentários fora: o que importa é não haver CHAMADA a ela. */
    const semComentario = texto => texto.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    assert.doesNotMatch(semComentario(podium), /canSelectLegacyAnalyst\(/);
    assert.doesNotMatch(semComentario(seletor), /canSelectLegacyAnalyst\(/);
});

test('a lista de analistas não oferece o que não permite', () => {
    // Bloquear no clique e continuar listando os colegas seria convite com porta fechada.
    const lista = html.slice(html.indexOf('function populateAnalystDropdown(team)'), html.indexOf('function populateAnalystDropdown(team)') + 900);
    assert.match(lista, /if \(!canOpenAnalystDetails\(id\)\) return;/);
    assert.doesNotMatch(lista, /if \(isAdminLoggedIn && !canManagerViewAnalyst\(id\)\) return;/,
        'a régua é uma só, não uma por perfil');
});

test('o ponto age sobre quem você é, não sobre quem você olha', () => {
    /* Segunda tranca: mesmo que algum caminho futuro volte a trocar o contexto, pausa,
       almoço e banheiro continuam sendo os seus. */
    for (const funcao of ['startAttendanceBreak', 'endAttendanceBreak']) {
        const corpo = html.slice(html.indexOf(`async function ${funcao}(`), html.indexOf(`async function ${funcao}(`) + 700);
        assert.match(corpo, /const userId = getCurrentProfileUserId\(\);/, `${funcao} precisa usar a identidade da sessão`);
        assert.doesNotMatch(corpo, /const userId = currentActiveUser;/, `${funcao} não pode agir sobre o contexto`);
    }
    // E a identidade da sessão continua vindo só da sessão.
    const identidade = html.slice(html.indexOf('function getCurrentProfileUserId()'), html.indexOf('function getCurrentProfileUser()'));
    assert.match(identidade, /if \(isAnalystLoggedIn && currentActiveUser\) return currentActiveUser;/);
    assert.match(identidade, /return null;/);
});

test('nada é escrito em nome do analista que está sendo olhado', () => {
    /* Segunda tranca, para todos os caminhos de escrita: mesmo que algum fluxo futuro volte
       a trocar o contexto, o registro continua saindo assinado por quem está logado. */
    for (const trecho of ['priorityRotationActorId', 'submitPriorityRequest', 'submitTransferRequest']) {
        const i = html.indexOf(`function ${trecho}(`);
        assert.ok(i > -1, `${trecho} precisa existir`);
    }
    const ator = html.slice(html.indexOf('function priorityRotationActorId()'), html.indexOf('function priorityRotationActorId()') + 220);
    assert.match(ator, /getCurrentProfileUserId\(\)/);
    assert.doesNotMatch(ator, /: currentActiveUser;/);

    // Lançamento e transferência são assinados pela sessão.
    const prioridade = html.slice(html.indexOf('async function submitPriorityRequest('), html.indexOf('async function submitPriorityRequest(') + 1400);
    assert.match(prioridade, /userId: getCurrentProfileUserId\(\)/);
    const transferencia = html.slice(html.indexOf('async function submitTransferRequest('), html.indexOf('async function submitTransferRequest(') + 900);
    assert.match(transferencia, /userId: getCurrentProfileUserId\(\)/);

    /* Só sobra um `userId: currentActiveUser`, e é legítimo: o contexto de VISUALIZAÇÃO
       guardado no localStorage, que diz qual ficha estava aberta — não é reivindicação
       de identidade. */
    assert.equal((html.match(/userId: currentActiveUser/g) || []).length, 1);
    const contexto = html.slice(html.indexOf('function persistViewContext()'), html.indexOf('function persistViewContext()') + 400);
    assert.match(contexto, /userId: currentActiveUser/);
});

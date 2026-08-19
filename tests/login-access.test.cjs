const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');

/* O acesso às abas de operação é decidido por publicTabAccess(). A regra vive no script
   inline do shell: extrai o trecho e executa de verdade, com os globais que ela lê. */
function loadPublicTabAccess({ store, currentActiveUser, isPecaLoggedIn, currentPecaUserId }) {
    const start = html.indexOf('function publicTabAccess()');
    const end = html.indexOf('function syncPublicTabAccess()');
    assert.ok(start > -1 && end > start, 'publicTabAccess precisa continuar no shell do index.html');
    const source = html.slice(start, end);
    const factory = new Function(
        'getStore', 'defaultUsers', 'currentActiveUser', 'isPecaLoggedIn', 'currentPecaUserId', 'LAB_ROLE_NAME',
        `${source}; return publicTabAccess;`
    );
    return factory(() => store, store.users, currentActiveUser, isPecaLoggedIn, currentPecaUserId, 'Toletus Lab');
}

const store = {
    users: {
        alessandro: { name: 'Alessandro', team: 'Sistema', role: 'Analista de sistema', active: true },
        dyego: { name: 'Dyego', team: 'Catraca', role: 'Analista de catraca', active: true },
        antonio_ec: { name: 'Antonio', team: 'Catraca', role: 'Envio/Coleta', active: true },
        lab: { name: 'Lab', team: 'Catraca', role: 'Toletus Lab', active: true },
        faturamento: { name: 'Fatura', team: 'Catraca', role: 'Faturamento', active: true }
    }
};

test('operador de peça mantém Envio e Coleta mesmo com analista de Sistema em contexto', () => {
    // Regressão: loginPeca grava currentPecaUserId e não mexe em currentActiveUser, que segue
    // no padrão 'alessandro' (Sistema). Lendo a equipe dele, quem opera Envio/Coleta perdia
    // exatamente Envio e Coleta — e a rota devolvia a pessoa ao dashboard.
    const acesso = loadPublicTabAccess({
        store, currentActiveUser: 'alessandro', isPecaLoggedIn: true, currentPecaUserId: 'antonio_ec'
    });
    assert.deepEqual(acesso(), { envio: true, coleta: true, tasks: false, pecas: true });
});

test('Toletus Lab continua vendo o que sai e o que volta, sem Tasks', () => {
    const acesso = loadPublicTabAccess({
        store, currentActiveUser: 'alessandro', isPecaLoggedIn: true, currentPecaUserId: 'lab'
    });
    assert.deepEqual(acesso(), { envio: true, coleta: true, tasks: false, pecas: true });
});

test('demais papéis de peça também operam Envio e Coleta', () => {
    const acesso = loadPublicTabAccess({
        store, currentActiveUser: 'alessandro', isPecaLoggedIn: true, currentPecaUserId: 'faturamento'
    });
    assert.deepEqual(acesso(), { envio: true, coleta: true, tasks: false, pecas: true });
});

test('analista segue a própria equipe: Catraca movimenta peça, Software trabalha por tarefa', () => {
    const catraca = loadPublicTabAccess({ store, currentActiveUser: 'dyego', isPecaLoggedIn: false, currentPecaUserId: null });
    assert.deepEqual(catraca(), { envio: true, coleta: true, tasks: false, pecas: true });

    const sistema = loadPublicTabAccess({ store, currentActiveUser: 'alessandro', isPecaLoggedIn: false, currentPecaUserId: null });
    assert.deepEqual(sistema(), { envio: false, coleta: false, tasks: true, pecas: false });
});

test('usuário desconhecido não ganha aba nenhuma', () => {
    const acesso = loadPublicTabAccess({ store, currentActiveUser: 'inexistente', isPecaLoggedIn: false, currentPecaUserId: null });
    assert.deepEqual(acesso(), { envio: false, coleta: false, tasks: false, pecas: false });
});

test('o campo Usuário do login mostra apenas o nome', () => {
    // Equipe e cargo são organização interna: na hora de entrar, poluíam a escolha.
    const analista = html.slice(html.indexOf('function analystDoorOptions()'), html.indexOf('function fillAnalystDoor()'));
    assert.match(analista, /\$\{usersList\[id\]\.name\}<\/option>/);
    assert.doesNotMatch(analista, /·/, 'a equipe não deve mais acompanhar o nome');

    const peca = html.slice(html.indexOf('function fillPecaDoor()'), html.indexOf('function clearLoginError('));
    assert.match(peca, /\$\{usersList\[id\]\.name\}<\/option>/);
    assert.doesNotMatch(peca, /·/, 'o cargo não deve mais acompanhar o nome');

    const gestor = html.slice(html.indexOf('function fillAdminDoor()'), html.indexOf('function fillPecaDoor()'));
    assert.doesNotMatch(gestor, /·/);
});

test('cada papel entra por exatamente uma porta de acesso', () => {
    // As três portas particionam os papéis: sem isso alguém fica sem lugar para entrar.
    const naoRankeados = require('../js/manager-experience.js').NON_RANKED_ROLES;
    const linha = html.match(/const PIECES_OPERATION_ROLES = new Set\(\[([^\]]+)\]\)/);
    assert.ok(linha, 'PIECES_OPERATION_ROLES precisa continuar declarado no shell');
    const papeisDePeca = linha[1].split(',').map(item => item.trim().replace(/^'|'$/g, ''));

    assert.deepEqual([...naoRankeados].sort(), ['Gestor Adm', ...papeisDePeca].sort(),
        'quem sai do login de analista precisa entrar pela porta de gestão ou pela de peças');
});

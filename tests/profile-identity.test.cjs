const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');

/* O cabeçalho anunciava a foto de um analista como se fosse a do gestor logado.
   `currentActiveUser` é o analista EM CONTEXTO — o selecionado no painel, ou o que o gestor
   foi consultar. Como reserva de identidade, ele já vale no boot, antes de restoreSession()
   rodar: o gestor via o rosto de outra pessoa até clicar no menu, que redesenhava com a
   identidade certa. Identidade vem da sessão, e de mais lugar nenhum. */

function identidade(estado) {
    const fonte = html.slice(html.indexOf('function getCurrentProfileUserId()'), html.indexOf('function getCurrentProfileUser()'));
    const factory = new Function('isAdminLoggedIn', 'currentAdminId', 'isPecaLoggedIn', 'currentPecaUserId',
        'isAnalystLoggedIn', 'currentActiveUser', `${fonte}; return getCurrentProfileUserId;`);
    return factory(
        estado.isAdminLoggedIn || false, estado.currentAdminId || null,
        estado.isPecaLoggedIn || false, estado.currentPecaUserId || null,
        estado.isAnalystLoggedIn || false, estado.currentActiveUser || null
    )();
}

test('cada sessão responde por si', () => {
    assert.equal(identidade({ isAdminLoggedIn: true, currentAdminId: 'joao', currentActiveUser: 'dyego' }), 'joao');
    assert.equal(identidade({ isPecaLoggedIn: true, currentPecaUserId: 'antonio_ec', currentActiveUser: 'dyego' }), 'antonio_ec');
    assert.equal(identidade({ isAnalystLoggedIn: true, currentActiveUser: 'dyego' }), 'dyego');
});

test('o analista em contexto nunca vira identidade de quem não é analista logado', () => {
    // O caso relatado: gestão logada, painel apontando para um analista.
    assert.equal(identidade({ isAdminLoggedIn: true, currentAdminId: 'joao', currentActiveUser: 'dyego' }), 'joao');
    // O gestor consultando a ficha de alguém continua sendo ele mesmo.
    assert.equal(identidade({ isAdminLoggedIn: true, currentAdminId: 'joao', currentActiveUser: 'lucas' }), 'joao');
    // Operação de peças com um analista selecionado no painel.
    assert.equal(identidade({ isPecaLoggedIn: true, currentPecaUserId: 'lab', currentActiveUser: 'dyego' }), 'lab');
});

test('sem sessão não há identidade — nem a de um analista qualquer', () => {
    /* É a janela do boot: currentActiveUser já vale antes de restoreSession(). Devolver
       'dyego' aqui é o que pintava o rosto errado no cabeçalho. */
    assert.equal(identidade({ currentActiveUser: 'dyego' }), null);
    assert.equal(identidade({}), null);
    // Sessão marcada sem id, ou id sem sessão, também não valem.
    assert.equal(identidade({ isAdminLoggedIn: true, currentActiveUser: 'dyego' }), null);
    assert.equal(identidade({ currentAdminId: 'joao', currentActiveUser: 'dyego' }), null);
});

test('sem identidade o cabeçalho volta ao ícone neutro', () => {
    const render = html.slice(html.indexOf('function updateProfileUI()'), html.indexOf('function toggleProfileMenu('));
    assert.match(render, /if \(!user\) \{[\s\S]*headerProfileAvatar[\s\S]*fi-rr-user[\s\S]*\}/,
        'sem sessão o avatar precisa ser limpo, não mantido');
    assert.match(render, /'Sem sessão'/);
    assert.doesNotMatch(render.slice(0, render.indexOf('const nomeVazio')), /^\s*if \(!user\) return;/m,
        'sair cedo deixava o rosto de quem saiu pintado na tela');
});

test('cabeçalho e menu são pintados pela mesma fonte, sempre juntos', () => {
    // Se um dia se separarem, volta a ser possível mostrar uma pessoa no ícone e outra no menu.
    const render = html.slice(html.indexOf('function updateProfileUI()'), html.indexOf('function toggleProfileMenu('));
    const grupos = [...render.matchAll(/\['headerProfileAvatar', 'menuProfileAvatar'\]\.forEach/g)];
    assert.equal(grupos.length, 2, 'os dois avatares são escritos no mesmo laço, com e sem sessão');
    assert.equal((html.match(/getElementById\('headerProfileAvatar'\)/g) || []).length, 0,
        'ninguém deve escrever no avatar do cabeçalho por fora de updateProfileUI');
});

test('a sessão restaurada chega ao cabeçalho na hora', () => {
    /* Sem isso, a identidade certa só aparecia depois de uma navegação — e no boot a
       primeira pintura acontece antes de restoreSession(). */
    const inicio = html.indexOf('function restoreSession()');
    assert.ok(inicio > -1, 'restoreSession precisa continuar no shell');
    const restore = html.slice(inicio, html.indexOf('\n        }', inicio));
    const chamadas = (restore.match(/updateProfileUI\(\);/g) || []).length;
    assert.equal(chamadas, 3, 'os três tipos de sessão precisam atualizar o cabeçalho ao restaurar');
    for (const marca of ["return 'manager';", "return 'operations';", "return 'analyst';"]) {
        const antes = restore.slice(0, restore.indexOf(marca));
        assert.match(antes.slice(-120), /updateProfileUI\(\);/, `${marca} não atualiza o cabeçalho`);
    }
});

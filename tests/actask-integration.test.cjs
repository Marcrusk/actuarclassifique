const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const piecesUi = fs.readFileSync('js/pieces-ui.js', 'utf8');

test('shell expõe configuração stage/main sem segredo e carrega o adaptador Actask', () => {
    assert.match(html, /window\.ACTASK_AUTH_CONFIG = window\.ACTASK_AUTH_CONFIG \|\|/);
    assert.match(html, /https:\/\/actaskapistage\.bluefronte\.com/);
    assert.match(html, /actuar-classifique-main-login/);
    assert.match(html, /js\/actask-auth\.js\?v=/);
    assert.doesNotMatch(html, /AUTH_OIDC_SIGNING_SECRET\s*=/);
    assert.doesNotMatch(html, /client_secret\s*:/);
});

test('as três portas de entrada usam e-mail Actask quando o cliente está configurado', () => {
    for (const kind of ['analyst', 'admin', 'peca']) {
        assert.match(html, new RegExp(`id="${kind}Email"`));
        const start = html.indexOf(`async function login${kind[0].toUpperCase()}${kind.slice(1)}(`);
        const body = html.slice(start, start + 500);
        assert.match(body, new RegExp(`if \\(actaskAuthEnabled\\(\\)\\)[\\s\\S]{0,180}submitActaskLogin\\('${kind}'\\)`));
    }
    assert.match(html, /async function submitActaskLogin\(kind\)/);
    assert.match(html, /function logoutActaskSession\(\)/);
});

test('roles múltiplas do Actask são a união das permissões da operação de peças', () => {
    assert.match(piecesUi, /Array\.isArray\(user\?\.roles\) \? user\.roles/);
    assert.match(piecesUi, /roles\.includes\('Logística\/Faturamento'\) \|\| roles\.includes\('Faturamento'\)/);
    assert.match(piecesUi, /roles\.includes\('Envio\/Coleta'\) \|\| roles\.includes\('Expedição'\)/);
});

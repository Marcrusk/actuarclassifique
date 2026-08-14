const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const piecesUi = fs.readFileSync('js/pieces-ui.js', 'utf8');
const actaskAuth = fs.readFileSync('js/actask-auth.js', 'utf8');

test('shell expõe configuração stage/main sem segredo e carrega o adaptador Actask', () => {
    assert.match(html, /window\.ACTASK_AUTH_CONFIG = window\.ACTASK_AUTH_CONFIG \|\|/);
    assert.match(html, /https:\/\/actaskapistage\.bluefronte\.com/);
    assert.match(html, /actuar-classifique-main-login/);
    assert.match(html, /js\/actask-auth\.js\?v=/);
    assert.doesNotMatch(html, /AUTH_OIDC_SIGNING_SECRET\s*=/);
    assert.doesNotMatch(html, /client_secret\s*:/);
});

test('login Actask exibe equipes e usuários do diretório público e usa a seleção validada', () => {
    assert.match(html, /id="actaskDirectoryPanel"/);
    assert.match(html, /id="actaskTeamSelect"/);
    assert.match(html, /id="actaskUserSelect"/);
    assert.match(html, /id="actaskPass"/);
    assert.match(html, /async function loadActaskLoginOptions\(\)/);
    assert.match(html, /window\.ActaskAuth\.loadLoginOptions\(\)/);
    assert.match(html, /async function submitActaskDirectoryLogin\(e\)/);
    assert.match(html, /window\.ActaskAuth\.loginSelected\(team, user, passwordInput\.value\)/);
    assert.match(html, /isDirectoryConfigured\?\.\(\)/);
    assert.match(html, /classList\.toggle\('hidden', enabled\)/);
    assert.match(actaskAuth, /\/auth\/login-options/);
    assert.match(actaskAuth, /\/auth\/login-selected/);
    assert.match(actaskAuth, /\/auth\/login-selected-external/);
    assert.match(html, /function logoutActaskSession\(\)/);
});

test('roles múltiplas do Actask são a união das permissões da operação de peças', () => {
    assert.match(piecesUi, /Array\.isArray\(user\?\.roles\) \? user\.roles/);
    assert.match(piecesUi, /roles\.includes\('Logística\/Faturamento'\) \|\| roles\.includes\('Faturamento'\)/);
    assert.match(piecesUi, /roles\.includes\('Envio\/Coleta'\) \|\| roles\.includes\('Expedição'\)/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');

/* Regressão da volta atrás do Auth: analistas e Toletus Lab ficaram sem senha e sem caminho
   de volta. Eram cinco pontos somados — o campo escondido, a senha descartada na criação, a
   exigência restrita a dois papéis, o mínimo só no autoatendimento e o lote sem o Lab. */

function trecho(inicio, fim) {
    const start = html.indexOf(inicio);
    const end = html.indexOf(fim, start + 1);
    assert.ok(start > -1 && end > start, `trecho não encontrado: ${inicio}`);
    return html.slice(start, end);
}

test('o campo de senha da ficha aparece para todo papel', () => {
    // Escondido para analista, a gestão não tinha onde digitar a senha na criação da ficha.
    const markup = trecho('id="inputUserPasswordWrap"', '</div>');
    assert.doesNotMatch(markup, /class="hidden/, 'o campo não pode nascer escondido');

    const funcao = trecho('function onUserRoleChange(', 'function startEditUser(');
    assert.doesNotMatch(funcao, /classList\.add\('hidden'\)/, 'nenhum papel perde o campo de senha');
    assert.doesNotMatch(funcao, /Gestor Adm/, 'a visibilidade não depende mais do papel');
});

test('a criação grava a senha no banco seja qual for o papel', () => {
    const criacao = trecho('// Cadastra novo usuário', 'const ok = await persistStore();');
    assert.match(criacao, /const saved = await setUserPasswordRemote\(newId, password\);/);
    assert.match(criacao, /hasPassword: true/, 'a ficha nasce com acesso registrado');
    assert.doesNotMatch(criacao, /needsPassword/, 'não existe mais papel que dispense a senha');
});

test('toda ficha nova exige senha, e a edição em branco mantém a atual', () => {
    const validacao = trecho('const jaTemSenha', 'if (!appStore.users)');
    assert.match(validacao, /if \(!password && !jaTemSenha\)/);
    assert.match(validacao, /appStore\.users\[editId\]\.hasPassword/, 'só quem já tem senha pode deixar em branco');
});

test('o mínimo de 8 caracteres vale também para a senha criada pela gestão', () => {
    // Antes a regra existia só no autoatendimento do perfil: pela ficha passava um caractere.
    const validacao = trecho('const jaTemSenha', 'if (!appStore.users)');
    assert.match(validacao, /password\.length < 8/);

    const perfil = trecho('const passwordError = document.getElementById', 'const valid = await verifyLoginRemote');
    assert.match(perfil, /newPassword\.length < 8/, 'o autoatendimento mantém o mesmo mínimo');
});

test('o lote de primeiro acesso alcança Toletus Lab e a operação de peças', () => {
    // analystOptionIds() filtra por isRankableUser, que exclui exatamente esses papéis.
    const lote = trecho('async function generateAnalystPasswords()', 'showGeneratedPasswords(created)');
    assert.doesNotMatch(lote, /const pending = analystOptionIds\(\)/, 'o lote não pode voltar a depender do ranking');
    assert.match(lote, /Object\.keys\(usersList\)\.filter\(id => usersList\[id\]\.active !== false && !usersList\[id\]\.hasPassword\)/);
});

test('o gestor consegue trocar a senha de qualquer pessoa por dois caminhos', () => {
    // Pela ficha, digitando uma senha escolhida...
    const edicao = trecho('// Atualiza o usuário existente', '// Cadastra novo usuário');
    assert.match(edicao, /if \(password\) \{[\s\S]*setUserPasswordRemote\(editId, password\)/);

    // ...e pelo cartão da pessoa, com senha gerada, para qualquer perfil.
    const reset = trecho('async function resetUserPassword(userId)', 'renderUsersManagementTable();');
    assert.match(reset, /setUserPasswordRemote\(userId, password\)/);
    assert.doesNotMatch(reset, /isRankableUser|isPiecesOperatorRole/, 'a redefinição não filtra por papel');
    assert.match(html, /onclick="resetUserPassword\('\$\{id\}'\)"/, 'o botão vive no cartão de cada pessoa');
});

test('o login continua conferindo a senha no banco, sem credencial no frontend', () => {
    const verify = trecho('async function verifyLoginRemote', 'async function ');
    assert.match(verify, /rpc\('verify_login'/);
    assert.match(html, /rpc\('set_user_password'/);
    // O JSON público guarda apenas o booleano.
    assert.doesNotMatch(html, /password:\s*['"][^'"]{3,}['"]/, 'nenhuma senha literal no frontend');
});

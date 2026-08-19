const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

/* ==========================================================================
   RENOVAR O ACESSO DE TODOS OS ATIVOS
   "Gerar senhas de primeiro acesso" só alcança quem ainda NÃO tem acesso — serve
   para destravar cadastro novo, não para uma troca periódica. Faltava a operação
   que sobrescreve o que já existe, que é a que derruba todo mundo até receber o
   novo — e por isso é a que mais precisa de confirmação e de rastro.
   ========================================================================== */

const html = fs.readFileSync('index.html', 'utf8');
const bloco = html.slice(html.indexOf('async function resetAllActivePasswords()'), html.indexOf('function analystOptionIds()'));

test('alcança os ativos e deixa os inativos de fora, dizendo quantos', () => {
    assert.match(bloco, /const alvos = Object\.keys\(usersList\)\.filter\(id => usersList\[id\]\.active !== false\);/);
    /* Inativo não consegue entrar de qualquer forma; incluí-lo só poluiria a lista que vai
       ser distribuída pessoa a pessoa. Mas o número aparece, para ninguém achar que esqueceu. */
    assert.match(bloco, /const inativos = Object\.keys\(usersList\)\.length - alvos\.length;/);
    assert.match(bloco, /\$\{inativos \? ` \$\{inativos\} inativo\(s\) ficam de fora\.` : ''\}/);
});

test('confirma duas vezes, e a segunda com a credencial de quem está mandando', () => {
    // A primeira diz o tamanho do estrago; a segunda prova que é quem diz ser.
    assert.match(bloco, /title: `Renovar o acesso de \$\{alvos\.length\} pessoa\(s\) ativa\(s\)\?`/);
    assert.match(bloco, /O acesso atual de cada uma deixa de valer na hora/);
    assert.match(bloco, /input: \{ type: 'password', label: 'Acesso de gestão'/, 'campo mascarado, como no resto do sistema');
    assert.match(bloco, /if \(!await verifyLoginRemote\(currentAdminId, confirmacao\)\) return showToast\('Credencial incorreta\. Nada foi alterado\.'/);

    // E só a gestão chega aqui.
    assert.match(bloco, /if \(!canManageUserEmail\(\)\) return showToast\('Entre no Modo Gestão para renovar acessos\.'/);
    // A ordem importa: nada é gravado antes das duas confirmações.
    assert.ok(bloco.indexOf('verifyLoginRemote') < bloco.indexOf('setUserPasswordRemote'));
});

test('o que falhar é nomeado, não escondido num "algumas falharam"', () => {
    /* Numa troca em massa, um erro genérico deixa quem administra sem saber quem ficou sem
       entrar — e essa pessoa só descobre no dia seguinte, tentando trabalhar. */
    assert.match(bloco, /if \(!await setUserPasswordRemote\(id, nova\)\) \{ falhas\.push\(usersList\[id\]\.name\); continue; \}/);
    assert.match(bloco, /Falharam: \$\{falhas\.join\(', '\)\}/);
    assert.match(bloco, /if \(!criadas\.length\) return showToast\('Nada foi gravado\.', 'error'\);/);
});

test('a operação deixa rastro no Histórico, e o conteúdo não é gravado em lugar nenhum', () => {
    assert.match(bloco, /type: 'ACESSO', userId: currentAdminId, value: 0/);
    assert.match(bloco, /Renovação em massa: \$\{criadas\.length\} acesso\(s\) de usuários ativos\./);

    /* `historyRows` descarta tipo desconhecido em silêncio (`else return`), então registrar o
       log sem registrar o TIPO não deixaria rastro nenhum — o pior dos dois mundos. */
    assert.match(html, /ACESSO: \{ label: 'Acesso', tone: 'text-primary-300', row: 'bg-primary-500\/10' \}/);
    assert.match(html, /else if \(log\.type === 'ACESSO'\) detail = escapeHtml\(log\.detail \|\| 'Operação de acesso'\);/);
    assert.match(html, /<option value="ACESSO">Acesso<\/option>/, 'e dá para filtrar por ele');

    // O que foi gerado só existe na tela, uma vez. O JSON sincronizado guarda um booleano.
    assert.match(bloco, /usersList\[id\]\.hasPassword = true;/);
    assert.doesNotMatch(bloco, /password:\s*nova[^}]*appStore/, 'nada do conteúdo pode ir para o store');
    assert.match(bloco, /showGeneratedPasswords\(criadas\);/, 'a lista aparece uma única vez, como no primeiro acesso');
});

test('reaproveita o gerador e a gravação do produto, sem caminho paralelo', () => {
    // Mesmo gerador do primeiro acesso: sem 0/O nem 1/l, porque alguém vai ler e digitar.
    assert.match(bloco, /const nova = makeTempPassword\(\);/);
    assert.match(html, /const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';/);
    // E a gravação continua sendo a RPC do banco: nada disso passa pelo JSON público.
    assert.match(bloco, /setUserPasswordRemote\(id, nova\)/);
    assert.match(html, /async function setUserPasswordRemote\(userId, plainPassword\) \{/);

    // O botão fica ao lado do de primeiro acesso, e com tom de perigo — ele sobrescreve.
    assert.match(html, /<button type="button" class="actuar-btn actuar-btn-danger actuar-btn-sm" onclick="resetAllActivePasswords\(\)">/);
    assert.match(html, /Renovar acesso de todos os ativos/);
});

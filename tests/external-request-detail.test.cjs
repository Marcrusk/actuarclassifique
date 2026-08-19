const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

/* ==========================================================================
   O CHAMADO INTEIRO, PARA OS DOIS LADOS
   A área que abriu via protocolo, cliente e a etapa — e nada do que aconteceu
   depois. A gestão via um pouco mais, mas também parava no que foi registrado na
   abertura: nenhuma das duas telas mostrava quem pegou o chamado, desde quando,
   quantas vezes tentou falar com o cliente ou como terminou.

   Tudo isso já existia: na ficha do atendimento enquanto está em curso, e no
   lançamento depois de concluído. Faltava ligar as pontas.
   ========================================================================== */

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
const detalhe = html.slice(html.indexOf('function externalAttendanceDetail(item)'), html.indexOf('function openExternalRequest(id)'));

test('o bloco do atendimento é um só, usado pela gestão e pelo Portal', () => {
    /* Duas telas montando o mesmo bloco divergem na primeira mudança — foi por isso que a
       ficha do atendimento já era um renderizador só entre aprovação e auditoria. */
    assert.equal((html.match(/\$\{externalAttendanceDetail\(item\)\}/g) || []).length, 2, 'gestão e Portal chamam o mesmo renderizador');
    assert.ok(html.indexOf('function externalAttendanceDetail') < html.indexOf('function openExternalRequest'));
    // E ele reaproveita a ficha que a aprovação e a auditoria já leem.
    assert.match(detalhe, /renderPriorityAttendanceEvidence\(fonte\)/);
});

test('o andamento vem do rodízio enquanto está em curso, e do lançamento depois', () => {
    /* Concluir tira o atendimento de `rotation.active` e copia tudo para o lançamento. Ler
       só um dos dois deixaria metade dos chamados sem história. */
    assert.match(html, /function externalLinkedAttendance\(item\)/);
    assert.match(html, /item\.attendanceId \? PriorityRotation\.attendanceById\(rodizio, item\.attendanceId\) : null/);
    assert.match(detalhe, /const lancamento = typeof externalPriorityRequest === 'function' \? externalPriorityRequest\(item\) : null;/);
    assert.match(detalhe, /const fonte = lancamento \|\| \(emCurso \?/);

    // O que a pessoa quer saber: quem está com o chamado, desde quando, e em que pé está.
    assert.match(detalhe, /linha\('Analista', analista\?\.name\)/);
    assert.match(detalhe, /Em andamento há \$\{priorityRotationDuration\(emCurso\.startedAt\)\}/);
    assert.match(detalhe, /Concluído pelo analista/);
    assert.match(detalhe, /linha\('Protocolo do atendimento', lancamento\?\.protocolo\)/);
    assert.match(detalhe, /Justificativa do analista/);
});

test('antes de ser encaminhada, o bloco diz que falta acontecer — não que falta informação', () => {
    assert.match(detalhe, /if \(!analista && !emCurso && !lancamento\)/);
    assert.match(detalhe, /Ainda não foi encaminhada a um analista\./);
});

test('no Portal o cartão abre a ficha, e os botões não abrem junto', () => {
    const cartao = html.slice(html.indexOf('function portalAreaCard(item)'), html.indexOf('async function registerAttendanceContact') > 0 ? html.indexOf('function portalAreaCard(item)') + 3000 : undefined);
    assert.match(cartao, /role="button"/);
    assert.match(cartao, /onclick="if\(!event\.target\.closest\('\.portal-area-card-actions'\)\) openPortalAreaDetail\('/, 'clicar em Cancelar não pode abrir a gaveta atrás do diálogo');
    assert.match(cartao, /onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '\)/, 'teclado abre igual ao mouse');
    // E precisa parecer clicável antes de alguém tentar.
    assert.match(css, /\.portal-area-card\[role="button"\]:hover \{ border-color: var\(--actuar-primary\)/);
    assert.match(css, /\.portal-area-card-actions \{ position: relative; z-index: 1; \}/);
});

test('a ficha do Portal mostra a abertura, o atendimento e a linha do tempo', () => {
    const ficha = html.slice(html.indexOf('function openPortalAreaDetail(id)'), html.indexOf('function closePortalAreaDetail()'));

    // Só o que é da área dela: o recorte é reaplicado, não herdado do que estava na tela.
    assert.match(ficha, /const item = portalAreaRequests\(\)\.find\(row => row\.id === id\);/);
    for (const bloco of ['Cliente', 'O que o cliente precisa', 'Quem registrou']) {
        assert.ok(ficha.includes(`<h3>${bloco}</h3>`), `falta o bloco ${bloco}`);
    }
    assert.match(ficha, /\$\{externalAttendanceDetail\(item\)\}/);
    /* Aberta por padrão: acompanhar É ler a linha do tempo. Na gestão ela fica recolhida
       porque lá o trabalho é decidir, não acompanhar. */
    assert.match(ficha, /<details class="pieces-audit" open><summary>Linha do tempo<\/summary>/);
    assert.match(ficha, /\(item\.events \|\| \[\]\)\.slice\(\)\.reverse\(\)/, 'o mais recente primeiro');

    // As ações continuam sendo as duas da área, e a etapa decide quais aparecem.
    assert.match(ficha, /dominio\.canAreaRespond\(item\) \?/);
    assert.match(ficha, /dominio\.canAreaCancel\(item\) \?/);
    assert.match(ficha, /Nesta etapa não há ação da sua área\./);
});

test('a ficha fecha por Esc e reabre no estado novo depois de uma ação', () => {
    // Entra na mesma corrente de Escape das outras camadas, e antes delas.
    assert.match(html, /if \(!document\.getElementById\('portalAreaDetail'\)\?\.classList\.contains\('hidden'\)\) closePortalAreaDetail\(\);/);
    /* Fechar e devolver ao quadro faria a pessoa procurar o mesmo chamado de novo só para
       conferir o que mudou. */
    assert.match(html, /if \(portalAreaDetailId === id\) openPortalAreaDetail\(id\);/);
    assert.match(html, /function closePortalAreaDetail\(\) \{[\s\S]{0,200}document\.body\.style\.overflow = '';/);
});

test('cancelar aparece em vermelho, nos dois lugares', () => {
    /* Cancelar tira a solicitação do fluxo e não tem volta pela tela da área. Em cinza, ao
       lado de "Responder", parecia uma alternativa neutra — a cor precisa dizer o peso
       antes do clique, não só o diálogo depois dele. */
    const cancelar = [...html.matchAll(/<button type="button" class="([^"]+)" onclick="portalAreaCancel\(/g)].map(item => item[1]);
    assert.equal(cancelar.length, 2, 'o botão existe no cartão e na ficha');
    for (const classes of cancelar) {
        assert.ok(classes.includes('actuar-btn-danger'), `botão de cancelar sem tom de perigo: ${classes}`);
        assert.ok(!classes.includes('actuar-btn-secondary'), 'o tom neutro precisa sair junto');
    }
    // Responder continua primário: é a ação que faz a solicitação andar.
    assert.match(html, /class="actuar-btn actuar-btn-primary" onclick="portalAreaRespond\(/);

    // Texto branco sobre o vermelho do Design System: 4.67 de contraste, medido em Chrome.
    assert.match(css, /\.actuar-btn-danger \{ background: var\(--actuar-danger\); border-color: var\(--actuar-danger\); color: #FFF; \}/);
});

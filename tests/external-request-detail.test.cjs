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

test('o cartão diz quem está atendendo, de que equipe é, e o começo da descrição', () => {
    const cartao = html.slice(html.indexOf('function portalAreaCard(item)'), html.indexOf('async function portalAreaMutate'));

    /* A etiqueta contextual é a MESMA da gestão: em atendimento ela traz o nome de quem está
       com o chamado; nas outras etapas diz de quem é a bola. Reescrevê-la aqui faria as duas
       telas contarem histórias diferentes do mesmo estado. */
    assert.match(cartao, /const tag = externalCardTag\(item\);/);
    assert.match(html, /if \(etapa === 'em_atendimento'\) \{\s*\n\s*return \{ tone: 'violet', icon: 'fi-rr-user', label: users\[item\.analystId\]\?\.name\?\.split\(' '\)\[0\]/);

    // Equipe: Software ou Catraca, com o rótulo que o resto da aplicação usa.
    assert.match(cartao, /teamLabel\(item\.team\)/);
    // E o começo da descrição, cortado em duas linhas pelo CSS.
    assert.match(cartao, /<p class="external-card-need">\$\{escapeHtml\(item\.need \|\| 'Sem descrição registrada\.'\)\}<\/p>/);
    assert.match(css, /\.external-card-need \{[\s\S]*?-webkit-line-clamp: 2;/);
});

test('a descrição do cartão lê o campo que existe', () => {
    /* O cartão do Portal nasceu lendo `item.demand`, que não existe na solicitação externa —
       o portal grava `need`. A descrição simplesmente nunca aparecia. */
    const cartao = html.slice(html.indexOf('function portalAreaCard(item)'), html.indexOf('async function portalAreaMutate'));
    assert.ok(!cartao.includes('item.demand'), 'voltou a ler um campo que a solicitação não tem');
    assert.match(html, /need: document\.getElementById\('portalNeed'\)\.value\.trim\(\)/, 'é este o campo que o portal grava');
});

test('"fila ocupada" e "sem analista" voltaram a ser causas diferentes', () => {
    /* As duas condições ficaram idênticas quando a de ocupado passou de `view.current` para
       `!view.next`: a segunda virou linha morta e "Sem analista" nunca mais apareceu. */
    const etiqueta = html.slice(html.indexOf('function externalCardTag(item)'), html.indexOf('function externalCard(item)'));
    assert.match(etiqueta, /if \(!view\.next && \(view\.active \|\| \[\]\)\.length\) return \{ tone: 'warning', icon: 'fi-rr-clock', label: 'Fila ocupada' \};/);
    assert.match(etiqueta, /if \(!view\.next\) return \{ tone: 'warning', icon: 'fi-rr-user-slash', label: 'Sem analista' \};/);
    // Nenhuma condição repetida sobrou no bloco.
    const condicoes = (etiqueta.match(/if \(!view\.next\)/g) || []).length;
    assert.equal(condicoes, 1, 'a condição duplicada voltou');
});

test('"Aguardando aprovação" tem tom próprio, e ele vem do domínio', () => {
    const E = require('../js/external-requests.js');
    const etapa = E.STAGES.find(item => item.id === 'aguardando_aprovacao');

    /* Das quatro esperas do quadro, esta é a única que depende da GESTÃO. Com o mesmo âmbar
       das outras três, "quem está me devendo" só se descobria lendo o rótulo de cada coluna. */
    assert.equal(etapa.tone, 'pink');
    /* As outras esperas deixaram de dividir o âmbar: cada uma diz de quem é a bola pela cor
       — teal espera a fila, violeta está com o analista, laranja espera o cliente. */
    assert.equal(E.STAGES.find(item => item.id === 'aguardando_info').tone, 'warning');
    assert.equal(E.STAGES.find(item => item.id === 'aguardando_distribuicao').tone, 'teal');
    assert.equal(E.STAGES.find(item => item.id === 'sem_retorno').tone, 'orange');

    /* O tom é nome de token, não cor — é o que o próprio domínio diz: "quem muda a paleta
       muda em um lugar". Então o rosa precisa existir como variante de badge. */
    assert.match(css, /\.actuar-badge-pink \{ border-color: color-mix\(in srgb, var\(--actuar-pink\) 30%, transparent\); background: var\(--actuar-pink-soft\); color: var\(--actuar-pink\); \}/);
    // E como token nos DOIS temas: definido só num deles, sumiria no outro.
    assert.match(css, /--actuar-pink: #B0154F;\s*\n\s*--actuar-pink-soft: #FCE4EC;/, 'tema claro');
    assert.match(css, /--actuar-pink: #F9A8C9;\s*\n\s*--actuar-pink-soft: #3D1A28;/, 'tema escuro');

    // A etiqueta contextual do cartão acompanha, senão a mesma etapa teria duas cores.
    assert.match(html, /if \(etapa === 'aguardando_aprovacao'\) return \{ tone: 'pink', icon: 'fi-rr-check-circle', label: 'Aguarda aprovação' \};/);

    /* Medido em Chrome: 5.69 no claro e 8.33 no escuro — o melhor contraste da paleta de
       badges. Nenhuma cor foi escrita à mão nas telas; tudo sai do token. */
    assert.ok(!/actuar-badge-pink[^}]*#[0-9a-fA-F]{3,6}/.test(css), 'cor literal na variante do badge');
});

test('cada etapa tem a sua cor, e o cartão não repete o que a coluna já diz', () => {
    const E = require('../js/external-requests.js');

    // Oito etapas, oito tons — nenhum dividido.
    assert.equal(new Set(E.STAGES.map(item => item.tone)).size, 8);

    /* O cartão trazia o nome da etapa E a etiqueta contextual — "Aguardando aprovação" e
       "Aguarda aprovação" —, dentro de uma coluna com esse mesmo título: três vezes o mesmo.
       Fica a contextual, que é a única que acrescenta; sem ela, o nome da etapa. */
    const cartao = html.slice(html.indexOf('function portalAreaCard(item)'), html.indexOf('async function portalAreaMutate'));
    const etiquetas = (cartao.match(/actuar-badge-\$\{escapeHtml\((tag|etapa)\.tone/g) || []);
    assert.equal(etiquetas.length, 2, 'as duas etiquetas precisam ser alternativas, não empilhadas');
    assert.match(cartao, /\$\{tag\s*\n\s*\? `<span class="actuar-badge actuar-badge-\$\{escapeHtml\(tag\.tone\)\}/, 'a contextual tem precedência');
    assert.match(cartao, /: `<span class="actuar-badge actuar-badge-\$\{escapeHtml\(etapa\.tone \|\| 'neutral'\)\}/, 'e o nome da etapa é o alternativo');

    /* A etiqueta usa o MESMO tom da etapa: coluna violeta com cartão azul dentro faz a cor
       deixar de ser pista e virar ruído. */
    const etiqueta = html.slice(html.indexOf('function externalCardTag(item)'), html.indexOf('function externalCard(item)'));
    assert.match(etiqueta, /label: users\[item\.analystId\]\?\.name\?\.split\(' '\)\[0\] \|\| 'Em atendimento'/);
    for (const [etapa, tom] of [['em_atendimento', 'violet'], ['sem_retorno', 'orange'], ['aguardando_aprovacao', 'pink']]) {
        assert.ok(etiqueta.includes(`tone: '${tom}'`), `a etiqueta de ${etapa} precisa usar o tom da etapa`);
    }

    // A coluna carrega o tom no topo: o funil passa a ser lido pela cor, não pelos títulos.
    assert.equal((html.match(/class="external-column is-tone-\$\{escapeHtml\(coluna\.tone \|\| 'neutral'\)\}"/g) || []).length, 2, 'gestão e Portal');
    for (const tom of ['info', 'primary', 'warning', 'teal', 'violet', 'orange', 'pink', 'success']) {
        assert.match(css, new RegExp(`\\.external-column\\.is-tone-${tom} \\{ border-top-color: var\\(--actuar-${tom}\\); \\}`), `falta a faixa de ${tom}`);
    }
});

test('os tons novos existem nos dois temas e passam de contraste', () => {
    /* Medido em Chrome sobre o próprio fundo: teal 5.24/7.37, violet 6.30/6.98,
       orange 4.98/7.27, pink 5.69/8.33 (claro/escuro). Definir num tema só some no outro. */
    for (const tom of ['teal', 'violet', 'orange', 'pink']) {
        assert.equal((css.match(new RegExp(`--actuar-${tom}: #`, 'g')) || []).length, 2, `--actuar-${tom} precisa existir nos dois temas`);
        assert.equal((css.match(new RegExp(`--actuar-${tom}-soft: #`, 'g')) || []).length, 2, `--actuar-${tom}-soft precisa existir nos dois temas`);
        assert.match(css, new RegExp(`\\.actuar-badge-${tom} \\{ border-color: color-mix\\(in srgb, var\\(--actuar-${tom}\\) 30%, transparent\\); background: var\\(--actuar-${tom}-soft\\); color: var\\(--actuar-${tom}\\); \\}`));
    }
});

/* ==========================================================================
   O ENCAMINHAMENTO DO PORTAL PARAVA NO PRODUTO
   Quando o produto virou obrigatório no rodízio, o caminho que vem do Portal não
   foi ligado: a gestão validava, clicava em Encaminhar e recebia "Escolha o
   produto do atendimento" — uma exigência que ela não tinha como cumprir dali,
   porque a marca é perguntada lá no Portal, no ato do registro.
   ========================================================================== */

test('a marca registrada no Portal vira o produto do atendimento', () => {
    const envio = html.slice(html.indexOf('async function externalAssign()'), html.indexOf('function externalSkipNext'));
    assert.match(envio, /product: item\.brand,/, 'o dado existia e não chegava ao rodízio');

    // O Portal já exige a marca no passo 1: não é informação nova pedida no meio do caminho.
    assert.match(html, /if \(step === 1\) return \['portalBrand', 'portalClientId', 'portalClientName', 'portalPhone'\];/);
    assert.match(html, /Escolha de qual marca o cliente é\./);
});

test('todo caminho que encaminha monta o briefing completo', () => {
    /* Dois hoje: o despacho manual da gestão e o do Portal. Um terceiro que esquecesse um
       campo só apareceria como recusa do domínio na frente de quem clicou. */
    const chamadas = [...html.matchAll(/PriorityRotation\.assign\(/g)];
    assert.equal(chamadas.length, 2, 'apareceu um caminho novo de encaminhamento: confira o briefing dele');

    const campos = ['demand', 'product', 'clientName', 'clientId', 'phone', 'instructions'];
    const despacho = html.slice(html.indexOf('async function confirmPriorityRotationDispatch('), html.indexOf('function closePriorityRotationDrawer('));
    const portal = html.slice(html.indexOf('async function externalAssign()'), html.indexOf('function externalSkipNext'));
    for (const campo of campos) {
        assert.match(despacho, new RegExp(`${campo}:`), `o despacho manual não leva ${campo}`);
        assert.match(portal, new RegExp(`${campo}:`), `o encaminhamento do Portal não leva ${campo}`);
    }
});

test('faltando o produto, o aviso vem antes do clique — não depois', () => {
    const painel = html.slice(html.indexOf('function externalDistributionPanel(item)'), html.indexOf('async function externalAssign()'));

    /* Barrar depois do clique, num aviso no canto da tela, deixa a gestão sem saber o que
       fazer: o dado que falta foi preenchido no Portal, não ali. */
    assert.match(painel, /const marcasValidas = window\.PriorityRotation\?\.BRANDS \|\| \[\];/);
    assert.match(painel, /if \(!marcasValidas\.includes\(item\.brand\)\)/);
    assert.match(painel, /<strong>Falta o produto<\/strong>/);
    assert.ok(painel.indexOf('marcasValidas.includes') < painel.indexOf('externalAssign()'), 'a checagem precisa vir antes do botão');
    // E o produto aparece no painel, para a gestão conferir o que vai junto.
    assert.match(painel, /Produto: \$\{escapeHtml\(item\.brand\)\}/);
});

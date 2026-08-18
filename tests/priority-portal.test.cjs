const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fields = require('../js/actuar-fields.js');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

function bloco(inicio, fim) {
    const start = html.indexOf(inicio);
    const end = html.indexOf(fim, start + 1);
    assert.ok(start > -1 && end > start, `bloco não encontrado: ${inicio}`);
    return html.slice(start, end);
}

/* Porta externa para Comercial e Administrativo registrarem uma situação de cliente sem ter
   conta no ActuarClassifique. O que entra aqui não pode virar fluxo paralelo: alimenta o
   mesmo rodízio, com o mesmo briefing que a gestão preenche à mão hoje. */

test('o portal tem endereço próprio e não abre a plataforma interna', () => {
    assert.match(html, /'portal-prioridades': \{ title: 'Portal de Prioridades'/);
    // Sem entrada no ROUTE_META, sanitizeRoute jogaria o link externo no dashboard.
    assert.match(html, /function isPortalRoute\(\) \{ return currentRoute\?\.name === 'portal-prioridades'; \}/);

    // O shell interno some por inteiro: cabeçalho, faixa do menu, sidebar e barra de páginas.
    for (const parte of ['.actuar-global-header', '.actuar-nav-rail', '.actuar-nav', '.actuar-toolbar', '#appContent']) {
        assert.ok(css.includes(`body.actuar-portal-mode ${parte}`), `o portal não esconde ${parte}`);
    }
    /* O cabeçalho de página (#pageHeader, com título e descrição da rota) vive dentro do
       #appContent: escondendo só as partes visíveis, ele aparecia acima do portal como se
       fosse mais uma tela do sistema. */
    const posPortal = html.indexOf('<section id="viewPortal"');
    const posMain = html.indexOf('<main id="appContent"');
    assert.ok(posPortal > -1 && posPortal < posMain, 'o portal precisa viver fora da área interna');
    assert.match(html, /document\.body\.classList\.toggle\('actuar-portal-mode', noPortal\)/);
});

test('o portão de login não cobre o portal, e cobre todo o resto', () => {
    const gate = bloco('function syncLoginGate()', 'function ');
    assert.match(gate, /!hasAnySession\(\) && !isPortalRoute\(\)/);
});

test('o nome vem de lista predefinida, sem texto livre', () => {
    const lista = bloco('const PORTAL_COLLABORATORS = [', '];');
    for (const area of ['Comercial', 'Financeiro', 'Administrativo', 'Implantação']) {
        assert.ok(lista.includes(area), `departamento ausente na lista: ${area}`);
    }
    assert.match(lista, /role: 'SDR'/);
    assert.match(lista, /role: 'Closer'/);

    const markup = bloco('for="portalCollaborator"', '</div>');
    assert.match(markup, /<select id="portalCollaborator"/, 'o colaborador precisa ser escolha, não digitação');
    assert.doesNotMatch(markup, /<input/, 'nome digitado abriria a porta para qualquer um');

    // Inativo não aparece na porta.
    const filtro = bloco('function portalCollaborators()', 'function portalCollaborator(');
    assert.match(filtro, /item\.active !== false/);
});

test('o PIN fica isolado num ponto só, pronto para ir ao banco', () => {
    /* Enquanto morar no navegador ele não autentica ninguém — evita acesso casual e nada
       mais. O teste garante que exista UM lugar para trocar quando virar RPC. */
    assert.equal((html.match(/const PORTAL_PIN = /g) || []).length, 1);
    const entrada = bloco('function portalEnter(event)', 'function portalSignOut()');
    assert.match(entrada, /pin !== PORTAL_PIN/);
    // Mensagem única: dizer o que estava errado ajudaria a descobrir o PIN.
    assert.match(entrada, /PIN incorreto\. Confira o código informado e tente novamente\./);
    assert.doesNotMatch(entrada, /PIN correto é|esperado/i);
    // As caixas são limpas em toda saída sem entrada: PIN errado, e nome não escolhido.
    assert.equal((entrada.match(/portalPinClear\(/g) || []).length, 3);
});

test('a sessão do portal é limitada e expira sozinha', () => {
    const leitura = bloco('function readPortalSession()', 'function writePortalSession(');
    assert.match(leitura, /PORTAL_SESSION_HOURS \* 3600000/, 'a sessão precisa expirar');
    assert.match(html, /sessionStorage\.getItem\(PORTAL_SESSION_KEY\)/, 'sessão da aba, não do dispositivo');
    // Encerrar acesso limpa de verdade.
    const saida = bloco('function portalSignOut()', 'function portalPickTeam(');
    assert.match(saida, /sessionStorage\.removeItem\(PORTAL_SESSION_KEY\)/);
    assert.match(saida, /portalSession = null/);
});

test('o ID de atendimento reusa a regra que já existe no produto', () => {
    // Duas letras e quatro números: o tipo clientId do Design System já faz isso.
    assert.equal(fields.validate('clientId', 'TZ2345').valid, true);
    assert.equal(fields.validate('clientId', '2345').valid, false);
    assert.equal(fields.validate('clientId', 'TZ23').valid, false);
    const campo = bloco('id="portalClientId"', '</div>');
    assert.match(campo, /data-field="clientId"/, 'o campo precisa usar o tipo do sistema, não uma validação nova');
    const telefone = bloco('id="portalPhone"', '</div>');
    assert.match(telefone, /data-field="phone"/);
});

test('as quatro marcas estão na porta de entrada', () => {
    const marcas = bloco('id="portalBrand"', '</select>');
    for (const marca of ['Actuar', 'Ediz', 'Toletus', 'Fácil Fit']) {
        assert.ok(marcas.includes(`<option>${marca}</option>`), `marca ausente: ${marca}`);
    }
});

test('a escolha de Sistema ou Catraca direciona o atendimento', () => {
    const escolha = bloco('function portalPickTeam(team)', 'async function portalSubmit(');
    assert.match(escolha, /será encaminhada para a equipe de/, 'quem registra vê para onde vai');
    assert.match(html, /const PORTAL_TEAMS = \['Sistema', 'Catraca'\];/);

    /* E não vê QUEM atende: nome de analista, posição na fila e estado do rodízio são
       dados internos. O portal é de fora. */
    assert.doesNotMatch(escolha, /PriorityRotation|users\[|\.name/, 'a dica não pode ler o rodízio nem nomear pessoas');
    assert.doesNotMatch(escolha, /Próximo na fila|atendimento em andamento/);
    // E o valor é validado no envio: sem equipe não há destino.
    const envio = bloco('async function portalSubmit(event)', 'function portalShowSuccess(');
    assert.match(envio, /if \(!portalTeam\)/);
});

test('o protocolo é legível e nunca o id interno', () => {
    const protocolo = bloco('function portalNextProtocol()', 'function portalShowError(');
    assert.match(protocolo, /PRI-\$\{ano\}-/);
    assert.match(protocolo, /padStart\(5, '0'\)/);
    // O registro guarda os dois: id interno para o sistema, protocolo para as pessoas.
    const envio = bloco('async function portalSubmit(event)', 'function portalShowSuccess(');
    assert.match(envio, /id: uid\(\)/);
    assert.match(envio, /protocol: protocolo/);
});

test('sucesso só depois da confirmação do banco, e falha preserva os dados', () => {
    const envio = bloco('async function portalSubmit(event)', 'function portalShowSuccess(');
    // A tela de sucesso vem depois do persistStore, nunca antes.
    const posPersist = envio.indexOf('const ok = await persistStore();');
    assert.ok(posPersist > -1 && envio.indexOf('portalShowSuccess(registro)') > posPersist);
    // Rollback: nada de protocolo falso nem card fantasma.
    assert.match(envio, /appStore\.externalRequests = anterior;/);
    assert.match(envio, /Seus dados foram preservados/);
    // Clique duplo não cria duas solicitações.
    assert.match(envio, /if \(portalSending\) return false;/);
    assert.match(envio, /botao\.disabled = true;/);
});

test('a solicitação externa viaja no diff do store', () => {
    // applyStoreDiff parte de deepClone(serverData): chave não declarada some no primeiro
    // salvamento concorrente, levando junto a solicitação recém-registrada.
    assert.match(html, /externalRequests: diffKeyedArray\(base\.externalRequests, local\.externalRequests\)/);
    assert.match(html, /merged\.externalRequests = applyKeyedArrayDiff\(merged\.externalRequests, diff\.externalRequests\)/);
    assert.match(html, /externalRequests: \[\]/);
    assert.match(html, /if \(!appStore\.externalRequests\) appStore\.externalRequests = \[\]/);
});

test('a confirmação é acessível, e não depende da animação', () => {
    const sucesso = bloco('id="portalSuccess"', '</section>');
    assert.match(sucesso, /role="status"/);
    assert.match(sucesso, /aria-live="polite"/);
    assert.match(sucesso, /id="portalSuccessTitle" tabindex="-1"/, 'o foco precisa ir para o título');
    assert.match(sucesso, /Copiar protocolo/);
    // O protocolo é texto, não só imagem ou ícone.
    assert.match(sucesso, /id="portalProtocol"/);
    assert.match(html, /document\.getElementById\('portalSuccessTitle'\)\?\.focus\(\)/);

    // Quem pediu menos movimento recebe a confirmação sem desenho.
    const reduzido = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.actuar-portal-check')));
    assert.match(reduzido, /\.actuar-portal-check circle, \.actuar-portal-check path \{ stroke-dashoffset: 0; animation: none; \}/);
});

test('o portal é responsivo e usa só a identidade existente', () => {
    const portal = css.slice(css.indexOf('.actuar-portal {'));
    assert.match(portal, /@media \(max-width: 860px\)/);
    assert.match(portal, /\.actuar-portal-grid, \.actuar-portal-choice \{ grid-template-columns: 1fr; \}/,
        'no celular o formulário vira uma coluna');
    // Cor por token: nada de paleta nova.
    assert.match(portal, /var\(--actuar-primary\)/);
    assert.match(portal, /var\(--actuar-success\)/);
    // A logo é a oficial do produto.
    assert.match(html, /<img class="actuar-group-logo" src="assets\/actuar\/logos\/actuar-group\.svg" alt="Actuar Group">[\s\S]{0,120}actuar-portal-tag/);
});

test('o portal não monta a aplicação interna nem deixa rastro dela no DOM', () => {
    /* Esconder por CSS não bastaria: ranking, dashboards e nomes de analistas continuariam
       no código-fonte da página, ao alcance de quem tem só o link externo. */
    const render = bloco('if (isPortalRoute()) {', 'syncAccessControls();');
    for (const view of ['viewAgent', 'viewRanking', 'viewAdmin', 'viewPecas', 'viewProfile', 'viewPlatform']) {
        assert.ok(render.includes(`'${view}'`), `${view} continua montada na rota do portal`);
    }
    assert.match(render, /globalNavBody'\)\?\.replaceChildren\(\)/, 'o menu interno não pode sobrar no DOM');
    assert.match(render, /renderPortal\(\);\s*\n\s*return;/, 'o render interno precisa parar aqui');
});

test('nenhuma tela do portal exibe dado de analista', () => {
    const portal = bloco('<section id="viewPortal"', '</section>\n\n    <!-- SHELL GLOBAL ACTUAR -->');
    for (const proibido of ['Ranking', 'Pontuação', 'Rodízio', 'Analista']) {
        assert.ok(!portal.includes(proibido), `o portal menciona "${proibido}", que é dado interno`);
    }
});

/* Seis campos numa tela só viram um paredão. As etapas seguem a ordem do raciocínio de quem
   registra: identificar o cliente, decidir o destino, e só então descrever a situação — que
   é o campo longo, e o único que exige pensar. */

test('o preenchimento acontece em três etapas, nessa ordem', () => {
    const form = bloco('<ol class="actuar-portal-steps"', '</form>');
    assert.deepEqual([...form.matchAll(/<li data-step="(\d)"[^>]*>.*?<\/span>([^<]+)</g)].map(m => [m[1], m[2].trim()]),
        [['1', 'Cliente'], ['2', 'Destino'], ['3', 'Situação']]);

    for (const [passo, campo] of [[1, 'portalBrand'], [1, 'portalClientId'], [1, 'portalClientName'], [1, 'portalPhone'], [2, 'portalTeamStatus'], [3, 'portalNeed']]) {
        const secao = bloco(`class="actuar-portal-step${passo === 1 ? '' : ' hidden'}" data-step="${passo}"`, '</section>');
        assert.ok(secao.includes(`id="${campo}"`), `${campo} deveria estar no passo ${passo}`);
    }
    assert.equal((html.match(/const PORTAL_STEPS = 3;/g) || []).length, 1);
});

test('cada passo valida o que pede antes de liberar o seguinte', () => {
    const valida = bloco('function portalValidateStep(step)', 'function portalRenderStep()');
    assert.match(valida, /if \(step === 2\)[\s\S]*if \(!portalTeam\)/, 'sem destino não avança');
    // As regras de formato continuam sendo as do Design System, sem validação paralela.
    assert.match(valida, /ActuarFields\?\.check/);
    assert.match(valida, /campo\.focus\(\)/, 'o foco vai para o campo que faltou');

    const avanca = bloco('function portalGoStep(direcao)', 'function portalPickTeam(');
    assert.match(avanca, /if \(direcao > 0\)[\s\S]*portalValidateStep\(portalStep\)/);
    assert.match(avanca, /if \(erro\) \{ portalShowError\('portalFormError', erro\); return; \}/);
    // Voltar nunca é barrado: corrigir não pode exigir preencher o que veio depois.
    assert.doesNotMatch(avanca.slice(avanca.indexOf('portalJumpStep')), /portalValidateStep/);
});

test('o botão de enviar só existe no último passo', () => {
    const render = bloco('function portalRenderStep()', 'function portalRenderRecap()');
    assert.match(render, /const ultimo = portalStep === PORTAL_STEPS;/);
    assert.match(render, /portalSubmitButton'\)\?\.classList\.toggle\('hidden', !ultimo\)/);
    assert.match(render, /portalNextButton'\)\?\.classList\.toggle\('hidden', ultimo\)/);
    assert.match(render, /portalBackButton'\)\?\.classList\.toggle\('hidden', portalStep === 1\)/);
});

test('o último passo mostra o que já foi preenchido, com atalho para corrigir', () => {
    const recap = bloco('function portalRenderRecap()', 'function portalJumpStep(');
    for (const rotulo of ['Cliente', 'Empresa', 'Contato', 'Destino']) {
        assert.ok(recap.includes(`'${rotulo}'`), `o resumo não mostra ${rotulo}`);
    }
    assert.match(recap, /portalJumpStep\(\$\{passo\}\)/, 'cada linha volta ao passo que a originou');
    assert.match(recap, /escapeHtml/, 'o resumo repete o que a pessoa digitou: precisa escapar');
});

test('escolher a equipe avança sozinho, e registrar outra volta ao começo', () => {
    const escolha = bloco('function portalPickTeam(team)', 'async function portalSubmit(');
    assert.match(escolha, /if \(portalStep === 2\) setTimeout\(\(\) => portalGoStep\(1\), 260\)/,
        'um passo de clique único não deve exigir um segundo clique para avançar');
    const outra = bloco('function portalNewRequest()', '\n        function ');
    assert.match(outra, /portalJumpStep\(1\)/);
});

test('a etapa respeita quem pediu menos movimento', () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.actuar-portal-step \{ animation: none; \}/);
});

/* O PIN tem tamanho fixo. Um campo de texto livre não conta isso; quatro caixas contam. */

test('o PIN é preenchido em quatro caixas, como um código de verificação', () => {
    const grupo = bloco('<div class="actuar-otp"', '</div>');
    assert.equal((grupo.match(/class="actuar-otp-box"/g) || []).length, 4);
    assert.equal((grupo.match(/inputmode="numeric"/g) || []).length, 4, 'o teclado do celular precisa ser numérico');
    assert.equal((grupo.match(/maxlength="1"/g) || []).length, 4);
    // Cada caixa se anuncia: quem usa leitor de tela precisa saber a posição.
    for (const posicao of [1, 2, 3, 4]) {
        assert.ok(grupo.includes(`aria-label="Dígito ${posicao} de 4"`), `falta o rótulo do dígito ${posicao}`);
    }
    assert.match(grupo, /role="group" aria-labelledby="portalPinLabel"/);
    assert.match(html, /const PORTAL_PIN_BOXES = 4;/);
});

test('digitar, apagar e colar funcionam como num código real', () => {
    const digita = bloco('function portalPinInput(posicao)', 'function portalPinKey(');
    assert.match(digita, /replace\(\/\\D\/g, ''\)/, 'só dígito entra');
    assert.match(digita, /posicao < PORTAL_PIN_BOXES\) portalPinBox\(posicao \+ 1\)\?\.focus\(\)/, 'o foco avança sozinho');

    const tecla = bloco('function portalPinKey(event, posicao)', 'function portalPinPaste(');
    assert.match(tecla, /event\.key === 'Backspace'/, 'apagar volta para a caixa anterior');
    assert.match(tecla, /ArrowLeft/);
    assert.match(tecla, /ArrowRight/);

    const cola = bloco('function portalPinPaste(event)', 'function portalTryEnter()');
    assert.match(cola, /slice\(0, PORTAL_PIN_BOXES\)/, 'colar o código inteiro preenche todas');
    assert.match(html, /onpaste="portalPinPaste\(event\)"/);
});

test('completar as quatro caixas já entra, e errar sinaliza nelas', () => {
    const digita = bloco('function portalPinInput(posicao)', 'function portalPinKey(');
    assert.match(digita, /portalPinValue\(\)\.length === PORTAL_PIN_BOXES\) portalTryEnter\(\)/);

    const entrada = bloco('function portalEnter(event)', 'function portalSignOut()');
    assert.match(entrada, /classList\.add\('is-invalid'\)/, 'o erro precisa aparecer nas caixas, não só no texto');
    assert.match(entrada, /pin\.length < PORTAL_PIN_BOXES/, 'código incompleto não vira "PIN incorreto"');

    // A sacudida é reforço visual, e some para quem pediu menos movimento.
    assert.match(css, /\.actuar-otp\.is-invalid \{ animation: otpShake/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.actuar-otp\.is-invalid \{ animation: none; \}/);
});

/* A base dos campos é `body.actuar-app input:not(...)`, com (0,4,2) e !important. Uma regra
   de classe simples perde: as caixas do PIN saíam com largura 100%, altura 32px e fundo
   claro — fora do quadrado. É a armadilha de especificidade que o projeto já documenta. */

test('as caixas do PIN vencem a regra global de campo', () => {
    const regra = css.slice(css.indexOf('body.actuar-app .actuar-otp .actuar-otp-box {'), css.indexOf('body.actuar-app .actuar-otp .actuar-otp-box:hover'));
    assert.ok(regra, 'o seletor precisa subir de especificidade para body.actuar-app');
    // Mesmas propriedades que a base força, senão a base vence.
    for (const propriedade of ['width', 'padding', 'border', 'border-radius', 'background', 'color']) {
        assert.match(regra, new RegExp(`${propriedade}:[^;]*!important`), `${propriedade} sem !important perde para a base`);
    }
    assert.match(regra, /width: 58px !important/, 'largura fixa: a base impõe 100%');
});

test('a experiência inteira fica no eixo central', () => {
    const portal = css.slice(css.indexOf('.actuar-portal {'), css.indexOf('.actuar-portal-header'));
    assert.match(portal, /display: flex; flex-direction: column; align-items: center;/);
    assert.match(css, /\.actuar-portal > \.actuar-portal-shell,\s*\n\.actuar-portal > \.actuar-portal-panel \{ margin-top: auto; margin-bottom: auto; \}/);
    assert.match(css, /\.actuar-portal-shell \{\s*\n\s*width: min\(480px, 100%\);/, 'o acesso é um card único e centralizado');
    assert.match(css, /\.actuar-portal-panel \{\s*\n\s*width: min\(680px, 100%\);/);
    assert.match(css, /\.actuar-otp \{ display: flex; justify-content: center;/);

    // O painel lateral saiu: virava peso morto no celular e desalinhava o desktop.
    assert.doesNotMatch(html, /actuar-portal-brand/);
    assert.doesNotMatch(css, /\.actuar-portal-brand/);
});

test('a linha de ações tem só voltar e avançar', () => {
    const acoes = bloco('<div class="actuar-portal-actions">', '</div>');
    assert.doesNotMatch(acoes, /<p /, 'texto no meio dos botões é ruído; o passo já é dito no topo');
    assert.match(acoes, /id="portalBackButton"/);
    assert.match(acoes, /id="portalNextButton"/);
    assert.match(acoes, /id="portalSubmitButton"/);
    assert.match(css, /\.actuar-portal-actions #portalBackButton \{ margin-right: auto; \}/,
        'voltar fica na esquerda, avançar na direita');

    // A nota só aparece onde significa algo: no passo do envio.
    const render = bloco('function portalRenderStep()', 'function portalRenderRecap()');
    assert.match(render, /portalStepNote'\)\?\.classList\.toggle\('hidden', !ultimo\)/);
    assert.doesNotMatch(render, /Passo \$\{portalStep\} de/, 'o contador duplicava o indicador do topo');
});

/* Completar os quatro dígitos JÁ é a intenção de entrar. Um botão depois disso pede que a
   pessoa confirme o que acabou de dizer. */

test('o acesso não tem botão: o PIN completo entra', () => {
    assert.doesNotMatch(html, /portalEnterButton/, 'o botão de acessar não deve voltar');
    const acesso = bloco('id="portalAccess"', '<!-- ETAPA 2');
    assert.doesNotMatch(acesso, /<button/, 'a tela de acesso não tem botão nenhum');
    assert.match(acesso, /O acesso é liberado assim que os quatro dígitos estiverem corretos\./,
        'sem botão, a tela precisa dizer como se entra');

    // E errar continua zerando para tentar de novo ali mesmo.
    const entrada = bloco('function portalEnter(event)', 'function portalSignOut()');
    assert.match(entrada, /portalPinClear\(\);/);
    assert.match(entrada, /classList\.add\('is-invalid'\)/);
});

test('a identidade precisa ser escolhida, nunca herdada do padrão', () => {
    /* Sem botão, o PIN completo entra na hora. Com um nome já selecionado por padrão, a
       pessoa entraria como o primeiro da lista sem perceber. */
    const monta = bloco("if (select && !select.options.length)", 'const identificado');
    assert.match(monta, /<option value="">Selecione o seu nome<\/option>/);
    assert.match(monta, /select\.addEventListener\('change'[\s\S]*portalPinBox\(1\)\?\.focus\(\)/,
        'escolhido o nome, o foco vai para o PIN');

    const entrada = bloco('function portalEnter(event)', 'function portalSignOut()');
    assert.match(entrada, /Selecione o seu nome na lista antes de informar o PIN\./);
    assert.match(entrada, /portalCollaborator'\)\?\.focus\(\)/, 'o foco volta para o que falta');
});

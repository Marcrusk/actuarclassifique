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

test('a área vem de lista fechada, sem texto livre', () => {
    /* Quem registra é a ÁREA, não a pessoa. O PIN é compartilhado: dizer "João Almeida"
       dava uma certeza que o acesso não sustenta. A área é o que o acesso comprova e o que
       a gestão precisa para triar e medir de onde vem a demanda. */
    const lista = bloco('const PORTAL_DEPARTMENTS = [', '];');
    for (const area of ['Comercial', 'Administrativo', 'Retenção', 'Financeiro', 'Implantação']) {
        assert.ok(lista.includes(`name: '${area}'`), `área ausente: ${area}`);
    }
    assert.match(html, /<input type="hidden" id="portalCollaborator" value="">/);
    const picker = bloco('<div class="actuar-picker">', '</ul>');
    assert.match(picker, /role="listbox"/);
    assert.doesNotMatch(picker, /<input(?! type="hidden")/, 'área digitada abriria a porta para qualquer um');

    // Inativa não aparece na porta.
    const filtro = bloco('function portalDepartments()', 'function portalDepartment(');
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
    /* "Empresa do cliente" dizia a coisa errada: não é a empresa DELE, é de qual marca ele
       é cliente. Com quatro valores fixos, opções à vista batem um select. */
    const marcas = bloco('id="portalBrandLabel"', '</div>');
    for (const marca of ['Actuar', 'Ediz', 'Toletus', 'Fácil Fit']) {
        assert.ok(marcas.includes(`data-brand="${marca}"`), `marca ausente: ${marca}`);
    }
    assert.match(html, /<span class="actuar-field-label" id="portalBrandLabel">Cliente de qual marca\?<\/span>/);
    assert.doesNotMatch(html, /Empresa do cliente/);
    assert.doesNotMatch(html, /<select id="portalBrand"/);
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
    /* check() recebe UM input; passar a seção devolvia sempre válido, e telefone incompleto
       atravessava para o passo seguinte. validateScope é quem varre um escopo. */
    assert.match(valida, /ActuarFields\?\.validateScope/);
    assert.doesNotMatch(valida, /ActuarFields\?\.check\(escopo\)/);
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
    // (não confundir com .actuar-portal-brand-option, que são as marcas do cliente)
    assert.doesNotMatch(html, /class="actuar-portal-brand"/);
    assert.doesNotMatch(css, /\.actuar-portal-brand \{/);
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
    /* Recorta o FORMULÁRIO do PIN, não a tela inteira: a tela ganhou uma segunda porta,
       para quem acompanha as solicitações da própria área, e essa tem botão — ela pede
       senha, e senha não tem tamanho fixo que sirva de sinal de "terminei". */
    const acesso = bloco('<form onsubmit="return portalEnter(event)"', '</form>');
    assert.doesNotMatch(acesso, /type="submit"/, 'o formulário do PIN não tem botão de enviar');
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
    // O gatilho começa sem ninguém: escolher é um ato, não uma herança do primeiro da lista.
    assert.match(html, /<strong id="portalMemberName">Qual área está registrando\?<\/strong>/);
    assert.match(html, /<input type="hidden" id="portalCollaborator" value="">/);
    const escolhe = bloco('function portalPickMember(id)', 'function portalMemberKey(');
    assert.match(escolhe, /portalPinBox\(1\)\?\.focus\(\)/, 'escolhido o nome, o foco vai para o PIN');

    const entrada = bloco('function portalEnter(event)', 'function portalSignOut()');
    assert.match(entrada, /Selecione a sua área antes de informar o PIN\./);
    assert.match(entrada, /portalMemberTrigger'\)\?\.focus\(\)/, 'o foco volta para o que falta');
});

test('a marca vive dentro do card do acesso, no nível do portão dos analistas', () => {
    /* Antes a logo e o selo ficavam numa faixa solta acima do card. Quem abre o link precisa
       ver identidade e nome do ambiente no mesmo bloco em que se identifica. */
    const acesso = bloco('id="portalAccess"', '<!-- ETAPA 2');
    assert.match(acesso, /<div class="actuar-portal-crest">[\s\S]*actuar-group\.svg[\s\S]*Portal de Prioridades[\s\S]*<\/div>/);

    // Mesmo acabamento do portão: bloco da marca em primário, logo em branco, sombra profunda.
    assert.match(css, /\.actuar-portal-crest \{[\s\S]*background: var\(--actuar-primary\);/);
    assert.match(css, /\.actuar-portal-crest img \{ width: 152px;[^}]*filter: brightness\(0\) invert\(1\); \}/);

    /* Logo e nome lado a lado, separados por um filete — a mesma construção do cabeçalho do
       produto. Empilhados, os dois competiam pelo topo do card. */
    assert.match(css, /\.actuar-portal-crest \{\s*\n\s*display: flex; align-items: center; justify-content: center;/);
    assert.match(css, /\.actuar-portal-crest \.actuar-portal-tag \{[\s\S]*border-left: 1px solid rgba\(255, 255, 255, \.34\);/);
    assert.match(css, /\.actuar-portal-shell \{[\s\S]*?box-shadow:[\s\S]*?0 32px 80px/);

    // A faixa do topo só aparece depois de identificado, onde mora o "Encerrar acesso".
    assert.match(html, /<header class="actuar-portal-header hidden" id="portalHeader">/);
    const render = bloco('function renderPortal()', 'function portalEnter(');
    assert.match(render, /portalHeader'\)\?\.classList\.toggle\('hidden', !identificado\)/);
});

/* O <select> nativo entrega o visual do sistema operacional — fundo claro, seta do sistema —
   e quebra a atmosfera do portal. O seletor próprio é do produto, e continua sendo um
   listbox de verdade para quem navega por teclado. */

test('o seletor de quem registra é do produto, e acessível', () => {
    const picker = bloco('<div class="actuar-picker">', '</ul>');
    assert.match(picker, /aria-haspopup="listbox"/);
    assert.match(picker, /aria-expanded="false"/);
    assert.match(picker, /aria-controls="portalMemberPanel"/);
    assert.match(picker, /role="listbox"/);
    assert.doesNotMatch(html, /<select id="portalCollaborator"/, 'o select nativo não deve voltar');

    // Cada opção se anuncia como opção, com estado.
    const monta = bloco('function portalRenderMembers()', 'function portalMembersOpen()');
    assert.match(monta, /role="option"/);
    // O estado sai do que está escolhido, não de um valor fixo: reabrir mostra a marca certa.
    assert.match(monta, /aria-selected="\$\{item\.id === escolhido\}"/);
    assert.match(monta, /item\.icon/, 'cada área tem um ícone que ajuda a reconhecer de relance');
    assert.match(monta, /item\.name/);
});

test('o teclado navega a lista como um listbox de verdade', () => {
    const tecla = bloco('function portalMemberKey(event, indice)', 'function portalMemberTriggerKey(');
    assert.match(tecla, /event\.key === 'Enter' \|\| event\.key === ' '/, 'Enter e espaço escolhem');
    assert.match(tecla, /event\.key === 'Escape'/, 'Esc fecha');
    assert.match(tecla, /ArrowDown[\s\S]*ArrowUp/);
    assert.match(tecla, /\(indice \+ passo \+ itens\.length\) % itens\.length/, 'a lista dá a volta');

    const gatilho = bloco('function portalMemberTriggerKey(event)', 'document.addEventListener');
    assert.match(gatilho, /\['ArrowDown', 'Enter', ' '\]/, 'o gatilho abre pelo teclado');

    // Lista aberta e esquecida atrapalha o resto do formulário.
    assert.match(html, /portalMembersOpen\(\) && !event\.target\.closest\('\.actuar-picker'\)/);
});

test('o seletor não deixa rótulo solto nem estado ambíguo', () => {
    // O rótulo "Colaborador" saiu: o próprio gatilho pergunta quem está registrando.
    assert.doesNotMatch(html, /<label for="portalCollaborator">/);
    assert.match(css, /\.actuar-picker-trigger:not\(\.is-filled\) \.actuar-picker-copy strong/,
        'vazio e preenchido precisam parecer diferentes');
    assert.match(css, /\.actuar-picker-list li\[aria-selected="true"\] \.actuar-picker-tick \{ opacity: 1; \}/);
});

/* Preto chapado achata a tela e faz o card flutuar sem chão. O fundo ganha profundidade,
   mas continua sendo atmosfera: não recebe clique, não é lido e não compete com o card. */

test('o fundo tem vida própria, sem repetir a marca como papel de parede', () => {
    const backdrop = bloco('<div class="actuar-portal-backdrop"', '</div>');
    assert.equal((backdrop.match(/actuar-portal-aurora--/g) || []).length, 3);
    assert.match(backdrop, /actuar-portal-mesh/);
    assert.match(backdrop, /aria-hidden="true"/, 'atmosfera não é conteúdo');
    // A marca já está dentro do card; repeti-la no fundo virava papel de parede.
    assert.doesNotMatch(backdrop, /actuar-group\.svg/);
    assert.doesNotMatch(css, /\.actuar-portal-watermark/);

    // Ciclos longos e dessincronizados: o fundo nunca repete a mesma composição.
    const duracoes = [...css.matchAll(/animation: aurora\w+ (\d+)s/g)].map(m => Number(m[1]));
    assert.deepEqual(duracoes, [26, 32, 38]);
    assert.equal(new Set(duracoes).size, 3, 'durações iguais sincronizariam o movimento');
    assert.ok(duracoes.every(d => d >= 20), 'movimento rápido no fundo vira distração');
});

test('a camada decorativa fica atrás e não intercepta clique', () => {
    assert.match(css, /\.actuar-portal-backdrop \{ position: absolute; inset: 0; z-index: -1; pointer-events: none;/);
    assert.match(css, /\.actuar-portal \{\s*\n\s*position: relative; isolation: isolate;/,
        'sem isolation o z-index negativo escaparia do contexto');
    assert.match(css, /\.actuar-portal \{[\s\S]*overflow: hidden;/, 'os halos não podem gerar rolagem');
});

test('o card se sustenta sobre o fundo novo', () => {
    // Sobre halos, um card chapado se dissolve: precisa de superfície própria e chão.
    const shell = css.slice(css.indexOf('.actuar-portal-shell {'), css.indexOf('.actuar-portal-crest'));
    assert.match(shell, /background: linear-gradient\(180deg, #232330 0%, #1A1A21 100%\)/);
    assert.match(shell, /box-shadow:[\s\S]*inset 0 1px 0 rgba\(255, 255, 255, \.07\)/, 'o brilho no topo dá relevo');
    assert.match(shell, /0 32px 80px rgba\(5, 6, 10, \.62\)/);
});

test('a atmosfera recua onde atrapalharia', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 860px)', css.indexOf('.actuar-portal-aurora')));
    assert.match(mobile, /\.actuar-portal-aurora--three \{ display: none; \}/, 'no celular sobra pouca área livre');
    assert.match(mobile, /\.actuar-portal-aurora \{ filter: blur\(70px\); \}/, 'blur menor alivia GPU fraca');
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.actuar-portal-aurora \{ animation: none; \}/);
});

test('a lista de nomes expande no fluxo, sem ser recortada pelo card', () => {
    /* O card precisa de overflow: hidden para arredondar o bloco da marca. Uma lista
       flutuando por cima era recortada por ele, e a rolagem ficava presa num pedaço. */
    const painel = css.slice(css.indexOf('.actuar-picker-panel {'), css.indexOf('.actuar-picker-search {'));
    assert.doesNotMatch(painel, /position: absolute/, 'flutuar dentro de um card recortado esconde nomes');
    const lista = css.slice(css.indexOf('.actuar-picker-list {'), css.indexOf('.actuar-picker-list::-webkit-scrollbar'));
    assert.match(lista, /max-height: 264px; overflow-y: auto/, 'com muitos nomes, a lista rola por dentro');
    assert.match(css, /\.actuar-picker-list::-webkit-scrollbar-thumb/, 'a barra precisa dizer que há mais abaixo');
});

/* Com 300 pessoas na empresa, uma lista completa é inútil: ninguém rola até achar o próprio
   nome. Digitar duas letras resolve em um gesto. */

test('cinco áreas não pedem campo de busca', () => {
    // A busca existia para 300 pessoas. Com cinco opções à vista, ela vira ruído.
    assert.doesNotMatch(html, /portalMemberSearch|portalFilterMembers/);
    const painel = bloco('<div id="portalMemberPanel"', '</ul>');
    assert.doesNotMatch(painel, /<input/);
    assert.match(painel, /role="listbox"/);
});


test('o teclado navega a lista sem sair do componente', () => {
    const listaKey = bloco('function portalMemberKey(event, indice)', 'function portalMemberTriggerKey(');
    assert.match(listaKey, /event\.key === 'Enter' \|\| event\.key === ' '/, 'Enter e espaço escolhem');
    assert.match(listaKey, /event\.key === 'Escape'/, 'Esc fecha');
    assert.match(listaKey, /\(indice \+ passo \+ itens\.length\) % itens\.length/, 'a lista dá a volta');
    const gatilho = bloco('function portalMemberTriggerKey(event)', 'document.addEventListener');
    assert.match(gatilho, /\['ArrowDown', 'Enter', ' '\]/);
});

/* Um seletor livre de "urgência" faz todo mundo marcar urgente — e não por má-fé: falta
   referência. Respondendo fatos verificáveis, a prioridade deixa de ser opinião. */

test('as marcas aparecem por logo, no mesmo peso óptico', () => {
    /* "Empresa do cliente" já era o termo errado; o nome escrito também não é como a pessoa
       reconhece a marca. As quatro proporções são muito diferentes (Toletus é 6:1, Ediz
       2,4:1), então a normalização é por altura com `contain` — nenhuma é esticada. */
    const marcas = bloco('id="portalBrandLabel"', '</div>');
    for (const [marca, arquivo] of [['Actuar', 'actuar'], ['Ediz', 'ediz'], ['Toletus', 'toletus'], ['Fácil Fit', 'facil-fit']]) {
        assert.ok(marcas.includes(`data-brand="${marca}"`), `marca ausente: ${marca}`);
        assert.ok(marcas.includes(`logos/marcas/${arquivo}.png`), `logo ausente: ${arquivo}`);
        assert.ok(marcas.includes(`alt="${marca}"`), `a logo de ${marca} precisa de alternativo`);
    }
    assert.match(css, /\.actuar-portal-brand-option img \{[\s\S]*max-height: 26px;[\s\S]*object-fit: contain;/);

    // A da Ediz vem em preto sobre branco: invertida e em screen, o fundo some por completo.
    assert.match(css, /img\.is-boxed \{ filter: invert\(1\); mix-blend-mode: screen;/);
});

test('nenhuma função do portal usa variável que não declarou', () => {
    /* Regressão real: ao trocar pessoa por área, a declaração virou `area` e o corpo ficou
       com `pessoa`. O ReferenceError matava o handler em silêncio — o PIN correto não dava
       ação nenhuma, sem erro na tela. Sintaxe válida não pega isso; o lint só valida sintaxe. */
    function corpo(nome) {
        const i = html.indexOf(`function ${nome}(`);
        assert.ok(i > -1, `${nome} precisa existir`);
        let j = html.indexOf('{', i), n = 0;
        for (; j < html.length; j++) {
            if (html[j] === '{') n++;
            else if (html[j] === '}') { n--; if (!n) return html.slice(i, j + 1); }
        }
        return '';
    }
    const locais = ['area', 'pessoa', 'sugestao', 'registro', 'protocolo', 'dados'];
    for (const nome of ['portalEnter', 'portalSubmit', 'portalPickMember', 'renderPortal', 'portalShowSuccess', 'portalTryEnter', 'portalSignOut']) {
        const bloco = corpo(nome);
        for (const variavel of locais) {
            const usa = new RegExp(`(?<![\\w.'"])${variavel}(?![\\w'"])`).test(bloco.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ''));
            if (!usa) continue;
            const declara = new RegExp(`(?:const|let|var)\\s+(?:\\{[^}]*\\}|${variavel})\\s*=`).test(bloco)
                || new RegExp(`function ${nome}\\([^)]*\\b${variavel}\\b`).test(bloco);
            assert.ok(declara, `${nome} usa "${variavel}" sem declarar`);
        }
    }
});

test('sem área escolhida, o PIN não é julgado', () => {
    const entrada = bloco('function portalEnter(event)', 'function portalSignOut()');
    assert.match(entrada, /if \(!area\)/);
    assert.match(entrada, /Selecione a sua área antes de informar o PIN\./);
    assert.match(entrada, /portalMemberTrigger'\)\?\.focus\(\)/, 'o foco volta para o que falta');
    assert.match(entrada, /portalSession = \{ id: area\.id/);
});

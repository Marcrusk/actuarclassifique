const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fields = require('../js/actuar-fields.js');
const pieces = require('../js/pieces-operations.js');

test('máscaras formatam progressivamente, sem exigir entrada completa', () => {
    assert.equal(fields.formatCnpj(''), '');
    assert.equal(fields.formatCnpj('11'), '11');
    assert.equal(fields.formatCnpj('11222'), '11.222');
    assert.equal(fields.formatCnpj('11222333000181'), '11.222.333/0001-81');
    assert.equal(fields.formatCnpj('11.222.333/0001-8199999'), '11.222.333/0001-81');

    assert.equal(fields.formatPhone('62'), '(62');
    assert.equal(fields.formatPhone('6299'), '(62) 99');
    assert.equal(fields.formatPhone('6232223344'), '(62) 3222-3344');
    assert.equal(fields.formatPhone('62999998888'), '(62) 99999-8888');

    assert.equal(fields.formatCep('74000000'), '74000-000');
    assert.equal(fields.formatCpf('52998224725'), '529.982.247-25');
});

test('ID do cliente aceita duas letras e quatro números, normalizando a digitação', () => {
    assert.equal(fields.formatClientId('tz2345'), 'TZ2345');
    assert.equal(fields.formatClientId('tz-2345'), 'TZ2345');
    assert.equal(fields.formatClientId('km 7552 99'), 'KM7552');
    assert.equal(fields.formatClientId('1a2b3c'), 'AB23');
    assert.ok(fields.isValidClientId('TZ2345'));
    assert.ok(!fields.isValidClientId('T2345'));
    assert.ok(!fields.isValidClientId('TZ234'));
    assert.ok(!fields.isValidClientId('TZA345'));
});

test('CNPJ e CPF são conferidos pelos dígitos verificadores', () => {
    assert.ok(fields.isValidCnpj('11.222.333/0001-81'));
    assert.ok(!fields.isValidCnpj('11.222.333/0001-82'));
    assert.ok(!fields.isValidCnpj('11.111.111/1111-11'), 'sequência repetida não é CNPJ válido');
    assert.ok(!fields.isValidCnpj('112223330001'), 'menos de 14 dígitos');
    assert.ok(fields.isValidCpf('529.982.247-25'));
    assert.ok(!fields.isValidCpf('529.982.247-26'));
});

test('UF, e-mail e telefone rejeitam entradas que passariam por um campo livre', () => {
    assert.ok(fields.isValidUf('go'));
    assert.ok(!fields.isValidUf('XX'));
    assert.equal(fields.formatUf('goiás'), 'GO');

    assert.ok(fields.isValidEmail(' Joao@Actuar.COM.br '));
    assert.ok(!fields.isValidEmail('joao.actuar.com.br'), 'sem @');
    assert.ok(!fields.isValidEmail('joao@actuar'), 'sem domínio');

    assert.ok(fields.isValidPhone('(62) 99999-8888'));
    assert.ok(fields.isValidPhone('(62) 3222-3344'));
    assert.ok(!fields.isValidPhone('(20) 99999-8888'), 'DDD inexistente');
    assert.ok(!fields.isValidPhone('(62) 89999-8888'), 'celular precisa começar com 9');
    assert.ok(!fields.isValidPhone('999998888'), 'sem DDD');
});

test('validate distingue campo vazio opcional de campo obrigatório e devolve o valor já formatado', () => {
    assert.deepEqual(fields.validate('cnpj', ''), { valid: true, value: '', message: '' });
    assert.equal(fields.validate('clientId', '', { required: true }).valid, false);
    assert.equal(fields.validate('clientId', 'tz2345').value, 'TZ2345');
    assert.equal(fields.validate('cnpj', '11222333000199').valid, false);
    assert.match(fields.validate('cnpj', '11222333000199').message, /dígitos verificadores/);
    assert.equal(fields.validate('phone', '62999998888').value, '(62) 99999-8888');
});

test('o envio da solicitação aplica as mesmas regras dos campos', () => {
    const base = () => pieces.createDraft({
        sourceTicket: '45353', analystId: 'lucas', targetManagerId: 'gestor', movement: 'Envio', reason: 'Outro',
        client: { brand: 'Actuar', id: 'KM7552', name: 'Academia Modelo' },
        products: [{ name: 'Placa', quantity: 1 }], description: 'Troca'
    }, 'lucas', 1000);

    assert.deepEqual(pieces.pendingRequirements(base()), []);

    const invalido = campo => {
        const draft = base(); Object.assign(draft.client, campo);
        return pieces.pendingRequirements(draft).map(item => item.field);
    };
    assert.ok(invalido({ id: 'K7552' }).includes('client.id'));
    assert.ok(invalido({ personType: 'Jurídica', document: '11.222.333/0001-99' }).includes('client.document'));
    assert.ok(invalido({ personType: 'Física', document: '529.982.247-26' }).includes('client.document'));
    assert.ok(invalido({ state: 'XX' }).includes('client.state'));
    assert.ok(invalido({ phone: '(20) 99999-8888' }).includes('client.phone'));
    assert.ok(invalido({ email: 'joao@actuar' }).includes('client.email'));

    // campos opcionais em branco continuam livres
    assert.deepEqual(invalido({ document: '', state: '', phone: '', email: '' }), []);
    assert.throws(() => pieces.submit(Object.assign(base(), { client: { ...base().client, id: 'K7552' } }), 'lucas', 1), /duas letras e quatro números/);
});

test('os campos do cadastro estão marcados para máscara e o módulo é carregado antes de quem depende dele', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    for (const type of ['clientId', 'uf', 'phone', 'email']) assert.ok(ui.includes(`data-field="${type}"`), `campo ${type} sem máscara`);
    // O documento do cliente alterna entre CPF e CNPJ conforme o tipo de pessoa.
    assert.match(ui, /data-field="\$\{domain\(\)\.documentTypeOf\(draft\.client\)\}"/);
    assert.match(ui, /bindFields\(body\)/);
    assert.match(ui, /const fieldCheck = checkFields/);
    assert.ok(html.indexOf('js/actuar-fields.js') < html.indexOf('js/pieces-operations.js'), 'actuar-fields.js precisa carregar antes');
    assert.match(css, /\.actuar-field\.has-error > input/);
});

test('digitar caractere a caractere não embaralha o valor: o cursor ignora os separadores da máscara', () => {
    // Regressão: quando o cálculo do cursor contava "." e "-" como digitação do usuário,
    // 11222333000181 virava 11.223.300/0181-32 na tela.
    const digitar = (type, teclas) => {
        let valor = ''; let cursor = 0; const keep = fields.keepOf(type);
        for (const tecla of teclas.split('')) {
            valor = valor.slice(0, cursor) + tecla + valor.slice(cursor); cursor += 1;
            const proximo = fields.format(type, valor);
            if (proximo === valor) continue;
            const mantidos = fields.keptCount(valor.slice(0, cursor), keep);
            valor = proximo; cursor = fields.caretFor(proximo, mantidos, keep);
        }
        return valor;
    };

    assert.equal(digitar('cnpj', '11222333000181'), '11.222.333/0001-81');
    assert.equal(digitar('cpf', '52998224725'), '529.982.247-25');
    assert.equal(digitar('phone', '62999998888'), '(62) 99999-8888');
    assert.equal(digitar('phone', '6232223344'), '(62) 3222-3344');
    assert.equal(digitar('cep', '74000000'), '74000-000');
    assert.equal(digitar('clientId', 'tz2345'), 'TZ2345');
    assert.equal(digitar('email', 'joao@actuar.com.br'), 'joao@actuar.com.br');
});

test('a toolbar decide acessos e escopo de filtro num lugar só', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    assert.match(html, /function syncAccessControls\(\)/);
    // Departamento e Analista continuam sendo ferramenta de gestão, mas agora também
    // dependem da tela: filtro por analista numa tela de cadastro não filtra nada.
    assert.match(html, /const contexto = isAdminLoggedIn && escopo\.contexto;/);
    assert.match(html, /show\('filterContextGroup', contexto\)/);
    assert.match(html, /id="filterContextGroup"/);

    // Dentro de uma sessão nenhuma porta de entrada continua na tela.
    for (const botao of ['btnAnalystAccess', 'btnPecaAccess', 'btnAdminAccess']) {
        assert.match(html, new RegExp(`show\\('${botao}', semSessao\\)`), `${botao} deveria sumir dentro da sessão`);
    }
    // A saída não fica na toolbar: vive no menu da foto do usuário.
    for (const botao of ['btnAnalystLogout', 'btnPecaLogout', 'btnAdminLogout']) {
        assert.ok(!html.includes(botao), `${botao} voltou para a toolbar; a saída é o menu do perfil`);
    }
    assert.match(html, /document\.querySelector\('\.actuar-access-actions'\)\?\.classList\.toggle\('hidden', !semSessao\)/);

    // E o menu do perfil precisa encerrar as três sessões de verdade.
    const inicio = html.indexOf('function signOutProfile()');
    assert.ok(inicio > 0, 'signOutProfile não encontrado');
    const sair = html.slice(inicio, html.indexOf('\n        function ', inicio + 10));
    assert.match(sair, /if \(isAdminLoggedIn\) \{\s*logoutAdmin\(\);/);
    assert.match(sair, /if \(isPecaLoggedIn\) \{\s*logoutPeca\(\);/);
    assert.match(sair, /if \(isAnalystLoggedIn\) \{ logoutAnalyst\(\);/, 'sessão de analista precisa ser encerrada, não só reposicionada');

    // Regressão: a visibilidade vivia duplicada em quatro ramos do render(), com regras divergentes.
    const espalhado = html.match(/getElementById\('btn(Analyst|Peca|Admin)(Access|Logout)'\)\.classList/g) || [];
    assert.equal(espalhado.length, 0, `visibilidade de acesso voltou a ficar espalhada: ${espalhado.length} ocorrência(s)`);
});

test('a Logística fatura, o Lab embala: cada perfil só enxerga a etapa que é dele', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    const inicio = ui.indexOf('    function operatorCan(area) {');
    assert.ok(inicio > 0, 'operatorCan não encontrado');
    const corpo = ui.slice(inicio, ui.indexOf('\n    }', inicio) + 6);
    const permissao = new Function('currentContext', 'LAB_ROLE', `${corpo}\nreturn operatorCan;`);
    const podeComo = (role) => permissao(() => ({ user: { role } }), 'Toletus Lab');

    // A Sarah lança a nota e o rastreio; depois disso o chamado sai da fila dela.
    const logistica = podeComo('Logística/Faturamento');
    assert.equal(logistica('Faturamento'), true);
    assert.equal(logistica('Expedição'), false, 'a Logística voltou a poder embalar');

    // O Lab embala, posta e acompanha até a conclusão, mas não emite nota.
    const lab = podeComo('Toletus Lab');
    assert.equal(lab('Expedição'), true);
    assert.equal(lab('Faturamento'), false);

    // Envio/Coleta segue restrito à expedição e o analista comum não é operador.
    assert.equal(podeComo('Envio/Coleta')('Expedição'), true);
    assert.equal(podeComo('Envio/Coleta')('Faturamento'), false);
    assert.equal(podeComo('Analista')('Expedição'), true);

    // E a fila da Logística filtra pela área da próxima ação, senão o chamado ficaria parado lá.
    assert.match(ui, /operatorCan\('Faturamento'\) && domain\(\)\.nextAction\(row\)\.area === 'Logística\/Faturamento'/);
});

test('digitar na busca não perde o foco nem o cursor, e a lupa não invade o texto', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // Cada tecla redesenhava o módulo por innerHTML: o input morria, o foco caía e
    // só a primeira letra entrava. A digitação agora agenda o redesenho...
    const filtro = ui.slice(ui.indexOf('    function updateFilter(key, value) {'));
    const corpo = filtro.slice(0, filtro.indexOf('\n    }') + 6);
    assert.match(corpo, /setTimeout\(\(\) => \{ filterTimer = null; renderPiecesModule\(\); \}, \d+\)/);
    assert.match(corpo, /if \(!TYPED_FILTERS\.includes\(key\)\) \{ renderPiecesModule\(\); return; \}/);

    // ...e o redesenho devolve foco e posição do cursor.
    assert.match(ui, /const focoId = focado && mount\.contains\(focado\) \? focado\.id : null;/);
    assert.match(ui, /devolvido\.focus\(\{ preventScroll: true \}\)/);
    assert.match(ui, /devolvido\.setSelectionRange\(selecao\[0\], selecao\[1\]\)/);

    // A lupa e o botão do olho só ficam fora do texto se o recuo ganhar da base do
    // design system, que é !important e tem especificidade (0,4,2). Regra curta como
    // `.pieces-search-control input { padding-left }` perde e o ícone volta por cima.
    const cadeia = ':not([type="checkbox"]):not([type="radio"]):not([type="file"])';
    for (const seletor of ['.actuar-input-icon > input', '.pieces-search-control > input', '.actuar-field-with-action > input']) {
        assert.ok(css.includes(`body.actuar-app ${seletor}${cadeia}`), `${seletor} sem a cadeia de :not(); o recuo vai perder para a base`);
    }
    assert.ok(!/\.pieces-search-control input\s*\{/.test(css), 'voltou a regra fraca de .pieces-search-control input');
    assert.ok(!/\.actuar-field-with-action input\s*\{/.test(css), 'voltou a regra fraca de .actuar-field-with-action input');
});

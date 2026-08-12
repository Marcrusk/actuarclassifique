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
    assert.ok(invalido({ document: '11.222.333/0001-99' }).includes('client.document'));
    // Cliente pessoa física valida CPF no mesmo campo de documento.
    assert.ok(invalido({ personType: 'Física', document: '111.222.333-99' }).includes('client.document'));
    assert.deepEqual(invalido({ personType: 'Física', document: '529.982.247-25' }), []);
    assert.deepEqual(invalido({ personType: 'Jurídica', document: '11.222.333/0001-81' }), []);
    assert.ok(invalido({ state: 'XX' }).includes('client.state'));
    assert.ok(invalido({ phone: '(20) 99999-8888' }).includes('client.phone'));
    assert.ok(invalido({ email: 'joao@actuar' }).includes('client.email'));

    // campos opcionais em branco continuam livres
    assert.deepEqual(invalido({ document: '', state: '', phone: '', email: '' }), []);
    assert.throws(() => pieces.submit(Object.assign(base(), { client: { ...base().client, id: 'K7552' } }), 'lucas', 1), /duas letras e quatro números/);
});

test('os campos do cadastro estão marcados para máscara e o módulo é carregado antes de quem depende dele', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    const ops = fs.readFileSync('js/pieces-operations.js', 'utf8');
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    for (const type of ['clientId', 'uf', 'phone', 'email']) assert.ok(ui.includes(`data-field="${type}"`), `campo ${type} sem máscara`);
    // O documento alterna a máscara entre CNPJ e CPF conforme o tipo de cliente.
    assert.match(ui, /data-field="\$\{domain\(\)\.documentTypeOf\(draft\.client\)\}"/);
    assert.match(ops, /function documentTypeOf\(client\) \{ return personTypeOf\(client\) === 'Física' \? 'cpf' : 'cnpj'; \}/);
    for (const type of ['cnpj', 'cpf']) assert.ok(fields.TYPES[type], `tipo ${type} ausente no ActuarFields`);
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

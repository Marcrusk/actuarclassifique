const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

/* O header é um grid, e cada filho ocupa uma coluna. Quando o #navToggle entrou como
   primeiro filho sem que o grid crescesse, as ações transbordaram para uma segunda linha:
   o avatar do usuário saía do canto superior direito e reaparecia embaixo, à esquerda. */

function headerChildren() {
    const inicio = html.indexOf('<header id="globalHeader"');
    const fim = html.indexOf('</header>', inicio);
    assert.ok(inicio > -1 && fim > inicio, 'o shell do header precisa continuar no index.html');
    const marcacao = html.slice(inicio, fim);
    // Filhos diretos: contamos as aberturas de tag no nível do header.
    return ['id="navToggle"', 'class="actuar-brand"', 'id="headerContext"', 'class="actuar-header-actions"']
        .filter(marca => marcacao.includes(marca));
}

function colunas(regra) {
    const match = css.match(regra);
    assert.ok(match, `regra não encontrada: ${regra}`);
    return match[1].trim().split(/\s+(?![^(]*\))/).length;
}

test('o avatar do usuário vive dentro das ações do header, à direita', () => {
    const inicio = html.indexOf('<div class="actuar-header-actions">');
    const fim = html.indexOf('</header>', inicio);
    const acoes = html.slice(inicio, fim);
    assert.match(acoes, /id="profileMenuButton"/);
    assert.match(acoes, /id="headerProfileAvatar"/);

    // E as ações são o último filho: nada pode ser inserido depois sem revisar o grid.
    const marcacao = html.slice(html.indexOf('<header id="globalHeader"'), fim);
    assert.ok(marcacao.lastIndexOf('actuar-header-actions') > marcacao.lastIndexOf('id="headerContext"'));
});

test('o grid do header tem uma coluna para cada filho', () => {
    const filhos = headerChildren();
    assert.equal(filhos.length, 4, 'esperava menu, marca, contexto e ações');
    const declaradas = colunas(/\.actuar-global-header \{[\s\S]*?grid-template-columns:([^;]+);/);
    assert.equal(declaradas, filhos.length,
        'coluna a menos joga as ações para a linha de baixo, e o avatar vai parar à esquerda');
});

test('no celular o contexto some, e o grid acompanha com três colunas', () => {
    assert.match(css, /\.actuar-header-context \{ display: none; \}/, 'o contexto é ocultado no mobile');
    const mobile = css.match(/@media \(max-width: 768px\)[\s\S]*?\.actuar-global-header \{[^}]*grid-template-columns:([^;]+);/);
    assert.ok(mobile, 'o header precisa continuar com regra própria no mobile');
    assert.equal(mobile[1].trim().split(/\s+(?![^(]*\))/).length, 3, 'menu, marca e ações');
    assert.match(css, /\.actuar-header-actions \{ justify-self: end;/, 'e continuam ancoradas à direita');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

/* O header é um grid e cada filho ocupa uma coluna. Quando o gatilho do menu foi colocado
   dentro dele, passaram a ser quatro elementos em três colunas: as ações transbordavam para
   uma segunda linha e o avatar do usuário aparecia embaixo, à esquerda.
   A solução adotada foi tirar o gatilho do header e dar a ele uma faixa própria
   (.actuar-nav-rail), mantendo o header com três filhos e três colunas. */

function headerMarkup() {
    const inicio = html.indexOf('<header id="globalHeader"');
    const fim = html.indexOf('</header>', inicio);
    assert.ok(inicio > -1 && fim > inicio, 'o shell do header precisa continuar no index.html');
    return html.slice(inicio, fim);
}

function colunasDeclaradas(regra) {
    const match = css.match(regra);
    assert.ok(match, `regra não encontrada: ${regra}`);
    return match[1].trim().split(/\s+(?![^(]*\))/).length;
}

test('o avatar do usuário vive nas ações do header, que são o último filho', () => {
    const header = headerMarkup();
    assert.match(header, /id="profileMenuButton"/);
    assert.match(header, /id="headerProfileAvatar"/);
    assert.ok(header.lastIndexOf('actuar-header-actions') > header.lastIndexOf('id="headerContext"'),
        'as ações precisam ser o último filho para cair na coluna da direita');
});

test('o gatilho do menu fica fora do header, na faixa própria', () => {
    const header = headerMarkup();
    assert.ok(!header.includes('id="navToggle"'),
        'o gatilho dentro do header cria um quarto filho e joga o avatar para a esquerda');
    assert.match(html, /<div class="actuar-nav-rail">[\s\S]{0,200}id="navToggle"/);
    assert.match(css, /\.actuar-nav-rail\b/);
});

test('o grid do header tem uma coluna para cada filho', () => {
    const header = headerMarkup();
    const filhos = ['class="actuar-brand"', 'id="headerContext"', 'class="actuar-header-actions"']
        .filter(marca => header.includes(marca));
    assert.equal(filhos.length, 3, 'esperava marca, trilha e ações');

    const declaradas = colunasDeclaradas(/\.actuar-global-header \{[\s\S]*?grid-template-columns:([^;]+);/);
    assert.equal(declaradas, filhos.length,
        'coluna a menos joga as ações para a linha de baixo, e o avatar vai parar à esquerda');
});

test('no celular a trilha some, e o grid acompanha com duas colunas', () => {
    assert.match(css, /\.actuar-header-context \{ display: none; \}/, 'a trilha é ocultada no mobile');
    const mobile = css.match(/@media \(max-width: 768px\)[\s\S]*?\.actuar-global-header \{[^}]*grid-template-columns:([^;]+);/);
    assert.ok(mobile, 'o header precisa continuar com regra própria no mobile');
    assert.equal(mobile[1].trim().split(/\s+(?![^(]*\))/).length, 2, 'restam marca e ações');
    assert.match(css, /\.actuar-header-actions \{ justify-self: end;/, 'e continuam ancoradas à direita');
});

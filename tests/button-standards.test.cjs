const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const piecesUi = fs.readFileSync('js/pieces-ui.js', 'utf8');
const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
const fontes = [['index.html', html], ['js/pieces-ui.js', piecesUi]];

/* Decisão tem cor fixa no sistema: aprovar é verde, reprovar é vermelho.
   Antes "Aprovar" usava o primário roxo — a mesma cor de "Salvar" e "Continuar" — então a
   cor não dizia nada sobre a consequência, e a mesma decisão aparecia diferente em cada
   tela. Este teste é o que impede a divergência de voltar. */

// Captura a classe e o rótulo de cada <button> das fontes.
function botoes(fonte) {
    return [...fonte.matchAll(/<button[^>]*class="([^"]*actuar-btn[^"]*)"[^>]*>([\s\S]{0,80}?)<\/button>/g)]
        .map(match => ({ classe: match[1], texto: match[2].replace(/<[^>]*>/g, '').replace(/\$\{[^}]*\}/g, '').trim() }));
}

const APROVAR = /^(Aprovar( prioridade)?|Validar e pontuar|Confirmar e encaminhar)$/;
const REPROVAR = /^(Reprovar|Não aprovar)$/;

test('a variante de sucesso existe no Design System, por token', () => {
    assert.match(css, /\.actuar-btn-success \{ background: var\(--actuar-success\)/);
    assert.match(css, /\.actuar-btn-success:hover/);
    assert.match(css, /\.actuar-btn-danger:hover/, 'as duas variantes de decisão precisam do mesmo tratamento');
    // Sem cor literal: a variante segue a paleta, inclusive no tema escuro.
    const bloco = css.slice(css.indexOf('.actuar-btn-success {'), css.indexOf('.actuar-btn-sm {'));
    const literais = (bloco.match(/#[0-9a-fA-F]{3,6}/g) || []).filter(cor => !['#FFF', '#000'].includes(cor.toUpperCase()));
    assert.deepEqual(literais, [], `cor fixa fora da paleta: ${literais.join(', ')}`);
});

test('todo botão de aprovar é verde, em qualquer tela', () => {
    const encontrados = [];
    for (const [arquivo, fonte] of fontes) {
        for (const botao of botoes(fonte)) {
            if (!APROVAR.test(botao.texto)) continue;
            encontrados.push(`${arquivo}: ${botao.texto}`);
            assert.match(botao.classe, /actuar-btn-success/, `"${botao.texto}" em ${arquivo} não está verde: ${botao.classe}`);
            assert.doesNotMatch(botao.classe, /actuar-btn-primary/, `"${botao.texto}" em ${arquivo} voltou ao primário`);
        }
    }
    assert.ok(encontrados.length >= 3, `esperava as decisões de prioridade, peças e transferência: ${encontrados.join(' | ')}`);
});

test('todo botão de reprovar é vermelho, em qualquer tela', () => {
    const encontrados = [];
    for (const [arquivo, fonte] of fontes) {
        for (const botao of botoes(fonte)) {
            if (!REPROVAR.test(botao.texto)) continue;
            encontrados.push(`${arquivo}: ${botao.texto}`);
            assert.match(botao.classe, /actuar-btn-danger/, `"${botao.texto}" em ${arquivo} não está vermelho: ${botao.classe}`);
        }
    }
    assert.ok(encontrados.length >= 3, `esperava as reprovações de prioridade, peças e transferência: ${encontrados.join(' | ')}`);
});

test('o verde é exclusivo da decisão, para não virar mais um botão de avançar', () => {
    // Se "Salvar" ou "Continuar" ganharem verde, a cor deixa de significar aprovação.
    for (const [arquivo, fonte] of fontes) {
        for (const botao of botoes(fonte)) {
            if (!/actuar-btn-success/.test(botao.classe) || !botao.texto) continue;
            assert.match(botao.texto, APROVAR, `"${botao.texto}" em ${arquivo} usa o verde sem ser uma aprovação`);
        }
    }
});

test('a fila de transferências mostra primeiro quem espera decisão', () => {
    const linhas = html.slice(html.indexOf('function transferApprovalRows()'), html.indexOf('function populateTransferAnalystFilter()'));
    assert.match(linhas, /const ordemStatus = \{ pendente: 0, aprovado: 1, reprovado: 2 \};/);
    assert.match(linhas, /posicao\(a\) - posicao\(b\)/, 'o status ordena antes da data');
    // Entre pendentes, quem espera há mais tempo lidera; entre decididas, a mais recente.
    assert.match(linhas, /a\.status === 'pendente' \? a\.timestamp - b\.timestamp : b\.timestamp - a\.timestamp/);
    assert.match(linhas, /ordemStatus\[request\.status\] \?\? 3/, 'status desconhecido vai para o fim, não para o topo');
});

test('a ordenação da fila funciona de verdade', () => {
    // Reproduz o comparador do shell para provar a ordem final.
    const ordemStatus = { pendente: 0, aprovado: 1, reprovado: 2 };
    const posicao = request => (ordemStatus[request.status] ?? 3);
    const dados = [
        { id: 'ap-novo', status: 'aprovado', timestamp: 500 },
        { id: 'pend-antigo', status: 'pendente', timestamp: 100 },
        { id: 'rep', status: 'reprovado', timestamp: 400 },
        { id: 'pend-novo', status: 'pendente', timestamp: 300 },
        { id: 'ap-velho', status: 'aprovado', timestamp: 200 },
        { id: 'estranho', status: 'sei-la', timestamp: 999 }
    ];
    const ordenado = dados.slice().sort((a, b) => posicao(a) - posicao(b)
        || (a.status === 'pendente' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp));
    assert.deepEqual(ordenado.map(item => item.id),
        ['pend-antigo', 'pend-novo', 'ap-novo', 'ap-velho', 'rep', 'estranho']);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const manager = require('../js/manager-experience.js');

const users = {
    gestor: { name: 'Gestor', role: 'Gestor Adm', team: 'Sistema', active: true, managedTeams: ['Sistema'] },
    admin: { name: 'Admin', role: 'Gestor Adm', team: 'Sistema', active: true, allTeamsAccess: true },
    lucas: { name: 'Lucas', role: 'Analista de sistema', team: 'Sistema', active: true },
    arthur: { name: 'Arthur', role: 'Analista de sistema', team: 'Sistema', active: true },
    dyego: { name: 'Dyego', role: 'Analista de catraca', team: 'Catraca', active: true },
    coleta: { name: 'Coleta', role: 'Envio/Coleta', team: 'Catraca', active: true }
};

test('gestor acessa somente equipes explicitamente autorizadas', () => {
    assert.deepEqual(manager.authorizedTeams(users.gestor), ['Sistema']);
    assert.deepEqual(manager.authorizedTeams(users.admin), ['Sistema', 'Catraca']);
});

test('lista gerencial exclui usuários operacionais e respeita departamento', () => {
    assert.deepEqual(manager.authorizedAnalysts(users, ['Sistema']).map(item => item.id), ['lucas', 'arthur']);
    assert.deepEqual(manager.authorizedAnalysts(users, ['Catraca']).map(item => item.id), ['dyego']);
});

test('filtro de departamento limita o conjunto de analistas', () => {
    const analysts = manager.authorizedAnalysts(users, ['Sistema', 'Catraca']);
    const filters = manager.normalizeFilters({ team: 'Catraca', analyst: 'dyego' }, { authorizedTeams: ['Sistema', 'Catraca'], analysts, months: ['atual'] });
    assert.equal(filters.analyst, 'dyego');
    assert.deepEqual(manager.filterRows(analysts, filters, ['Sistema', 'Catraca']).map(row => row.id), ['dyego']);
});

test('analista de outro departamento é removido quando o departamento muda', () => {
    const analysts = manager.authorizedAnalysts(users, ['Sistema', 'Catraca']);
    const filters = manager.normalizeFilters({ team: 'Sistema', analyst: 'dyego' }, { authorizedTeams: ['Sistema', 'Catraca'], analysts, months: ['atual'] });
    assert.equal(filters.analyst, 'Todos');
});

test('período, mês e ciclo inválidos retornam aos valores seguros', () => {
    const filters = manager.normalizeFilters({ period: 'Semana 9', month: 'inexistente', cycle: 'inexistente' }, { authorizedTeams: ['Sistema'], analysts: [], months: ['atual', 'm1'] });
    assert.equal(filters.period, 'ALL');
    assert.equal(filters.month, 'atual');
    assert.equal(filters.cycle, 'atual');
});

test('filtros são preservados e restaurados durante a navegação', () => {
    const context = { authorizedTeams: ['Sistema', 'Catraca'], analysts: manager.authorizedAnalysts(users, ['Sistema', 'Catraca']), months: ['atual', 'm1'] };
    const source = { team: 'Sistema', analyst: 'lucas', month: 'm1', cycle: 'm1', period: 'Semana 2' };
    assert.deepEqual(manager.restoreFilters(manager.serializeFilters(source), context), manager.normalizeFilters(source, context));
});

test('tentativa de equipe pela URL não amplia o escopo do gestor', () => {
    const analysts = manager.authorizedAnalysts(users, ['Sistema']);
    const filters = manager.normalizeFilters({ team: 'Catraca', analyst: 'dyego' }, { authorizedTeams: ['Sistema'], analysts, months: ['atual'] });
    assert.equal(filters.team, 'Sistema');
    assert.equal(filters.analyst, 'Todos');
});

test('gestor abre ficha autorizada e recebe bloqueio para outra equipe', () => {
    assert.equal(manager.canViewAnalyst(users.gestor, users.lucas), true);
    assert.equal(manager.canViewAnalyst(users.gestor, users.dyego), false);
});

test('ranking usa somente pontuação confirmada e preserva a pendência separada', () => {
    const ranked = manager.rankRows([
        { id: 'lucas', name: 'Lucas', team: 'Sistema', confirmedPoints: 100, pendingPoints: 500 },
        { id: 'arthur', name: 'Arthur', team: 'Sistema', confirmedPoints: 120, pendingPoints: 0 }
    ]);
    assert.equal(ranked.find(row => row.id === 'arthur').position, 1);
    assert.equal(ranked.find(row => row.id === 'lucas').position, 2);
});

test('totais do resumo utilizam a mesma pontuação confirmada do ranking', () => {
    const rows = manager.rankRows([{ id: 'lucas', name: 'Lucas', team: 'Sistema', confirmedPoints: 100 }, { id: 'arthur', name: 'Arthur', team: 'Sistema', confirmedPoints: 120 }]);
    assert.equal(manager.summarize(rows, []).confirmed, 220);
    assert.equal(manager.summarize(rows, []).average, 110);
});

test('solicitações pendentes aparecem como previsão sem alterar o total oficial', () => {
    const summary = manager.summarize([{ id: 'lucas', team: 'Sistema', confirmedPoints: 100 }], [{ type: 'priority', status: 'Pendente', expectedPoints: 50 }]);
    assert.equal(summary.confirmed, 100);
    assert.equal(summary.pending, 50);
    assert.equal(summary.pendingPriorities, 1);
});

test('Modo TV expõe somente campos públicos permitidos', () => {
    const tv = manager.tvProjection([{ id: 'lucas', name: 'Lucas', team: 'Sistema', photo: 'foto', email: 'privado@actuar.com', status: 'active', evidence: 'sigilosa', confirmedPoints: 100, pendingPoints: 50 }]);
    assert.deepEqual(Object.keys(tv[0]).sort(), ['avatar', 'confirmedPoints', 'initials', 'name', 'position', 'team'].sort());
    assert.equal(JSON.stringify(tv).includes('privado@actuar.com'), false);
    assert.equal(JSON.stringify(tv).includes('sigilosa'), false);
});

test('estado sem resultado é representado por lista e resumo vazios', () => {
    assert.deepEqual(manager.filterRows([], manager.DEFAULT_FILTERS, ['Sistema']), []);
    assert.equal(manager.summarize([], []).analysts, 0);
});

test('módulo de prioridades integra visão, aprovações, lançamentos, ranking e configuração do Modo TV', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    for (const marker of ['priorityModuleShell', 'priorityModuleTabOverview', 'priorityModuleTabApprovals', 'priorityModuleTabLaunches', 'priorityModuleTabRanking', 'admPanelPriorityLaunches', 'priorityApprovalReviewDrawer', 'priorityComplementModal', 'priorityDecisionReviewModal', 'priorityAttendanceRecordsForTeam', 'evaluationComplements', 'evaluationVersion', 'PRIORITY_ADJUSTMENT', 'managerTvConfigModal', 'renderPriorityRotationOverviewPanel', 'renderPriorityRotationLast', 'renderPriorityRotationPrimary', 'renderPriorityRotationSequence', 'openManagerAnalyst', 'closeRankingPresentation', 'togglePresentationFullscreen']) assert.match(html, new RegExp(marker));
});

test('fluxos gerenciais principais possuem adaptação responsiva', () => {
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    assert.match(css, /@media \(max-width: 768px\)[\s\S]*manager-filter-grid/);
    assert.match(css, /manager-kpi-grid/);
    assert.match(css, /manager-consultation-banner/);
    assert.match(css, /priority-module-tabs/);
    assert.match(css, /priority-approval-filters/);
    assert.match(css, /priority-ranking-summary/);
    assert.match(css, /priority-attendance-card/);
    assert.match(css, /priority-detail-evaluation/);
    assert.match(css, /priority-opinion-complement/);
    assert.match(css, /rotation-ops-primary/);
    assert.match(css, /rotation-ops-sequence-row/);
    assert.match(css, /rotation-ops-footer/);
});

test('pontuação igual compartilha a mesma posição no ranking', () => {
    const rows = [
        { id: 'dyego', name: 'Dyego Antônio', team: 'Catraca', confirmedPoints: 150 },
        { id: 'vitor', name: 'Vitor Massaki', team: 'Catraca', confirmedPoints: 150 },
        { id: 'felipe', name: 'Felipe Lima', team: 'Catraca', confirmedPoints: 100 },
        { id: 'ana', name: 'Ana Souza', team: 'Catraca', confirmedPoints: 80 }
    ];
    const ranked = manager.rankRows(rows);
    const posicao = id => ranked.find(row => row.id === id).position;

    // Antes a ordem alfabética desempatava e Vitor caía em 2º com os mesmos 150 pts.
    assert.equal(posicao('dyego'), 1);
    assert.equal(posicao('vitor'), 1);
    assert.equal(posicao('felipe'), 3, 'depois de um empate duplo a próxima posição é a terceira');
    assert.equal(posicao('ana'), 4);

    assert.equal(ranked.find(row => row.id === 'dyego').tied, true);
    assert.equal(ranked.find(row => row.id === 'felipe').tied, false);
});

test('cabeçalho de card acomoda a ação ao lado do texto', () => {
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    // Sem layout no header, o botão de ação caía para baixo da descrição.
    assert.match(css, /\.actuar-card-header \{ display: flex;[^}]*justify-content: space-between;/);
    // A prévia do ranking tem uma coluna a mais que a lista de pendências:
    // posição, avatar, nome e pontos — quem estica é o nome.
    assert.match(css, /\.priority-preview-ranking > button \{ grid-template-columns: auto auto minmax\(0,1fr\) auto;/);
});

test('gestão responde pelas duas equipes quando não há restrição declarada', () => {
    const marco = { name: 'Marco Nunes', team: 'Sistema', role: 'Gestor Adm', active: true };
    const joao = { name: 'João Gabriel', team: 'Catraca', role: 'Gestor Adm', active: true };

    // Antes o padrão era a própria equipe: Marco não via Catraca e João não via Sistema.
    assert.deepEqual(manager.authorizedTeams(marco), ['Sistema', 'Catraca']);
    assert.deepEqual(manager.authorizedTeams(joao), ['Sistema', 'Catraca']);

    // Restrição explícita continua valendo, para quando existir configuração.
    assert.deepEqual(manager.authorizedTeams({ ...joao, managedTeams: ['Catraca'] }), ['Catraca']);
    assert.deepEqual(manager.authorizedTeams({ ...joao, allTeamsAccess: true }), ['Sistema', 'Catraca']);

    // Quem não é gestão, ou está inativo, segue sem escopo nenhum.
    assert.deepEqual(manager.authorizedTeams({ ...joao, role: 'Analista de catraca' }), []);
    assert.deepEqual(manager.authorizedTeams({ ...joao, active: false }), []);
});

test('todo asset local é versionado para a correção chegar ao navegador', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const build = fs.readFileSync('scripts/build-check.cjs', 'utf8');

    const referencias = [...html.matchAll(/(?:src|href)="((?:js|styles)\/[^"]+)"/g)].map(m => m[1]);
    assert.ok(referencias.length >= 7, 'esperava as referências locais de js e css');
    const semVersao = referencias.filter(ref => !/\?v=[^"]+$/.test(ref));
    assert.deepEqual(semVersao, [], `asset servido sem versão: ${semVersao.join(', ')}`);

    // Uma única versão por publicação: arquivos com versões diferentes escondem regressões.
    const versoes = [...new Set(referencias.map(ref => ref.split('?v=')[1]))];
    assert.equal(versoes.length, 1, `versões divergentes entre assets: ${versoes.join(', ')}`);

    // E o build recusa a publicação se alguém esquecer.
    assert.match(build, /Asset local sem versão na URL/);
});

test('Modo TV combinado mantém a hierarquia do ranking e trata o rodízio como apoio', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // O Modo TV agora usa os mesmos renderizadores da apresentação do ranking.
    // Antes existia uma segunda versão simplificada — sem foto, premiação nem colunas de métrica.
    const trecho = html.slice(html.indexOf('const renderRanking = () =>'), html.indexOf('const rotation = PriorityRotation.view('));
    assert.match(trecho, /head\.innerHTML = PRESENTATION_TABLE_HEAD;/, 'o cabeçalho precisa ser o mesmo da apresentação pública');
    assert.match(trecho, /renderTopDashboard\(metrics\);/, 'o pódio rico vem de renderTopDashboard');
    assert.match(trecho, /renderLeaderboard\(metrics\);/, 'a tabela completa vem de renderLeaderboard');
    assert.doesNotMatch(trecho, /manager-podium-item--/, 'o pódio simplificado não deve voltar');

    // Um cabeçalho só, compartilhado pelas duas telas.
    assert.equal((html.match(/const PRESENTATION_TABLE_HEAD =/g) || []).length, 1);
    assert.match(html, /if \(head\) head\.innerHTML = PRESENTATION_TABLE_HEAD;/);

    // O recorte do Modo TV não pode vazar para a visão de baixo.
    assert.match(trecho, /const tabAnterior = activeRankingTab;/);
    assert.match(trecho, /activeRankingTab = tabAnterior;/);

    // E as opções da configuração continuam valendo sobre o markup completo.
    assert.match(html, /function applyManagerTvDisplayOptions\(\)/);
    assert.match(html, /overlay\?\.classList\.toggle\('tv-hide-points', !managerTvOptions\.showPoints\)/);
    assert.match(html, /#podiumPresentation \.podium-name/);
    assert.match(html, /#leaderboardBodyPresentation \.ranking-user-name/);
    assert.match(html, /<span class="ranking-user-name">/);

    // O rodízio vira painel lateral, visível só no combinado.
    assert.match(html, /function renderPresentationRotationPanel\(rotation, title, posicoes = new Map\(\)\)/);
    assert.match(html, /const visivel = managerTvOptions\.content === 'combined';/);
    assert.match(html, /panel\.classList\.toggle\('hidden', !visivel\)/);
    assert.match(html, /id="presentationRotationPanel"/);

    // O ciclo inteiro numa linha só, na ordem em que acontece.
    for (const marcador of ['Último', 'Em atendimento', 'Próximo', 'rotation-strip-track', 'º da fila']) {
        assert.ok(html.includes(marcador), `faixa do rodízio sem ${marcador}`);
    }
    assert.match(html, /rotation\.upcoming \|\| \[\]\)\.slice\(0, 2\)/, 'a sequência mostra os dois próximos');
    assert.match(css, /\.rotation-strip-track \{ display: grid; grid-auto-flow: column;/, 'a faixa precisa ser horizontal');
    assert.match(css, /\.rotation-strip-slot\.is-live \.rotation-strip-person strong/, 'quem atende agora precisa de peso próprio');

    // Alternância de departamento disponível na própria apresentação.
    assert.match(html, /function renderPresentationTeamSwitch\(team\)/);
    assert.match(html, /id="presentationTeamSwitch"/);
    assert.match(html, /onclick="switchRankingTab\('\$\{item\}'\)"/);
    assert.match(html, /wrap\.classList\.toggle\('hidden', teams\.length < 2\)/, 'com um só departamento não há o que alternar');
    assert.match(html, /const teams = managerTvActive \? getManagerAuthorizedTeams\(\) : \['Sistema', 'Catraca'\];/);
    assert.match(html, /renderPresentationTeamSwitch\(team\);/, 'o alternador acompanha o estado do seletor');
    // E a auto-alternância volta a ficar disponível no Modo TV, dentro do escopo.
    assert.match(html, /const views = managerTvActive \? getManagerAuthorizedTeams\(\) : \['Sistema', 'Catraca'\];/);
    assert.doesNotMatch(html, /btnAutoRotatePresentation'\)\?\.classList\.add\('hidden'\);\s*\n\s*renderManagerTv\(\)/);
    assert.match(css, /\.presentation-team-option\.is-active \{ background: var\(--actuar-primary\)/);
});

test('Modo TV do rodízio tem protagonista, sequência e fila — e nada de "Participante indisponível"', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    const trecho = html.slice(html.indexOf('function renderRotationStage'), html.indexOf('function applyManagerTvDisplayOptions'));

    // Antes eram três cartões de mesmo peso; agora há um destaque e o apoio ao lado.
    assert.match(trecho, /rotation-stage-hero \$\{atendendo \? 'is-live' : 'is-idle'\}/);
    assert.match(trecho, /rotation-stage-next/);
    assert.match(trecho, /rotation-stage-last/);

    // Sem atendimento aberto quem ocupa o palco é o próximo — não um bloco vazio.
    assert.match(trecho, /const heroId = atendendo \|\| rotation\.next;/);
    assert.match(trecho, /'Em atendimento agora' : pausado \? 'Rodízio pausado' : 'Próximo a atender'/);
    // A fila ganha legenda própria, para não parecer repetição do que já está no palco.
    assert.match(trecho, /Fila completa · \$\{ativos\} participante/);
    assert.match(trecho, /const pausados = \(rotation\.paused \|\| \[\]\)\.length;/);
    assert.match(trecho, /Nenhum participante ativo na fila deste departamento\./);
    assert.match(trecho, /Nenhum atendimento concluído no período\./);

    // A fila ganha situação com cor, e o rótulo da tela deixa de dizer "Pódio".
    assert.match(trecho, /rotation-queue-badge--\$\{situacao\[1\]\}/);
    assert.match(html, /secaoLabel\.textContent = ehRodizio \? 'Atendimento agora' : 'Pódio'/);
    assert.match(html, /prefixo\.textContent = ehRodizio \? 'Operação em tempo real' : 'Ranking Performance'/);

    // A opção de ocultar sobrenome também vale aqui.
    assert.match(trecho, /managerTvOptions\.showNames \? user\.name : /);

    assert.match(css, /#podiumPresentation\.podium-presentation--rotation \{ display: grid;/);
    assert.match(css, /\.rotation-stage-hero\.is-live \{/);
});

test('o anel do avatar reflete a colocação no ranking, não a cor padrão', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // Antes todo avatar do rodízio saía roxo, mesmo para quem estava em primeiro.
    assert.match(html, /function rankingRingClass\(position\)/);
    assert.match(html, /position === 1 \? 'is-gold' : position === 2 \? 'is-silver' : position === 3 \? 'is-bronze' : ''/);

    // A colocação vem da mesma conta que monta o pódio, não do ranking de prioridades.
    assert.match(html, /const posicoes = rankingPositionsByTeam\(getAggregatedMetrics\(/);
    assert.match(html, /renderRotationStage\(rotation, head, posicoes\)/);
    assert.match(html, /renderPresentationRotationPanel\(rotation, title, posicoes\)/);

    // O avatar aceita o modificador sem quebrar quem já o chamava com um ou dois argumentos.
    assert.match(html, /function priorityRotationAvatar\(user, size = '', extra = ''\)/);
    assert.match(html, /rankingRingClass\(posicoes\.get\(id\)\)/);

    // Mesma paleta das medalhas do pódio, para a leitura ser a mesma nos dois lugares.
    for (const [classe, cor] of [['is-gold', '#F2C230'], ['is-silver', '#D5DAE0'], ['is-bronze', '#E39A68']]) {
        assert.ok(css.includes(`.rotation-avatar.${classe} { border-color: ${cor}`), `anel ${classe} fora da paleta do pódio`);
        assert.ok(css.includes(`.podium-card--${classe.replace('is-', '')} .podium-avatar { border: 3px solid ${cor}`), `paleta do pódio mudou: ${classe}`);
    }
});

/* O anel dourado apareceu em todo mundo porque a colocação vinha do ranking de
   prioridades, onde a equipe inteira empatava em zero — e empate em zero virava
   cinco primeiros lugares. Este teste roda a função de verdade. */
test('o anel só dá medalha a quem está no top do próprio departamento', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const fonte = html.match(/function rankingPositionsByTeam\(metrics\) \{[\s\S]*?\n {8}\}/);
    assert.ok(fonte, 'rankingPositionsByTeam não encontrada no shell');

    const usuarios = {
        dyego: { team: 'Catraca', active: true },
        vitor: { team: 'Catraca', active: true },
        ana: { team: 'Catraca', active: true },
        bruno: { team: 'Catraca', active: true },
        carla: { team: 'Sistema', active: true },
        diego: { team: 'Sistema', active: true },
        marco: { team: 'Catraca', active: true, role: 'Gestor Adm' }
    };
    const pontos = { dyego: 150, vitor: 120, ana: 90, bruno: 0, carla: 40, diego: 0, marco: 999 };
    const executar = new Function('getStore', 'defaultUsers', 'isRankableUser', 'calculatePoints',
        `${fonte[0]}\nreturn rankingPositionsByTeam({});`);
    const posicoes = executar(
        () => ({ users: usuarios }),
        usuarios,
        user => user.role !== 'Gestor Adm',
        id => ({ total: pontos[id] })
    );

    assert.equal(posicoes.get('dyego'), 1, 'ouro para o primeiro do departamento');
    assert.equal(posicoes.get('vitor'), 2);
    assert.equal(posicoes.get('ana'), 3);
    assert.equal(posicoes.get('bruno'), 0, 'sem ponto não há medalha');

    // O top é por departamento: o primeiro do Sistema também é primeiro.
    assert.equal(posicoes.get('carla'), 1);
    assert.equal(posicoes.get('diego'), 0);

    assert.equal(posicoes.has('marco'), false, 'gestor não entra no ranking');
});

test('a apresentação tem um único controle de departamento', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    // Havia dois: um <select> à esquerda e o alternador à direita. Dois controles para
    // o mesmo estado é convite a mostrarem coisas diferentes na mesma tela.
    assert.equal((html.match(/rankingViewSelectPresentation/g) || []).length, 0, 'o seletor duplicado da apresentação voltou');
    assert.equal((html.match(/id="presentationTeamSwitch"/g) || []).length, 1);

    // O ranking normal, fora da apresentação, mantém o seletor dele.
    assert.match(html, /id="rankingViewSelect"/);
    assert.match(html, /\['rankingViewSelect'\]\.forEach/);

    // E o Modo TV passa a ler o departamento do próprio filtro, não do elemento removido.
    assert.match(html, /syncRankingViewControls\(managerFilters\.team\);/);
});

test('departamentos de apoio existem no cadastro sem entrar no ranking', () => {
    // TEAMS continua sendo só onde há disputa entre analistas.
    assert.deepEqual(manager.TEAMS, ['Sistema', 'Catraca']);
    assert.deepEqual(manager.DEPARTMENTS, ['Sistema', 'Catraca', 'Logística', 'Toletus Lab', 'Administrativo']);
    for (const time of manager.TEAMS) assert.ok(manager.DEPARTMENTS.includes(time), 'o cadastro precisa manter as equipes de ranking');

    const pessoas = {
        lucas: { name: 'Lucas', role: 'Analista de sistema', team: 'Sistema', active: true },
        ana: { name: 'Ana', role: 'Logística/Faturamento', team: 'Logística', active: true },
        marco: { name: 'Marco', role: 'Gestor Adm', team: 'Administrativo', active: true }
    };
    // Quem está num departamento de apoio não aparece na lista gerencial de analistas.
    assert.deepEqual(manager.authorizedAnalysts(pessoas, manager.DEPARTMENTS).map(item => item.id), ['lucas']);

    // Gestor lotado no Administrativo continua respondendo pelas equipes de ranking.
    assert.deepEqual(manager.authorizedTeams(pessoas.marco), ['Sistema', 'Catraca']);
});

test('perfis operacionais não competem no ranking, mesmo lotados em Sistema ou Catraca', () => {
    // A lista estava parada em Envio/Coleta: Faturamento, Expedição, Logística e
    // Toletus Lab lotados numa equipe de ranking entravam como se fossem analistas.
    for (const role of ['Faturamento', 'Expedição', 'Logística/Faturamento', 'Toletus Lab']) {
        assert.ok(manager.NON_RANKED_ROLES.includes(role), `perfil operacional fora da lista: ${role}`);
    }

    const pessoas = {
        lucas: { name: 'Lucas', role: 'Analista de catraca', team: 'Catraca', active: true },
        jeremias: { name: 'Jeremias', role: 'Toletus Lab', team: 'Catraca', active: true },
        ana: { name: 'Ana', role: 'Faturamento', team: 'Sistema', active: true }
    };
    assert.deepEqual(manager.authorizedAnalysts(pessoas, manager.TEAMS).map(item => item.id), ['lucas']);
    assert.equal(manager.canViewAnalyst({ role: 'Gestor Adm', team: 'Sistema', active: true }, pessoas.jeremias), false);
});

test('no Modo TV o ranking mostra 1º ao 4º e a lanterna, sem mentir a posição', () => {
    const lista = (n) => Array.from({ length: n }, (_, i) => ({ nome: `p${i + 1}` }));
    const posicoes = (n) => manager.tvSlice(lista(n)).map(linha => linha.position);

    // Time pequeno aparece inteiro: cortar 5 para mostrar 5 tira gente sem ganhar espaço.
    assert.deepEqual(posicoes(5), [1, 2, 3, 4, 5]);
    assert.deepEqual(posicoes(3), [1, 2, 3]);
    assert.deepEqual(posicoes(1), [1]);
    assert.deepEqual(posicoes(0), []);

    // Passando de 5, some o miolo — e o número mostrado continua sendo o real.
    assert.deepEqual(posicoes(6), [1, 2, 3, 4, 6]);
    assert.deepEqual(posicoes(14), [1, 2, 3, 4, 14]);
    assert.equal(manager.tvSlice(lista(14)).at(-1).index, 13, 'a última linha precisa carregar o índice original');

    // Só a última é lanterna, e ninguém é lanterna sozinho na lista.
    assert.deepEqual(manager.tvSlice(lista(9)).map(linha => linha.isLast), [false, false, false, false, true]);
    assert.deepEqual(manager.tvSlice(lista(1)).map(linha => linha.isLast), [false]);

    // O item original chega inteiro para quem desenha a linha.
    assert.deepEqual(manager.tvSlice(lista(8)).at(-1).item, { nome: 'p8' });
});

test('o telão recorta e anima, a lista de trabalho continua completa', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // Dois corpos, dois conteúdos: só o do telão passa pelo recorte.
    assert.match(html, /const recorte = window\.ManagerExperience\.tvSlice\(group\.list\);/);
    assert.match(html, /document\.getElementById\('leaderboardBody'\)\.innerHTML = html \|\| vazio;/);
    assert.match(html, /if \(presBody\) presBody\.innerHTML = tvHtml \|\| vazio;/);
    assert.ok(!/presBody\.innerHTML = finalHtml/.test(html), 'o telão voltou a repetir a lista inteira');

    // A lanterna entra depois de todas as outras linhas.
    assert.match(html, /const atraso = linha\.isLast \? \(recorte\.length - 1\) \* 260 \+ 1500 : ordem \* 260 \+ 200;/);
    assert.match(html, /style="--tv-delay:\$\{tv\.atraso\}ms"/);

    // O atraso vai por variável: `animation-delay` inline valeria para as três
    // camadas da lanterna de uma vez e a pulsação começaria junto com a entrada.
    assert.match(css, /#leaderboardBodyPresentation \.tv-row-lanterna \{[\s\S]*?animation-delay:[\s\S]*?calc\(var\(--tv-delay, 0ms\) \+ 780ms\)/);
    for (const passo of ['tv-row-in', 'tv-lanterna-in', 'tv-lanterna-shake', 'tv-lanterna-pulse']) {
        assert.match(css, new RegExp(`@keyframes ${passo} \\{`), `animação ausente: ${passo}`);
    }

    // O selo de lanterna é coisa de telão; na lista de trabalho ele ficaria fixo.
    assert.match(css, /\.tv-lanterna-badge \{[\s\S]*?display: none;/);
    assert.match(css, /#leaderboardBodyPresentation \.tv-lanterna-badge \{[\s\S]*?display: inline-flex;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?#leaderboardBodyPresentation \.tv-row-lanterna/);
});

test('no telão o pódio tem quatro lugares; na tela de trabalho continua com três', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // Duas montagens: a pública sem lanterna, a do telão com.
    assert.match(html, /const buildPodium = \(team, tv = false\) => \{/);
    assert.match(html, /document\.getElementById\('podiumSistema'\)\.innerHTML = podiumHtml\.Sistema;/);
    assert.match(html, /Sistema: buildPodium\('Sistema', true\)/);
    assert.match(html, /Catraca: buildPodium\('Catraca', true\)/);
    assert.match(html, /presPodium\.innerHTML = conteudo;/);
    assert.ok(!/presPodium\.innerHTML = podiumHtml\[activeRankingTab\]/.test(html), 'o telão voltou ao pódio de três');

    // A lanterna só existe quando há alguém fora do pódio.
    assert.match(html, /const ultimo = tv && ranking\.length > 3 \? ranking\[ranking\.length - 1\] : null;/);
    // E o número dela é a posição real na lista, não um "4º".
    assert.match(html, /podium-place-marker[^`]*>\$\{ranking\.length\}<\/span>/);

    // Entrada em sequência: 3º, 2º, 1º e, bem depois, a lanterna.
    assert.match(html, /const ATRASO_PODIO = \[900, 550, 200\];/);
    assert.match(html, /style="--tv-delay:2300ms"/);

    // Quatro colunas só no telão, e a regra precisa ganhar do grid-cols-3 do Tailwind.
    assert.match(css, /#podiumPresentation\.podium-has-lanterna \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); /);
    assert.match(css, /#podiumPresentation \.podium-combined-grid\.podium-has-lanterna \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
    for (const passo of ['tv-podium-in', 'tv-podium-lanterna-in', 'tv-podium-pulse']) {
        assert.match(css, new RegExp(`@keyframes ${passo} \\{`), `animação ausente: ${passo}`);
    }
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?#podiumPresentation \.tv-podium-lanterna/);
});

test('listagem de pessoas mostra a foto ao lado do nome', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // Padrão do produto: onde há pessoa listada, há foto redonda junto do nome.
    const listagens = [
        ['Pessoas e Acessos', /priorityRotationAvatar\(u, 'is-featured', u\.photo \? '' : 'is-photoless'\)/],
        ['Ociosidade por analista', /attendance-person">\$\{priorityRotationAvatar\(usuarios\[row\.userId\]/],
        ['Escala semanal', /attendance-person">\$\{priorityRotationAvatar\(usuarios\[id\]/]
    ];
    for (const [nome, padrao] of listagens) assert.match(html, padrao, `listagem sem foto: ${nome}`);

    // Quem ainda não tem foto precisa ser identificável de relance, para a gestão
    // saber de quem cobrar o cadastro: anel tracejado e o cartão dizendo "Pendente".
    assert.match(html, /u\.photo \? '' : 'is-photoless'/);
    assert.match(html, /<dt>Foto<\/dt><dd class="\$\{u\.photo \? '' : 'is-missing'\}">\$\{u\.photo \? 'Cadastrada' : 'Pendente'\}/);
    assert.match(css, /\.rotation-avatar\.is-photoless \{[^}]*border-style: dashed/);
    assert.match(css, /\.people-card-meta dd\.is-missing \{[^}]*color: var\(--actuar-muted\)/);

    // E ninguém fica sem identificação: sem foto, o avatar cai nas iniciais.
    const helper = html.slice(html.indexOf('function priorityRotationAvatar'), html.indexOf('function priorityRotationAvatar') + 520);
    assert.match(helper, /user\.photo \? `<img/);
    assert.match(helper, /escapeHtml\(initials\)/);
});

test('pessoas e acessos: cartões com busca, filtros e cadastro em modal', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // O formulário não pode mais viver aberto no meio da tela: ele mora no modal.
    const modal = html.slice(html.indexOf('<div id="userFormModal"'), html.indexOf('<!-- FIM MODAL DE CADASTRO -->'));
    assert.ok(modal.length > 500, 'modal de cadastro não encontrado');
    assert.match(modal, /class="user-form-modal hidden"/, 'o modal precisa começar fechado');
    for (const campo of ['editUserId', 'inputUserName', 'inputUserEmail', 'inputUserRole', 'inputUserTeam',
        'inputUserPassword', 'inputUserPhotoData', 'inputUserTracked', 'inputUserShiftStart', 'btnSaveUser']) {
        assert.match(modal, new RegExp(`id="${campo}"`), `campo perdido na migração para o modal: ${campo}`);
    }

    // Uma porta de entrada para criar e outra para editar, ambas passando pelo modal.
    assert.match(html, /onclick="openUserForm\(\)"[\s\S]{0,120}Novo usuário/);
    assert.match(html, /onclick="openUserForm\('\$\{id\}'\)"/);
    assert.match(html, /function openUserForm\(id\) \{[\s\S]*?if \(id\) startEditUser\(id\)/);
    assert.match(html, /function closeUserForm\(\) \{[\s\S]*?cancelEditUser\(\)/);
    // Salvar precisa fechar o modal, senão o formulário fica por cima da lista atualizada.
    assert.match(html, /const ok = await persistStore\(\);\s*\n\s*if \(ok\) \{\s*\n\s*closeUserForm\(\);/);

    // A lista virou grade de cartões, com busca e filtros próprios.
    assert.match(html, /<div id="usersManagementTable" class="actuar-people-grid"><\/div>/);
    assert.ok(!/<tbody id="usersManagementTable"/.test(html), 'a tabela antiga ainda está no HTML');
    for (const controle of ['usersSearch', 'usersFilterTeam', 'usersFilterStatus']) {
        assert.match(html, new RegExp(`id="${controle}"[^>]*on(input|change)="renderUsersManagementTable\\(\\)"`),
            `controle sem re-render: ${controle}`);
    }
    assert.match(css, /\.actuar-people-grid \{[^}]*grid-template-columns: repeat\(auto-fill/);
    // O modal fica acima da ficha de peças (140), como as demais modais do produto.
    assert.match(css, /\.user-form-modal \{[^}]*z-index: 150/);
});

test('inativar não pode esconder a pessoa da tela onde ela é reativada', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    // A listagem filtra por departamento, e não por `canManagerViewAnalyst` — essa
    // embute "está ativo?" e sumia com quem acabou de ser inativado.
    assert.match(html, /const visiveis = Object\.keys\(usersList\)\.filter\(id => canManagerListUser\(usersList\[id\]\)\);/);
    const guarda = html.slice(html.indexOf('function canManagerListUser'), html.indexOf('function canManagerListUser') + 400);
    assert.ok(!/active/.test(guarda), 'a visibilidade da listagem voltou a depender da situação da pessoa');
    assert.match(guarda, /getManagerAuthorizedTeams\(\)\.includes\(u\.team\)/);
    // E o domínio continua excluindo inativos de ranking e rodízio, como deve ser.
    assert.equal(manager.canViewAnalyst(users.admin, { ...users.dyego, active: false }), false);
});

test('toda ação sobre uma pessoa passa por confirmação explicando o efeito', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const trecho = nome => {
        const i = html.indexOf(`async function ${nome}(`);
        assert.ok(i > 0, `função não encontrada: ${nome}`);
        return html.slice(i, i + 2000);
    };

    for (const acao of ['toggleUserActive', 'resetUserPassword']) {
        assert.match(trecho(acao), /await actuarConfirm\(\{/, `ação sem dupla validação: ${acao}`);
    }

    // Inativar e reativar têm mensagens próprias: a primeira avisa o que se perde,
    // a segunda o que volta. Só a destrutiva usa o tom vermelho.
    const toggle = trecho('toggleUserActive');
    assert.match(toggle, /tone: 'danger'[\s\S]{0,200}Inativar \$\{u\.name\}\?/);
    assert.match(toggle, /perde o acesso e não consegue mais entrar/);
    assert.match(toggle, /Para reativar, use o filtro "Inativos"/);
    assert.match(toggle, /Reativar \$\{u\.name\}\?/);
    assert.match(toggle, /volta a acessar o sistema com a senha atual/);
    // Cancelar não pode alterar nada.
    assert.match(toggle, /if \(!confirmado\) return;\s*\n\s*u\.active = !inativando;/);
});

test('a busca de pessoas usa o campo com ícone do Design System', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // Sem .actuar-input-icon a lupa cai por cima do texto: o padding global do
    // produto é !important e ganha de qualquer recuo escrito à mão.
    assert.match(html, /class="people-search actuar-input-icon">\s*\n\s*<i class="fi fi-rr-search"[\s\S]{0,300}id="usersSearch"/);
    assert.match(css, /body\.actuar-app \.actuar-input-icon > input[^{]*\{[^}]*padding-left: 38px !important/);
    assert.ok(!/\.people-search input \{[^}]*padding/.test(css), 'recuo próprio da busca reintroduz o bug da lupa');
});

test('ficha de pessoa é patrimônio: não existe exclusão, só inativação', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    // Nenhum caminho pela interface leva a excluir alguém.
    assert.ok(!/onclick="deleteUser\(/.test(html), 'o botão de excluir pessoa voltou para a tela');
    const corpo = html.slice(html.indexOf('async function deleteUser('), html.indexOf('async function deleteLog('));
    assert.ok(!/delete appStore\.users/.test(corpo), 'deleteUser ainda apaga a ficha do store');
    assert.ok(!/persistStore\(\)/.test(corpo), 'deleteUser ainda grava a remoção');
    // E se um onclick antigo sobreviver em cache, ele encontra uma recusa explicada.
    assert.match(corpo, /actuarAlert\(/);
    assert.match(corpo, /Fichas de pessoas não são excluídas/);
    assert.match(corpo, /Inativar acesso/);

    // Inativar é o desligamento — e a confirmação precisa dizer isso.
    const toggle = html.slice(html.indexOf('async function toggleUserActive('), html.indexOf('async function deleteUser('));
    assert.match(toggle, /A ficha continua aqui/);
    assert.match(toggle, /nenhuma ficha é excluída/);
});

test('pessoa inativa não entra por nenhuma das três portas de login', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const trecho = (nome, ate) => html.slice(html.indexOf(nome), html.indexOf(ate));

    // Três logins, três bloqueios — nenhum deles pode depender só do dropdown.
    assert.match(trecho('async function loginAdmin(', 'function openAnalystModal'), /active === false[\s\S]{0,200}showLoginError\('admin'/);
    assert.match(trecho('async function loginAnalyst(', 'function openPecaModal'), /user\.active === false\) return showLoginError\('analyst'/);
    assert.match(trecho('async function loginPeca(', 'function logoutPeca'), /active === false[\s\S]{0,200}showLoginError\('peca'/);

    // O dropdown também não oferece quem está inativo: são duas camadas, não uma.
    assert.match(html, /filter\(id => usersList\[id\]\.active !== false && isRankableUser\(usersList\[id\]\)\)/);

    // E quem já estava logado cai na próxima recarga: a sessão é reconferida.
    const sessao = trecho('function restoreSession(', 'function persistSession');
    assert.match(sessao, /if \(!user \|\| user\.active === false\) \{ clearSession\(\); return false; \}/);
});

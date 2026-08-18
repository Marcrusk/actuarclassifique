(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ActuarNavigation = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ==========================================================================
       ÁRVORE DE NAVEGAÇÃO — FONTE ÚNICA
       A navegação por módulos vivia em duas barras horizontais (a da gestão e a
       do analista), cada uma com a sua lista, a sua ordem e as suas regras de
       visibilidade. Aqui existe UMA descrição da árvore; quem pergunta informa o
       contexto (perfil, equipe, permissões) e recebe só o que aquela pessoa pode
       abrir. Nenhuma tela monta menu por conta própria.

       Os contadores reaproveitam os IDs que as telas já preenchem
       (admPriorityPendingBadge, admPiecesPendingBadge, admBreakLiveBadge,
       admTransferPendingBadge): o menu não inventa contagem própria, mostra a
       mesma que a tela calculou — e some quando ela zera.

       Um item tem no máximo dois níveis: módulo e página do módulo. Grupo só
       existe onde há mais de uma ROTA de verdade — abas que são filtro da página
       (status, período) continuam dentro da página, não viram item de menu.
       ========================================================================== */

    const LAB_ROLE = 'Toletus Lab';
    const OPERATION_ROLES = ['Toletus Lab', 'Logística/Faturamento', 'Envio/Coleta', 'Faturamento', 'Expedição'];

    function rota(name, section) { return section ? { name, section } : { name }; }

    /* Gestão: as seções são `#/admin/<section>`, e cada uma tem painel próprio.
       Prioridades, Métricas e Histórico já eram lidos como grupo na barra antiga
       (os subitens vinham recuados); aqui isso vira estrutura de verdade. */
    function managerTree() {
        return [
            {
                id: 'operacao', title: 'Operação', items: [
                    {
                        id: 'prioridades', label: 'Prioridades', icon: 'fi-rr-star', route: rota('admin', 'visao'),
                        children: [
                            { id: 'prioridades-visao', label: 'Visão geral', route: rota('admin', 'visao') },
                            { id: 'prioridades-aprovacoes', label: 'Aprovações', route: rota('admin', 'prioridades'), badgeId: 'admPriorityPendingBadge' },
                            { id: 'prioridades-lancamentos', label: 'Lançamentos', route: rota('admin', 'priorityLaunches') },
                            { id: 'prioridades-ranking', label: 'Ranking do rodízio', route: rota('admin', 'ranking') }
                        ]
                    },
                    { id: 'pecas', label: 'Peças', icon: 'fi-rr-box-open', route: rota('admin', 'pecas'), badgeId: 'admPiecesPendingBadge' },
                    { id: 'ponto', label: 'Ponto e pausas', icon: 'fi-rr-time-check', route: rota('admin', 'ponto'), badgeId: 'admBreakLiveBadge' }
                ]
            },
            {
                id: 'desempenho', title: 'Desempenho', items: [
                    { id: 'rankingGeral', label: 'Ranking geral', icon: 'fi-rr-ranking-podium', route: rota('admin', 'rankingGeral'), also: ['analista'] },
                    {
                        id: 'metricas', label: 'Métricas operacionais', icon: 'fi-rr-chart-histogram', route: rota('admin', 'lancamentos'),
                        children: [
                            { id: 'metricas-lancamentos', label: 'Lançamentos', route: rota('admin', 'lancamentos') },
                            { id: 'metricas-transferencias', label: 'Transferências', route: rota('admin', 'transferencias'), badgeId: 'admTransferPendingBadge' }
                        ]
                    },
                    { id: 'ciclos', label: 'Ciclos e Fechamento', icon: 'fi-rr-calendar-check', route: rota('admin', 'ciclos') }
                ]
            },
            {
                id: 'gestao', title: 'Gestão', items: [
                    { id: 'cadastros', label: 'Pessoas e Acessos', icon: 'fi-rr-users-alt', route: rota('admin', 'cadastros') },
                    /* Sem ramificação: o que a gestão excluiu deixou de ter tela própria
                       e passou a ser uma linha do tipo "Excluído" dentro do próprio
                       Histórico. Manter "Excluídos" no menu apontaria para uma seção
                       que não existe mais. */
                    { id: 'historico', label: 'Histórico e auditoria', icon: 'fi-rr-time-past', route: rota('admin', 'historico') }
                ]
            }
        ];
    }

    /* Analista: aqui as "seções" são rotas públicas de primeiro nível. Envio,
       Coleta e Tasks seguem a demanda da equipe — a mesma regra da barra antiga. */
    function analystTree(context) {
        const abas = context.publicTabs || {};
        return [
            {
                id: 'desempenho', title: 'Meu desempenho', items: [
                    { id: 'dashboard', label: 'Dashboard individual', icon: 'fi-rr-chart-histogram', route: rota('dashboard') },
                    {
                        /* A tela de Prioridades é longa: registrar fica no topo e o
                           histórico no fim. Sem essas duas entradas, quem queria só
                           consultar precisava abrir a tela e rolar até achar. */
                        id: 'priorities', label: 'Prioridades', icon: 'fi-rr-star', route: rota('priorities'),
                        children: [
                            { id: 'priorities-visao', label: 'Visão geral', route: rota('priorities') },
                            { id: 'priorities-historico', label: 'Histórico', route: rota('priorities', 'historico') }
                        ]
                    },
                    { id: 'ranking', label: 'Ranking geral', icon: 'fi-rr-ranking-podium', route: rota('ranking') }
                ]
            },
            {
                id: 'operacao', title: 'Operação', items: [
                    { id: 'pecas', label: 'Solicitações de peças', icon: 'fi-rr-box-open', route: rota('pecas') },
                    { id: 'envio', label: 'Envio', icon: 'fi-rr-truck-side', route: rota('envio'), when: () => Boolean(abas.envio) },
                    { id: 'coleta', label: 'Coleta', icon: 'fi-rr-inbox', route: rota('coleta'), when: () => Boolean(abas.coleta) },
                    { id: 'tasks', label: 'Tasks', icon: 'fi-rr-list-check', route: rota('tasks'), when: () => Boolean(abas.tasks) }
                ]
            },
            {
                id: 'apoio', title: 'Apoio', items: [
                    { id: 'faq', label: 'Métricas e regras', icon: 'fi-rr-book-alt', route: rota('faq') }
                ]
            }
        ];
    }

    /* Acesso operacional (Lab, Logística, Envio/Coleta): a tela de trabalho é a
       operação de peças. O resto é consulta. */
    function operationsTree(context) {
        const abas = context.publicTabs || {};
        return [
            {
                id: 'operacao', title: 'Operação', items: [
                    { id: 'pecas', label: 'Operação de peças', icon: 'fi-rr-box-open', route: rota('pecas') },
                    { id: 'envio', label: 'Envio', icon: 'fi-rr-truck-side', route: rota('envio'), when: () => Boolean(abas.envio) },
                    { id: 'coleta', label: 'Coleta', icon: 'fi-rr-inbox', route: rota('coleta'), when: () => Boolean(abas.coleta) }
                ]
            },
            {
                id: 'apoio', title: 'Apoio', items: [
                    { id: 'ranking', label: 'Ranking geral', icon: 'fi-rr-ranking-podium', route: rota('ranking') },
                    { id: 'faq', label: 'Métricas e regras', icon: 'fi-rr-book-alt', route: rota('faq') }
                ]
            }
        ];
    }

    function allowed(node) {
        return typeof node.when !== 'function' || node.when() === true;
    }

    /* Monta a árvore do contexto e poda o que a pessoa não pode abrir. Grupo que
       fica sem nenhum filho some junto: menu com pai vazio só gera clique morto. */
    function build(context = {}) {
        const base = context.mode === 'manager' ? managerTree()
            : context.mode === 'operations' ? operationsTree(context)
                : analystTree(context);
        return base.map(grupo => ({
            ...grupo,
            items: grupo.items.filter(allowed).map(item => {
                if (!item.children) return { ...item };
                const filhos = item.children.filter(allowed).map(filho => ({ ...filho }));
                /* Sobrou um filho só? Então não há ramificação de verdade: vira acesso
                   direto. Um pai que abre para revelar um único item é clique perdido. */
                if (filhos.length === 1) return { ...item, children: null, route: filhos[0].route, badgeId: filhos[0].badgeId || item.badgeId };
                return { ...item, children: filhos };
            }).filter(item => !item.children || item.children.length > 0)
        })).filter(grupo => grupo.items.length > 0);
    }

    function sameRoute(a, b) {
        if (!a || !b) return false;
        if (a.name !== b.name) return false;
        return (a.section || null) === (b.section || null);
    }

    /* Quem manda no estado ativo é a rota, nunca um clique guardado à parte —
       assim recarregar a página ou colar um link deixa o menu no lugar certo. */
    function activeFor(tree, route) {
        const atual = route && route.name ? route : { name: 'dashboard' };
        for (const grupo of tree) {
            for (const item of grupo.items) {
                const alternativas = item.also || [];
                if (item.children) {
                    for (const filho of item.children) {
                        if (sameRoute(filho.route, atual)) return { groupId: grupo.id, itemId: item.id, childId: filho.id };
                    }
                }
                if (sameRoute(item.route, atual)) return { groupId: grupo.id, itemId: item.id, childId: null };
                if (atual.name === 'admin' && alternativas.includes(atual.section)) return { groupId: grupo.id, itemId: item.id, childId: null };
            }
        }
        return { groupId: null, itemId: null, childId: null };
    }

    /* O grupo aberto acompanha a rota — até a pessoa clicar em outro. O clique tem a
       palavra final enquanto ela não navega; `navGoTo` zera o `manual`, então expansões
       abertas só para espiar não ficam guardadas.

       Antes a rota vencia sempre, e o efeito era um menu travado: estando em Prioridades
       (um grupo com filhos), clicar em "Métricas operacionais" não abria nada e Prioridades
       continuava aberto, porque o `manual` recém-definido era ignorado.

       `manual === ''` é o fechamento explícito: sem ele, fechar o grupo da rota atual seria
       desfeito no mesmo instante pela própria rota. */
    function expandedFor(tree, route, manual) {
        const comFilhos = id => tree.flatMap(grupo => grupo.items).some(item => item.id === id && item.children);
        if (manual === '') return null;
        if (manual && comFilhos(manual)) return manual;
        const ativo = activeFor(tree, route);
        return ativo.itemId && comFilhos(ativo.itemId) ? ativo.itemId : null;
    }

    function findItem(tree, itemId) {
        return tree.flatMap(grupo => grupo.items).find(item => item.id === itemId) || null;
    }

    /* Trilha do cabeçalho: módulo e página, na ordem em que a pessoa navegou. */
    function breadcrumb(tree, route) {
        const ativo = activeFor(tree, route);
        const item = ativo.itemId ? findItem(tree, ativo.itemId) : null;
        if (!item) return [];
        const filho = ativo.childId && item.children ? item.children.find(candidato => candidato.id === ativo.childId) : null;
        return filho ? [item.label, filho.label] : [item.label];
    }

    return { build, activeFor, expandedFor, breadcrumb, findItem, sameRoute, LAB_ROLE, OPERATION_ROLES };
});

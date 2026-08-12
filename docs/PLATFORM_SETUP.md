# Plataforma oficial de Performance do Atendimento

## Arquitetura

A aplicação continua sendo a SPA estática existente. O `rankpro_store` permanece apenas como fonte temporária das métricas operacionais históricas. Sua leitura pública passa por `get_legacy_performance_store()`, que remove solicitações, justificativas, protocolos de monitoria e identificadores de clientes. Novas solicitações, decisões e pontos são gravados exclusivamente nas tabelas relacionais.

A identidade vem de Supabase Auth. O parâmetro `analyst` é somente um filtro de visualização autorizado; todas as consultas privadas e RPCs usam `auth.uid()` e RLS.

## Fluxo de solicitações de peça

```
analista envia
  └─ Toletus Lab        valida pelos critérios, corrige o que veio errado e fecha os pontos
       ├─ reprova       chamado duplicado ou pedido indevido → encerrado
       └─ Gestão        confere; pode alterar a pontuação com justificativa
            ├─ devolve ao Lab   volta para a fila de validação e passa de novo pelo check
            ├─ reprova
            └─ confirma  pontos entram no extrato
                 └─ Logística/Faturamento   NF, etiqueta e rastreio
                      └─ Envio/Coleta        embalagem e postagem
                           └─ Toletus Lab    em trânsito → entregue → em acompanhamento → concluído
```

A solicitação nunca volta para o analista. Se algum dado veio errado, o Lab corrige (`labCorrect`)
e desmarca o critério correspondente: a pontuação passa a refletir a qualidade do que o analista
enviou, sem travar o chamado. `qualityMetrics` mede exatamente esses campos corrigidos.

O `Toletus Lab` é um perfil operacional (`PIECES_OPERATION_ROLES`), com login pelo acesso
operacional e abas próprias — validação, acompanhamento, ocorrências e concluídos.

Os pontos só entram no extrato no `confirma` da gestão. O Lab fecha `scoring.calculated`;
a gestão pode alterar `scoring.final`, e nesse caso a justificativa é obrigatória. Os dois
valores ficam gravados, com `reviewedBy` (Lab) e `approvedBy` (gestão).

`bootstrap()` migra os registros anteriores para `flowVersion: 3` de forma idempotente:
o que estava em `pending_review` ou `correction_requested` entra na fila do Lab, com um evento
`flow_migrated` explicando a mudança. Nada é apagado.

## Aplicação no Supabase

1. Faça backup do projeto Supabase e da linha `rankpro_store/global_store`.
2. Aplique `supabase/migrations/202608100001_performance_platform.sql` pelo fluxo de migrations do projeto.
3. Publique a Edge Function `invite-performance-user`.
4. Defina `SITE_URL` e inclua as URLs de login/recuperação nas Redirect URLs do Supabase Auth.
5. No painel do Supabase, abra **Authentication → Users → Add user** e crie o
   primeiro acesso administrativo. Para a ficha de João Gabriel, use
   `jg@actuar.com`; o trigger vincula essa conta à ficha `jo_o_gabriel_nr3` sem
   duplicá-la. Defina a senha somente no Supabase Auth e marque o e-mail como
   confirmado quando esse for o procedimento interno aprovado.
6. A migration já classifica fichas com a função legada “Gestor Adm” como
   `administrator`. Confirme o status e a equipe em **Administração → Usuários e
   Equipes** depois do primeiro login.
7. Convide os demais usuários pela tela “Usuários e Equipes” e ative cada vínculo depois de conferir equipe, perfil e gestor.

A migration executa `import_legacy_profiles()` de forma idempotente. As 16 fichas
existentes em `rankpro_store.data.users` entram em `public.users` com nome, foto,
função, equipe, status e `legacy_user_key`. O backup não possui e-mails ou telefones;
por isso esses campos permanecem pendentes, sem valores inventados. Na tela
“Usuários e Equipes”, use “Ativar acesso” para informar o e-mail corporativo e
vincular o convite do Supabase Auth à ficha histórica, em vez de criar outra ficha.

Se outro e-mail for escolhido para o primeiro administrador, este é o ajuste de
bootstrap a executar manualmente uma única vez no SQL Editor:

```sql
update public.users
set status = 'active',
    role_id = (select id from public.roles where code = 'administrator')
where corporate_email = 'administrador@actuar.com';
```

Não há service role no frontend. `SUPABASE_SERVICE_ROLE_KEY` existe somente no ambiente isolado da Edge Function.

## Compatibilidade e migração do legado

- Cada ficha importada já recebe sua chave antiga em `users.legacy_user_key` (`dyego`, `lucas`, etc.).
- O dashboard e o ranking continuam calculando as métricas históricas do JSON.
- Créditos novos de prioridade e transferência vêm de `point_ledger` e são somados somente depois de confirmados.
- Não copie solicitações aprovadas antigas para o extrato sem uma conciliação prévia: isso duplicaria pontos que já estejam representados em `rankpro_store.logs`.
- Para a migração histórica definitiva, exporte o backup JSON existente, reconcilie chaves de usuário/ciclo e importe solicitações e créditos com IDs de origem idempotentes. Até essa conciliação, o JSON é preservado, mas não recebe novas solicitações oficiais.
- Depois da conferência de todos os ciclos históricos, o cálculo legado pode ser substituído pelos snapshots de ciclo e pelo extrato sem alterar as telas.

## Execução local

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Acesse `http://127.0.0.1:8000`. Não há dependência obrigatória de npm em produção. Node é usado apenas para verificações locais:

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

## Integração futura com Actask

O ponto de integração é `auth_user_id`/`corporate_email`, sem depender das chaves antigas. Um futuro SSO do Actask deve emitir ou federar a sessão Supabase, mantendo `public.users` como perfil operacional. Regras, solicitações, decisões e extrato não precisam ser reconstruídos.

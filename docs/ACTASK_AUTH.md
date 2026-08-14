# Autenticação do Actuar Classifique pelo Actask

## Contrato usado

O Actuar usa o cliente público do Actask e o fluxo de login direto na própria
tela. Não existe `client_secret` no frontend.

| Finalidade | Método | Stage | Main |
| --- | --- | --- | --- |
| Login | `POST /oauth/login` | `https://actaskapistage.bluefronte.com/oauth/login` | `https://actaskapi.bluefronte.com/oauth/login` |
| Identidade | `GET /oauth/userinfo` | `https://actaskapistage.bluefronte.com/oauth/userinfo` | `https://actaskapi.bluefronte.com/oauth/userinfo` |
| Refresh rotativo | `POST /oauth/token` | `https://actaskapistage.bluefronte.com/oauth/token` | `https://actaskapi.bluefronte.com/oauth/token` |
| Logout/revogação | `POST /oauth/revoke` | `https://actaskapistage.bluefronte.com/oauth/revoke` | `https://actaskapi.bluefronte.com/oauth/revoke` |

O payload do login envia `client_id`, `redirect_uri`, `email`, `password`,
`scope: "openid profile"` e `audience: "actask-public-api"`. A senha é usada
somente na requisição e nunca é persistida ou registrada.

## Ativação

O shell já contém uma configuração stage segura por padrão, mas o stage fica
desabilitado até receber o `clientId` público cadastrado. Configure antes da
publicação:

```js
window.ACTASK_AUTH_CONFIG = {
    enabled: true,
    environment: 'stage',
    issuer: 'https://actaskapistage.bluefronte.com',
    clientId: '<client público stage>',
    redirectUri: '<redirect URI exata cadastrada>',
    audience: 'actask-public-api',
    scopes: ['openid', 'profile']
};
```

Para main, troque o issuer para `https://actaskapi.bluefronte.com` e use
`actuar-classifique-main-login` com a redirect URI de produção
`https://actuarclassifique.vercel.app/`.

## Identidade e permissões

O `sub` retornado pelo Actask é a chave canônica. O Actuar cria uma projeção de
compatibilidade no store histórico, sem substituir os registros antigos. O
modo da aplicação é derivado nesta ordem:

1. `Gestor Adm` → Modo Gestão;
2. uma das roles da Operação de peças → Acesso operacional;
3. uma role de analista → modo analista.

Se o usuário tiver mais de uma role funcional, a Operação de peças usa a união
das permissões. Os nomes `Analista`, `Gestão` e `Operacional` são categorias de
equipe do Actask e são ignorados como roles funcionais.

## Limite atual do diretório

`GET /oauth/userinfo` identifica o usuário autenticado, mas não lista todas as
pessoas da organização. O Actask stage também não libera `users:read` para o
cliente público atual. Por isso, a autenticação foi migrada sem inventar uma
listagem remota: a aplicação associa o usuário que entrou à projeção histórica.

Para substituir completamente a administração/listagem de pessoas, o Actask
precisa publicar um endpoint de diretório próprio, com escopo de leitura
específico e autorização por equipe. Esse endpoint deverá ser consumido por um
backend/BFF ou sincronizado por uma rotina protegida; `client_credentials` não
deve ser usado diretamente no browser.

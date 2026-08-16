# Autenticação do Actuar Classifique pelo Actask

## Fluxo atual de seleção

O Actuar carrega a tela de login a partir do diretório público do Actask. O
usuário escolhe uma equipe e, em seguida, um usuário daquela equipe. E-mail,
senha e outros dados sensíveis não são retornados pelo diretório; a senha só é
enviada na validação selecionada e nunca é persistida no navegador.

| Finalidade | Método | Stage | Main |
| --- | --- | --- | --- |
| Equipes e usuários para o login | `GET /auth/login-options` | `https://actaskapistage.bluefronte.com/auth/login-options` | `https://actaskapi.bluefronte.com/auth/login-options` |
| Login de equipe interna | `POST /auth/login-selected` | `https://actaskapistage.bluefronte.com/auth/login-selected` | `https://actaskapi.bluefronte.com/auth/login-selected` |
| Login conectado de equipe externa | `POST /auth/login-selected-external` | `https://actaskapistage.bluefronte.com/auth/login-selected-external` | `https://actaskapi.bluefronte.com/auth/login-selected-external` |
| Troca do código PKCE | `POST /oauth/token` | `https://actaskapistage.bluefronte.com/oauth/token` | `https://actaskapi.bluefronte.com/oauth/token` |
| Identidade e equipes do usuário | `GET /oauth/userinfo` | `https://actaskapistage.bluefronte.com/oauth/userinfo` | `https://actaskapi.bluefronte.com/oauth/userinfo` |

O corpo das duas validações selecionadas é:

```json
{
    "user_id": "<id do usuário escolhido>",
    "team_id": "<id da equipe escolhida ou null>",
    "password": "<senha>"
}
```

Para uma equipe externa, o Actuar acrescenta os parâmetros públicos do fluxo
OAuth/PKCE ao mesmo `POST`:

```json
{
    "user_id": "<id do usuário escolhido>",
    "team_id": "<id da equipe escolhida>",
    "password": "<senha>",
    "client_id": "actuar-classifique-stage-login",
    "redirect_uri": "https://actuarclassifique.vercel.app/",
    "response_type": "code",
    "scope": "openid profile",
    "state": "<valor aleatório>",
    "code_challenge": "<SHA-256 do code_verifier em base64url>",
    "code_challenge_method": "S256",
    "audience": "actask-public-api"
}
```

O endpoint valida a equipe, o usuário e a senha e devolve um `redirect_url`
com um código OAuth de uso único. O Actuar troca esse código por tokens em
`/oauth/token`, consulta `/oauth/userinfo` e mantém a identidade limitada à
equipe escolhida. Nenhum access token, refresh token ou senha é colocado na
URL.

O Actuar escolhe o endpoint pela propriedade `login_target` da equipe. Para
`actask`, usa o login interno; para `external`, usa a validação externa. A
resposta interna pode trazer `session_token` e o usuário serializado. A
Para compatibilidade, o endpoint externo ainda aceita o corpo antigo sem os
parâmetros OAuth e retorna somente `{"authenticated": true}`. O Actuar usa o
corpo OAuth acima, que retorna o `redirect_url` para concluir o login conectado.

O adaptador ainda mantém o fluxo OAuth público (`/oauth/login`,
`/oauth/userinfo`, `/oauth/token` e `/oauth/revoke`) para compatibilidade com a
integração anterior e eventual fallback explícito. Ele não é o fluxo exibido
quando o diretório selecionável está configurado.

## Ativação

O shell já contém uma configuração stage segura por padrão. O seletor de
equipes não depende de `clientId`; esse campo só é necessário se o fallback
OAuth for utilizado. Configure o issuer conforme o ambiente:

```js
window.ACTASK_AUTH_CONFIG = {
    enabled: true,
    environment: 'stage',
    issuer: 'https://actaskapistage.bluefronte.com',
    clientId: 'actuar-classifique-stage-login',
    audience: 'actask-public-api',
    scopes: ['openid', 'profile']
};
```

Para main, troque o issuer para `https://actaskapi.bluefronte.com` e use
`actuar-classifique-main-login`. O cliente público deve estar registrado no
Actask com a redirect URI exata `https://actuarclassifique.vercel.app/`.

No Stage, o backend precisa estar com `AUTH_EXTERNAL_ENABLED=true`, possuir
`AUTH_OIDC_SIGNING_SECRET` configurado somente no servidor e ter o cliente
`actuar-classifique-stage-login` registrado. O workflow de Stage registra esse
cliente idempotentemente.

## Identidade e permissões

O `sub` retornado pelo Actask é a chave canônica. O Actuar cria uma projeção de
compatibilidade no store histórico, sem substituir os registros antigos. O
modo da aplicação é derivado nesta ordem:

1. `Gestor Adm` → Modo Gestão;
2. uma das roles da Operação de peças → Acesso operacional;
3. `team_type: analyst` ou uma role de analista → modo analista;
4. `team_type: management` ou `team_type: operational` → o modo correspondente.

Se o usuário tiver mais de uma role funcional, a Operação de peças usa a união
das permissões. Os nomes `Analista`, `Gestão` e `Operacional` são categorias de
equipe do Actask e são ignorados como roles funcionais.

## Equipes e roles funcionais

`team_type` classifica a tela principal como `Analista`, `Gestão` ou
`Operacional`; não é uma role de negócio. As permissões da Operação de peças
vêm de `functional_roles` no usuário/equipe retornado pelo Actask. O campo
`role` presente no item do diretório é apenas o papel de associação à equipe e
não deve ser convertido automaticamente em permissão.

O código OAuth do login conectado consulta `/oauth/userinfo` com escopo
`openid profile`. Essa resposta inclui as equipes ativas do usuário e as
`functional_roles` de cada vínculo; por isso o Actuar consegue selecionar o
modo e liberar as telas de peças conforme a equipe e as funções efetivas.

O diretório de login também não substitui a administração completa de usuários.
Para telas administrativas, o Actask ainda precisa fornecer endpoint e escopo
de leitura próprios; `client_credentials` não deve ser usado diretamente no
navegador.

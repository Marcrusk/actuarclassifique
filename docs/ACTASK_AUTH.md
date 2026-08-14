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
| Validação de equipe externa | `POST /auth/login-selected-external` | `https://actaskapistage.bluefronte.com/auth/login-selected-external` | `https://actaskapi.bluefronte.com/auth/login-selected-external` |

O corpo das duas validações selecionadas é:

```json
{
    "user_id": "<id do usuário escolhido>",
    "team_id": "<id da equipe escolhida ou null>",
    "password": "<senha>"
}
```

O Actuar escolhe o endpoint pela propriedade `login_target` da equipe. Para
`actask`, usa o login interno; para `external`, usa a validação externa. A
resposta interna pode trazer `session_token` e o usuário serializado. A
resposta externa atualmente usada no stage retorna somente
`{"authenticated": true}` e não cria uma sessão do Actask.

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
    clientId: '',
    audience: 'actask-public-api',
    scopes: ['openid', 'profile']
};
```

Para main, troque o issuer para `https://actaskapi.bluefronte.com`. Se o
fallback OAuth for habilitado, use `actuar-classifique-main-login` e a redirect
URI de produção `https://actuarclassifique.vercel.app/`.

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

No stage, `/auth/login-selected-external` não retorna o usuário serializado nem
as roles funcionais. Assim, um login externo de equipe analista consegue ser
classificado pelo `team_type`, mas o Actuar recusa uma equipe operacional sem
roles funcionais para evitar liberar a operação indevidamente. Para liberar
esse cenário, o Actask deve incluir o usuário/roles na resposta externa ou
fornecer uma sessão/endpoint autenticado que permita recuperar a identidade da
seleção.

O diretório de login também não substitui a administração completa de usuários.
Para telas administrativas, o Actask ainda precisa fornecer endpoint e escopo
de leitura próprios; `client_credentials` não deve ser usado diretamente no
navegador.

# Piloto da TOMAZ BARBER no Cloudflare

O PR #7 foi revisado e integrado à `main` em `3dd0a74`, com 123 testes de API e 17 de navegador aprovados no último commit. A preparação do piloto parte dessa versão.

**Estado atual: preparado e validado localmente; ainda não publicado.** `wrangler whoami` informou que não há autenticação Cloudflare neste ambiente, e não há token ou Account ID configurados. O comando de deploy parou antes de criar recursos remotos. Por isso, ainda não existem links HTTPS nem QR Code remoto que possam ser entregues como funcionais.

## Recursos e proteção do ambiente de teste

| Item | Piloto |
| --- | --- |
| Worker | `tomazbarber-piloto`, em um subdomínio `workers.dev` da conta autorizada |
| D1 | `tomazbarber-piloto`, com UUID próprio criado na conta |
| Configuração | `wrangler.pilot.json`; configuração remota efetiva gerada em `work/pilot/wrangler.remote.json` |
| Estabelecimento | Somente TOMAZ BARBER; Aurora continua nas suítes locais anteriores |
| Dados | Dois clientes fictícios e um atendimento histórico fictício sem pagamento; nenhuma importação de dados reais |
| WhatsApp automático | `WHATSAPP_MODE=off`, sem remetente, binding Meta ou cron |
| Hub | Senha aleatória exclusiva do piloto, enviada como secret; nenhum valor no Git |
| Indexação | Páginas do piloto enviam `X-Robots-Tag: noindex, nofollow, noarchive` |

Não existe configuração de produção nesta entrega. O piloto não usa o D1 local de desenvolvimento, não aponta para um futuro banco de produção e não cria domínio oficial. A senha do hub, token Cloudflare, configuração efetiva e arquivos privados ficam em `work/`, ignorado pelo Git. O QR contém só o link público de agendamento; nunca senha ou link privado de reserva.

## Etapa exata que precisa de acesso à conta

O acesso é necessário **antes de criar o D1 remoto `tomazbarber-piloto`**. Depois disso, a mesma autenticação aplica as migrações/carga fictícia e publica o Worker de teste.

1. No Cloudflare, abra [API Tokens](https://dash.cloudflare.com/profile/api-tokens) e crie um token restrito à conta que receberá o piloto, com permissões de conta **Workers Scripts: Edit**, **D1: Edit** e **Account Settings: Read**. Não é necessário fornecer a Global API Key ou permissões de domínio de produção.
2. Configure `CLOUDFLARE_API_TOKEN` como **segredo privado do ambiente Codex** e `CLOUDFLARE_ACCOUNT_ID` como variável da conta (32 caracteres hexadecimais). Não cole o token em chat, issue, PR, arquivo versionado ou comando com valor literal.
3. Alternativa ao token: faça `wrangler login` num terminal autorizado e mantenha o Account ID configurado. Neste ambiente, preserve o mesmo `XDG_CONFIG_HOME` usado no login e no deploy. Se for o primeiro Worker da conta, configure antes o subdomínio `workers.dev` no painel Workers & Pages.

Após disponibilizar o acesso, executar:

```sh
npm ci
npm run pilot:prepare
npm run pilot:deploy
```

`pilot:deploy` confere o nome do ambiente, procura/cria somente o D1 de teste, grava sua configuração efetiva, faz build, aplica as migrações/carga fictícia e usa `--secrets-file` para publicar a senha junto com o Worker. Não redefine registros existentes. Só gera links e QR depois de obter a URL real do deploy e conferir o cabeçalho de piloto e o catálogo sem remetente de verificação.

Arquivos entregáveis após sucesso:

- `work/pilot/links.json`: links reais de agendamento e hub.
- `work/pilot/qr-agendamento.png`: PNG de 1024 pixels com o link real de agendamento.
- `work/pilot/secrets.json`: senha privada do hub; entregar somente ao proprietário/barbeiro, fora do repositório público.

Se o deploy terminar mas a conferência da URL falhar, confirmar a origem no painel e executar `npm run pilot:links -- https://<origem-real-do-worker>`. O script recusa origem de outro Worker, HTTP ou URL não publicada como piloto. Os scripts nunca usam `wrangler deploy --temporary` nem uma conta temporária alheia à conta autorizada.

## Validação local reproduzível

```sh
npm run check
CHROMIUM_PATH=/usr/bin/chromium npm run test:pilot
npm run pilot:dry-run
```

O teste do piloto usa a configuração sem Meta na porta 8789, duas sessões de navegador independentes e um banco descartável em `work/pilot-test/state`. O comando reinicia **somente esse banco de teste**, sem tocar em `work/pilot/state` ou no D1 remoto. No ambiente restrito, configure `XDG_CONFIG_HOME` e `WRANGLER_LOG_PATH` dentro de `work/` para comandos Wrangler executados diretamente; o script do piloto faz isso automaticamente.

`pilot:dry-run` valida o pacote e os bindings sem publicar ou criar D1. O UUID do arquivo versionado é um marcador exclusivo para teste local/dry-run, e o deploy automatizado exige um UUID remoto real antes de aplicar migrações.

| Fluxo pedido | Conferência no navegador local | Ainda pendente |
| --- | --- | --- |
| 1. Instalar hub e entrar | Manifesto standalone, instruções de instalação e login do hub | Instalação real no Android/Chrome e iPhone/Safari, usando HTTPS do piloto |
| 2. QR → corte → agenda | PNG baixado e decodificado; segunda sessão abre o destino, reserva, e o hub consulta a confirmação | Câmera de outro celular escanear o QR remoto e conferir o hub do barbeiro |
| 3. Link privado → remarcação | Reserva remarcada pelo próprio link; atualizar hub mostra destino ocupado e origem livre | Repetir nos dois aparelhos com a URL publicada |
| 4. Concluir → receber → dia/mês | Atendimento histórico fictício concluído; pagamento de R$ 30,00 registrado e conferido nos totais de hoje/mês | Aguardar o início do corte recém-reservado e concluir **essa mesma reserva** no piloto remoto |
| 5. Cancelar segunda reserva | Segundo link privado cancela; API de disponibilidade devolve o horário e hub preserva o cancelamento | Repetir nos celulares físicos |

O teste não antecipa o relógio da aplicação nem permite concluir atendimento futuro. A conclusão e o pagamento usam o atendimento histórico fictício para validar o caixa imediatamente. A execução sequencial da mesma reserva depende de chegar seu horário; essa limitação é registrada em vez de alterar a regra do produto.

No teste local, não houve requisição Graph/Meta nem solicitação de código. Nenhuma câmera física ou instalação de sistema operacional foi simulada como realizada. A validação remota e os arquivos HTTPS/QR ficam pendentes do acesso à conta.

## Roteiro nos aparelhos, antes de divulgar

1. No celular do barbeiro, abrir o hub HTTPS, entrar com a senha privada e instalar pelo Chrome ou Safari conforme as instruções. Abrir pelo ícone e conferir agenda e reconexão.
2. Em outro celular, escanear o QR entregue. Reservar um corte com nome e celular **fictícios**, guardar o link privado e atualizar a agenda do barbeiro. Para testar remarcação pelo cliente, escolher atendimento com pelo menos duas horas de antecedência.
3. Abrir o link privado, escolher outro horário e confirmar. Atualizar o hub e conferir que o horário antigo ficou disponível.
4. Após começar o horário do atendimento, concluir no hub. Conferir que ainda aparece sem recebimento; registrar valor, data e forma e conferir hoje/mês. Não realizar pagamento real neste piloto.
5. Criar uma segunda reserva futura, cancelar pelo link privado e conferir a devolução da faixa. Para cancelamento autônomo, manter pelo menos duas horas de antecedência.

O link não deve ser divulgado a clientes reais antes da revisão do proprietário. O PR #5 continua adiado, limitado a confirmação de agendamento e lembrete de dez minutos, com atualização na remarcação e remoção no cancelamento.

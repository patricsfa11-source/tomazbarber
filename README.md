# TOMAZ BARBER

Sistema de agendamento com dados separados por estabelecimento. A TOMAZ BARBER é o primeiro estabelecimento e mantém seu visual escuro, logo, busca e catálogo atual. O Salão Aurora é uma segunda unidade fictícia para testar isolamento. Os clientes reservam pelo navegador do celular; cada estabelecimento gerencia a própria agenda e clientes no seu painel.

## Documentação

- [Briefing do produto](docs/briefing.md) — serviços, agenda, WhatsApp, recebimentos e identidade visual.
- [Plano técnico](docs/plano-tecnico.md) — arquitetura proposta, etapas e testes de aceite.
- [Separação por estabelecimento](docs/estabelecimentos.md) — links, acesso, migração e validação do isolamento.
- [Gestão de agenda](docs/gestao-agenda.md) — expediente editável, bloqueios por canal, reservas afetadas, remarcação, cancelamento e preparação dos lembretes.

## Primeira etapa implementada

- `/s/tomaz-barber`: catálogo dos sete serviços, datas e horários por turno, nome e celular, revisão e confirmação na tela.
- `/s/tomaz-barber/hub`: login administrativo, agenda diária, clientes e encaixe manual.
- `/s/salao-aurora` e `/s/salao-aurora/hub`: catálogo, expediente e painel próprios do salão fictício.
- `/` e `/hub` continuam como atalhos exclusivos da TOMAZ BARBER.
- API TypeScript em Cloudflare Workers; persistência em D1/SQLite com migração versionada.
- Expediente da TOMAZ de segunda a sábado, 7h30–20h; Aurora de terça a sábado, 9h–18h, ambos em `America/Bahia`. Inícios de 10 em 10 minutos, duração completa dentro do expediente próprio e horizonte inicial de 90 dias.
- Proteção contra sobreposição no banco e reenvio idempotente da mesma solicitação. A reserva preserva nome, duração e preço anunciado do serviço.
- **Configurar agenda** no hub: semana, pausas, horários especiais por data/período, faixas ocultas só no link e bloqueios nos dois canais. As alterações têm prévia e preservam as reservas confirmadas afetadas.
- **Remarcar**, **Cancelar** e **Ver histórico** na agenda. A remarcação ocupa o novo horário antes de liberar o antigo; o cancelamento libera a faixa e mantém o registro.

## Executar localmente

Requer Node.js 22.12 ou posterior e npm. Não é necessário login na Cloudflare para executar o ambiente local.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Edite ADMIN_PASSWORDS em .dev.vars: uma senha diferente por slug, com 20 a 200 caracteres.
npm run db:migrate
npm run db:seed
npm run dev
```

Abra `http://localhost:8787/s/tomaz-barber` e `http://localhost:8787/s/salao-aurora`. Acrescente `/hub` ao link de cada estabelecimento para entrar no painel com a senha correspondente em `.dev.vars`. O arquivo é ignorado pelo Git. O seed adiciona João Exemplo na TOMAZ e Maria Exemplo no Aurora às 9h de uma próxima data em que ambos abrem. Pode ser repetido sem duplicar reservas. Utilize apenas nomes e telefones fictícios.

Na atualização de uma base existente, `0002_establishments.sql` preserva as reservas, IDs, preços e durações históricas e associa os registros antigos à TOMAZ. As sessões antigas são encerradas porque não indicavam o estabelecimento. `ADMIN_PASSWORD` continua aceito somente para a TOMAZ quando o novo mapa `ADMIN_PASSWORDS` não está configurado. Nesse caso, o painel do Aurora fica indisponível até receber configuração própria.

O banco de desenvolvimento fica em `.wrangler/`. O ID em `wrangler.jsonc` é um marcador local; não aponta para banco de produção. Não há script de publicação nem configuração de produção. Depois de alterar o frontend, execute novamente `npm run dev` para reconstruir os arquivos; o Wrangler recarrega alterações da API.

Se o ambiente restringir gravações na pasta pessoal, use `npm ci --cache /workspace/.npm-cache` e configure `XDG_CONFIG_HOME` e `WRANGLER_LOG_PATH` para diretórios graváveis dentro de `work/`.

## Validar

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

`check` executa TypeScript, build e 74 testes da API no runtime Workers com D1 local. A suíte cobre migração, isolamento, conflitos de reserva e remarcação, cancelamento, histórico, lembretes, expediente, pausas, exceções, regras por canal e prévias protegidas contra alterações concorrentes.

O Playwright inicia seu próprio servidor na porta 8788, usa senhas fictícias diferentes para os dois estabelecimentos e recria apenas `work/e2e/`. Não acessa o banco de desenvolvimento. Os nove testes exercitam os fluxos anteriores e a gestão da agenda, incluindo configurações em telas de 320 e 390 pixels. Para usar Chromium já instalado, defina `CHROMIUM_PATH` com o caminho do executável. Capturas de execução ficam em `work/`; as [prévias para revisão](docs/previas-agenda/README.md) são uma seleção versionada.

## Decisões de implementação

Uma inserção em `appointments` dispara o trigger atualizado em `migrations/0002_establishments.sql`, que ocupa todos os segmentos de 10 minutos. A chave primária de `occupied_segments` inclui estabelecimento, profissional e início. Assim, os salões podem atender no mesmo horário. Dentro do mesmo salão e profissional, um segmento ocupado desfaz a instrução inteira. A criação do cliente e da reserva ocorre em um `DB.batch` transacional; uma tentativa rejeitada também não deixa um cliente criado pela metade. O teste usa o próprio D1 local, não um banco simulado pela aplicação.

Cada confirmação leva uma chave aleatória de solicitação, única dentro do estabelecimento. Reenvios com a mesma chave e os mesmos dados retornam a reserva já criada; a mesma chave com dados diferentes recebe conflito. A interface mantém a chave após falha de rede para permitir tentar novamente. Serviços, preços e duração vêm do catálogo daquele estabelecimento no banco, sem confiar em valores enviados pelo navegador.

O hub exige sessão vinculada ao estabelecimento no servidor, com cookie HttpOnly, SameSite Strict e Secure em HTTPS, expiração de 8 horas, revogação no logout e limite de tentativas de senha por estabelecimento e IP. Cookies têm caminhos distintos, permitindo abrir os dois painéis no mesmo navegador. A API também confere o vínculo da sessão, inclusive se um cookie for copiado manualmente. Operações de escrita verificam a origem. Rotas públicas não oferecem listagem de clientes, consulta por telefone ou histórico. A reserva pública retorna somente o comprovante daquele pedido, sem nome e telefone.

## Identidade visual

A logo original está em `public/tomaz-barber-logo.jpg` e aparece no cabeçalho compartilhado entre agendamento e hub. O arquivo foi preservado; o enquadramento é feito pelo CSS. Veja as [capturas em tela de celular](docs/previas/README.md), com aprovação visual do proprietário pendente.

## Pendências das próximas etapas

Verificação do telefone, acesso do cliente a Meus horários, PWA, financeiro, notificações e gestão de equipes continuam nas próximas etapas. O hub já consulta o histórico por data e faz remarcações e cancelamentos; essas ações ainda não são públicas para o cliente.

WhatsApp e publicação ficam para as etapas seguintes. Neste ambiente, a confirmação aparece somente na tela, sem enviar mensagens. Criações, remarcações e cancelamentos já registram histórico, estado desejado do lembrete e eventos duráveis para a futura integração. Não há cobrança automática. A configuração real de acesso, proteção contra abuso da API pública e o piloto com o barbeiro devem ser preparados antes de divulgar um link.

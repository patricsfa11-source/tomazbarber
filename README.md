# TOMAZ BARBER

Sistema de agendamento e gestão para uma barbearia com um profissional. Os clientes reservam pelo navegador do celular. O barbeiro gerencia a mesma agenda em um hub privado.

## Documentação

- [Briefing do produto](docs/briefing.md) — serviços, agenda, WhatsApp, recebimentos e identidade visual.
- [Plano técnico](docs/plano-tecnico.md) — arquitetura proposta, etapas e testes de aceite.

## Primeira etapa implementada

- `/`: catálogo dos sete serviços, datas e horários por turno, nome e celular, revisão e confirmação na tela.
- `/hub`: login administrativo, agenda diária e encaixe manual na mesma base.
- API TypeScript em Cloudflare Workers; persistência em D1/SQLite com migração versionada.
- Expediente de segunda a sábado, 7h30–20h, `America/Bahia`. Inícios de 10 em 10 minutos, duração completa dentro do expediente e horizonte inicial de 90 dias.
- Proteção contra sobreposição no banco e reenvio idempotente da mesma solicitação. A reserva preserva nome, duração e preço anunciado do serviço.

## Executar localmente

Requer Node.js 22.12 ou posterior e npm. Não é necessário login na Cloudflare para executar o ambiente local.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Edite ADMIN_PASSWORD em .dev.vars (mínimo de 20 caracteres).
npm run db:migrate
npm run db:seed
npm run dev
```

Abra `http://localhost:8787` e `http://localhost:8787/hub`. O hub usa a senha configurada em `.dev.vars`. O arquivo é ignorado pelo Git. O seed adiciona João Exemplo em um próximo dia útil e pode ser repetido sem duplicar a reserva. Utilize apenas nomes e telefones fictícios.

O banco de desenvolvimento fica em `.wrangler/`. O ID em `wrangler.jsonc` é um marcador local; não aponta para banco de produção. Não há script de publicação nem configuração de produção. Depois de alterar o frontend, execute novamente `npm run dev` para reconstruir os arquivos; o Wrangler recarrega alterações da API.

Se o ambiente restringir gravações na pasta pessoal, use `npm ci --cache /workspace/.npm-cache` e configure `XDG_CONFIG_HOME` e `WRANGLER_LOG_PATH` para diretórios graváveis dentro de `work/`.

## Validar

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

`check` executa TypeScript, build e os testes da API no runtime Workers com D1 local. A suíte cobre conflitos simultâneos no mesmo início, inícios distintos e canais distintos; rollback completo; reenvio; reservas adjacentes; limites do expediente; validações e proteção administrativa.

O Playwright inicia seu próprio servidor na porta 8788, usa senha fictícia exclusiva dos testes e recria apenas `work/e2e/`. Não acessa o banco de desenvolvimento. Exercita reserva pelo celular, encaixe no hub, atualização após conflito e telas de 320, 390 e 1440 pixels. Para usar Chromium já instalado, defina `CHROMIUM_PATH` com o caminho do executável. Capturas ficam em `work/` e não são versionadas.

## Decisões de implementação

Uma inserção em `appointments` dispara o trigger de `migrations/0001_agenda.sql`, que ocupa todos os segmentos de 10 minutos. `occupied_segments.starts_at` é chave primária global para o único barbeiro. Se qualquer segmento estiver ocupado, a instrução inteira é desfeita, incluindo a reserva e os segmentos já inseridos pelo trigger. Assim, dois pedidos sobrepostos geram um `201` e um `409`, mesmo que ambos tenham consultado o horário livre. O teste usa o próprio D1 local, não um banco simulado em memória pela aplicação.

Cada confirmação leva uma chave aleatória de solicitação. Reenvios com a mesma chave e os mesmos dados retornam a reserva já criada; a mesma chave com dados diferentes recebe conflito. A interface mantém a chave após falha de rede para permitir tentar novamente. Serviços, preços e duração vêm do servidor, sem confiar em valores enviados pelo navegador.

O hub exige sessão armazenada no servidor, com cookie HttpOnly, SameSite Strict e Secure em HTTPS, expiração de 8 horas, revogação no logout e limite de tentativas de senha. Operações de escrita verificam a origem. Rotas públicas não oferecem listagem de clientes, consulta por telefone ou histórico. A reserva pública retorna somente o comprovante daquele pedido, sem nome e telefone.

## Pendências das próximas etapas

Logo original: não consta no repositório. A marca na interface é texto provisório, explicitamente indicado no código. Ao receber o arquivo original, adicione-o em `public/` e substitua `brand()` em `src/client/main.ts`, preservando o texto alternativo.

Gestão de expediente e pausas, exceções, bloqueios, faixas ocultas só no link, cancelamento, remarcação, verificação do telefone, Meus horários, PWA, financeiro e notificações seguem a divisão do plano técnico. A agenda diária inicial navega entre hoje e os próximos 90 dias; consulta histórica fica para a gestão da agenda.

WhatsApp e publicação ficam para as etapas seguintes. Neste ambiente, a confirmação aparece somente na tela, sem enviar mensagens. As regras de chegada, tolerância, cancelamento e falta são exibidas para revisão; ainda não há ações de alteração ou cobrança. A configuração real de acesso, proteção contra abuso da API pública e o piloto com o barbeiro devem ser preparados antes de divulgar um link.

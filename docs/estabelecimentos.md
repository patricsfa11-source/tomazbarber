# Separação por estabelecimento

A TOMAZ BARBER mantém seu catálogo e agendamento atuais. O Salão Aurora é fictício e tem serviços, expediente, clientes, reservas e senha separados.

## Links locais

Com `npm run dev`, o servidor usa `http://localhost:8787`:

| Estabelecimento         | Agendamento       | Painel                |
| ----------------------- | ----------------- | --------------------- |
| TOMAZ BARBER            | `/s/tomaz-barber` | `/s/tomaz-barber/hub` |
| Salão Aurora (fictício) | `/s/salao-aurora` | `/s/salao-aurora/hub` |

`/` e `/hub` permanecem atalhos para a TOMAZ. A página pública de cada link carrega sua própria marca, catálogo e horários. O painel abre na agenda e oferece a aba Clientes. Um encaixe manual cria a reserva e o cadastro do cliente naquele estabelecimento, na mesma transação.

A TOMAZ oferece os sete serviços do briefing, de segunda a sábado, das 7h30 às 20h. O Aurora oferece corte e finalização (R$ 55,00, 60 minutos) e escova (R$ 40,00, 30 minutos), de terça a sábado, das 9h às 18h. O ID `corte` existe nos dois catálogos com nome, preço e duração diferentes, para verificar que o servidor consulta o catálogo correto.

## Acesso

Copie `.dev.vars.example` para `.dev.vars` e configure `ADMIN_PASSWORDS`, um JSON com uma senha diferente por slug. Os valores reais permanecem fora do repositório. O mapa deve conter uma senha de 20 a 200 caracteres para cada painel utilizado. JSON inválido, chave ausente ou senha inválida mantém o painel correspondente fechado. O mapa, quando presente, substitui a configuração antiga.

Para compatibilidade, `ADMIN_PASSWORD` funciona somente na TOMAZ quando `ADMIN_PASSWORDS` não existe. Nenhuma senha padrão é usada para liberar o outro estabelecimento. Não há cadastro de usuários, recuperação de senha ou interface de criação de estabelecimentos nesta entrega.

Cada sessão persistida inclui `shop_id`. Os cookies usam o caminho `/api/shops/<slug>/admin`. Ler, criar, listar ou consultar por ID exige uma sessão daquele estabelecimento. Copiar manualmente o cookie de outro salão continua resultando em `401`; consultar IDs de outro salão com uma sessão própria válida resulta em `404`. O limite de tentativas e o logout são independentes.

## Banco e API

`0002_establishments.sql` adiciona estabelecimentos, profissionais, catálogo, expediente semanal e clientes. Clientes têm telefone único dentro do estabelecimento. A mesma pessoa pode constar nos dois cadastros, com registros distintos. Uma reserva pública não renomeia um cadastro já existente só por informar o mesmo telefone; a reserva conserva seu próprio snapshot de nome e telefone.

Todas as consultas operacionais incluem `shop_id`. Chaves estrangeiras compostas impedem associar a uma reserva um cliente, serviço ou profissional de outro estabelecimento. O estabelecimento é resolvido pelo slug no servidor; campos `shopId`, `shop_id`, preço ou `customerId` enviados no corpo não alteram esse contexto.

As rotas canônicas são `/api/shops/<slug>/services`, `/availability`, `/bookings` e `/admin/...`. As rotas antigas `/api/services`, `/api/availability`, `/api/bookings` e `/api/admin/...` são aliases exclusivos da TOMAZ. Slug desconhecido retorna `404` e nunca cai no catálogo da TOMAZ. A API pública não lista clientes ou reservas; a interface administrativa consulta apenas os cadastros e agendamentos próprios.

A ocupação tem chave única `(shop_id, professional_id, starts_at)`. A inserção de uma reserva dispara o trigger que ocupa seus segmentos de 10 minutos. O `DB.batch` grava cliente e reserva atomicamente: qualquer colisão desfaz tudo. A chave de idempotência é única por estabelecimento, permitindo o mesmo valor em outro salão sem misturar confirmações.

Nesta entrega, cada estabelecimento tem um único profissional principal. A chave composta prepara o armazenamento para mais profissionais; seleção e gestão de equipes ficam para uma próxima entrega. O expediente de cada um vem do banco; sua edição e as ações sobre reservas foram adicionadas na [gestão de agenda](gestao-agenda.md).

## Migração e validação

Execute `npm run db:migrate` antes de iniciar a aplicação atualizada. A migração associa as reservas antigas à TOMAZ, preservando IDs, chaves de solicitação e snapshots de serviço, preço e duração. Cria clientes a partir dos telefones normalizados existentes e reconstrói todos os segmentos ocupados. Sessões antigas são encerradas por não terem vínculo com um estabelecimento; o barbeiro precisa entrar novamente.

`npm run db:seed` carrega o estabelecimento fictício de `fixtures/0001_salao_aurora.sql` e insere exemplos nas duas unidades, às 9h de uma próxima data em que ambas abrem. O comando é somente local e pode ser repetido sem duplicar reservas. A migração foi aplicada sobre a base local anterior e o seed foi executado duas vezes. O Aurora fica apenas no fixture de desenvolvimento/testes; a migração definitiva cadastra somente a TOMAZ e preserva os dados antigos.

| Verificação                       | Resultado local                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| TypeScript e build                | Aprovados                                                                                      |
| API em Workers/D1                 | 50 testes aprovados, incluindo os 31 anteriores                                                |
| Navegador                         | 6 testes aprovados, incluindo os 3 fluxos anteriores                                           |
| Mesmo horário em dois salões      | Duas confirmações, mesmo com chave de solicitação e telefone iguais                            |
| Sobreposição dentro de cada salão | Uma confirmação e um conflito; nenhum segmento ou cliente órfão                                |
| Link versus encaixe               | Mesma proteção no banco dentro do estabelecimento                                              |
| Sessão ou ID do outro salão       | Acesso negado, sem exposição de nomes, telefones ou reservas                                   |
| Migração                          | IDs, snapshots e ocupação preservados na TOMAZ                                                 |
| Celular                           | Dois catálogos e painéis verificados em 320 e 390 pixels; fluxo anterior também em 1440 pixels |

Para repetir: `npm run check` e `npm run test:browser`. O Playwright usa banco descartável em `work/e2e/`, separado da base de desenvolvimento, e senhas fictícias por estabelecimento. O teste do painel prepara seus próprios dados, sem depender do teste do catálogo. Capturas de cada unidade ficam em `work/`.

A evolução de expediente, disponibilidade, remarcações e cancelamentos está em [Gestão de agenda](gestao-agenda.md). WhatsApp, publicação, verificação de telefone e financeiro continuam para as próximas etapas.

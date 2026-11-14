# Gestão de agenda por estabelecimento

O hub permite remarcar e cancelar reservas, editar a semana e as pausas, criar horários especiais e restringir faixas por canal. A página pública mantém o visual escuro e o catálogo atual. Nenhuma ação de gestão foi aberta ao cliente; esse acesso continua dependente da verificação do telefone.

## Usar no celular

Entre em `/s/tomaz-barber/hub` ou `/s/salao-aurora/hub`. Na agenda, cada reserva confirmada tem **Remarcar**, **Cancelar** e **Ver histórico**. O filtro **Histórico** inclui os cancelados na data selecionada e permite consultar datas passadas.

Em **Configurar agenda**, há três áreas:

- **Semana:** dias abertos, abertura, fechamento e até oito pausas por dia. As pausas fecham os dois canais.
- **Horários especiais:** uma data ou período inclusivo, aberto com expediente e pausas próprios ou fechado. É possível abrir um domingo. Fora do período, volta o padrão semanal. Um período mais curto prevalece sobre um mais amplo; em períodos de mesma duração, vale o criado por último. Remover uma exceção restaura as demais regras aplicáveis.
- **Faixas e bloqueios:** intervalo diário dentro de uma data ou período. **Ocultar só no link** impede reservas públicas e mantém encaixes do hub dentro do expediente. **Bloquear link e hub** fecha ambos. **Reabrir faixa** remove aquela restrição, respeitando os outros bloqueios, pausas, expediente e reservas existentes.

Os horários usam passos de dez minutos e o fuso do estabelecimento. O serviço precisa caber por inteiro numa faixa contínua livre. Fechamento 00:00 representa o fim do dia. Exceções e restrições podem ser criadas para hoje e os próximos 90 dias.

As [capturas de celular](previas-agenda/README.md) mostram as três áreas com dados fictícios.

## Revisão das reservas afetadas

Todas as alterações de disponibilidade, inclusive remoções de regras, passam por uma prévia antes de salvar. A prévia lista as reservas confirmadas futuras que ficariam fora das regras propostas. Havendo reservas afetadas, a interface pede que o barbeiro confira a lista e confirme que quer preservá-las.

Salvar uma configuração muda a disponibilidade para novas reservas; não altera status, horários, segmentos ocupados ou lembretes das reservas existentes. Elas permanecem confirmadas e aparecem numa seção de atenção, com ações individuais para remarcar ou cancelar. Reservas anteriores pelo link são avaliadas pelo canal online; um encaixe manual continua válido numa faixa oculta só no link.

Configuração e agenda possuem revisões por estabelecimento/profissional. A prévia inclui um token vinculado ao comando, às revisões e às reservas afetadas. A gravação confere ambas as revisões dentro da transação. Se outra pessoa reservar, remarcar, cancelar ou editar a configuração antes da confirmação, a prévia precisa ser refeita. Isso também protege a corrida entre um bloqueio e uma nova reserva. Alterações em outro estabelecimento não invalidam a prévia.

## Remarcação e cancelamento

A remarcação mostra o horário atual e exige escolher e confirmar o novo. Mantém o identificador, o cliente, o serviço, o preço anunciado e a duração originais. Por ser uma ação autorizada no hub, pode usar faixas ocultas só no link, mas respeita pausas e bloqueios gerais. A origem inicial da reserva é mantida; o canal atual passa a ser manual.

Um único `UPDATE` versionado dispara os triggers: primeiro ocupa os segmentos novos, preservando os segmentos coincidentes da própria reserva, e depois libera os antigos. Se algum novo segmento estiver ocupado, a instrução inteira é revertida. O horário original, o histórico e o lembrete permanecem intactos. Reservas novas e remarcações disputam a mesma chave única no banco.

O cancelamento exige uma confirmação explícita no hub. Marca a reserva como `cancelled`, grava a data do cancelamento e libera seus segmentos na mesma operação. A reserva e os snapshots continuam no banco e no histórico; ela não é apagada. Reservas canceladas não podem ser reativadas ou remarcadas por esta API.

Cada alteração usa `expectedVersion` e uma chave de solicitação. A versão impede que duas ações simultâneas se sobrescrevam. Reenvios da mesma ação retornam seu resultado sem duplicar histórico ou notificações. O reenvio da criação de uma reserva já cancelada não a confirma novamente.

## Preparação para o WhatsApp

Não há envio de mensagens, agendador externo ou credenciais de WhatsApp nesta entrega. Os registros abaixo são gravados na mesma transação da reserva:

| Registro                | Função                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `booking_events`        | Histórico imutável de criação, remarcação e cancelamento, com versão e horários anterior/novo. |
| `appointment_reminders` | Estado desejado atual do lembrete, vinculado à versão da reserva.                              |
| `notification_outbox`   | Evento durável de criação, remarcação ou cancelamento, ainda em `pending_integration`.         |

Uma reserva com mais de dez minutos de antecedência tem lembrete desejado para `starts_at - 600`. Com dez minutos ou menos, fica `suppressed`, sem vencimento. Remarcar recalcula esse estado e substitui o vencimento anterior. Cancelar grava `cancelled` e remove o vencimento. Editar disponibilidade preserva os lembretes de reservas que continuam confirmadas, até uma decisão explícita sobre cada atendimento.

A futura integração deverá validar a versão e o status atuais antes do envio, atualizar ou cancelar a tarefa do provedor, ignorar eventos obsoletos e deduplicar por estabelecimento, reserva, versão e tipo. O envio, a confirmação pelo provedor e o tratamento de falhas de entrega permanecem para essa integração. A migração não cria notificações retroativas de confirmação.

## API e migração

Todas as rotas abaixo são privadas e ficam sob `/api/shops/<slug>/admin`:

| Método e rota                                  | Uso                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /schedule`                                | Configuração atual e reservas que precisam de atenção.                                                      |
| `POST /schedule/preview`                       | Recebe `command` e `expectedRevision`; retorna prévia e token.                                              |
| `POST /schedule/save`                          | Recebe `command`, `expectedRevision` e `previewToken`; salva atomicamente.                                  |
| `GET /availability?date=...&appointmentId=...` | Horários para remarcar aquela reserva, considerando sua duração histórica e ignorando sua própria ocupação. |
| `GET /bookings/:id`                            | Detalhes, histórico e estado desejado do lembrete em uma leitura consistente.                               |
| `POST /bookings/:id/reschedule`                | `startsAt`, `expectedVersion` e `requestKey`.                                                               |
| `POST /bookings/:id/cancel`                    | `expectedVersion` e `requestKey`.                                                                           |
| `GET /bookings?date=...&status=all`            | Agenda com cancelados; `confirmed` é o padrão.                                                              |

`0003_schedule_management.sql` preserva as reservas existentes como confirmadas, inicializa versões, histórico e estado desejado dos lembretes, e adiciona as regras de agenda. Não remove as sessões por estabelecimento. Execute `npm run db:migrate` antes de iniciar a versão atualizada. O fixture do Aurora e o seed local foram atualizados para a nova estrutura.

## Validação

Use `npm run check` e `npm run test:browser`. A validação utiliza apenas TOMAZ BARBER e Salão Aurora fictício em bases locais separadas das futuras bases reais.

- **74 testes de API/Workers/D1:** incluem os 50 anteriores e os casos de gestão. Cobrem conflito na remarcação sem perda do original, concorrência entre ações e novas reservas, cancelamento com liberação e histórico, idempotência, estado dos lembretes, semana e pausas, abertura excepcional no domingo, prioridade e expiração de exceções, faixa oculta, bloqueio geral, prévia desatualizada, corridas com edição e isolamento entre salões.
- **9 testes de navegador:** incluem os seis anteriores. Percorrem remarcação em conflito, remarcação bem-sucedida, cancelamento e histórico, prévia e preservação de reservas afetadas, encaixe em faixa oculta, bloqueio nos dois canais, expediente, pausas e domingo especial. As configurações foram verificadas em 320 e 390 pixels, mantendo as verificações anteriores de 1440 pixels.

Acesso do cliente às próprias reservas, gestão de equipes, recebimentos, WhatsApp e publicação continuam nas próximas etapas.

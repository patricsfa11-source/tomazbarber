# Recebimentos e relatórios

O PR #6 foi revisado e integrado à `main` em `6e4a66a`, depois de confirmar os testes do último commit (`c14c468`): 105 de API e 15 de navegador aprovados no GitHub. Esta etapa parte dessa `main`, preserva catálogo, logo, hub instalável e WhatsApp manual. Não publica a aplicação nem ativa a Meta.

## Atendimento e dinheiro separados

Na agenda, **Concluir atendimento** abre uma confirmação com cliente e serviço. Só permite concluir uma reserva confirmada que já começou. Registra o instante da conclusão e incrementa a versão; não cria recebimento. O atendimento continua na agenda e no histórico como **Concluído**. Não pode mais ser remarcado ou cancelado, e a ocupação histórica permanece. O lembrete pendente fica suprimido. O histórico mostra quando foi concluído.

**Registrar pagamento** é outra ação. Pode ocorrer antes ou depois da conclusão, inclusive em reserva cancelada quando houver dinheiro efetivamente recebido. Não conclui nem altera a situação da reserva. Sugere o preço anunciado na reserva e permite ajustar valor, data e forma: **Pix**, **dinheiro** ou **cartão**. Na TOMAZ, corte sugere R$ 30,00 para Pix/dinheiro e R$ 33,00 para cartão; Aurora usa seu próprio preço. Trocar a forma preserva um valor já ajustado manualmente.

O valor é validado e armazenado em centavos inteiros, entre R$ 0,01 e R$ 999.999,99. A data deve existir, ser de 2000 em diante e não estar no futuro. O padrão é o dia atual no fuso do estabelecimento. A confirmação mostra o recibo e a agenda exibe o valor, data e forma recebidos.

Há no máximo um recebimento por atendimento nesta etapa. O botão fica desabilitado enquanto salva. Chave idempotente, impressão dos dados e unicidade no banco impedem duplicidade por toque duplo, duas abas ou perda da resposta. Reenviar os mesmos dados recupera o registro; dados divergentes recebem conflito sem sobrescrever o original. Recebimentos salvos ficam disponíveis para consulta. Pagamentos parciais, edição posterior, estorno e conciliação bancária ficam fora desta etapa.

## Resumo e relatórios

A aba **Recebimentos** mostra **Recebido hoje** e **Recebido no mês**, referentes ao dia/mês atual do estabelecimento. O filtro **De / Até** consulta um período inclusivo de até 366 dias, com total, quantidade e agrupamentos por **cliente**, **serviço** e **forma de pagamento**. Os cartões de hoje/mês continuam como referência ao consultar períodos anteriores. A lista detalhada carrega 50 registros por página; totais e agrupamentos abrangem o período inteiro.

O caixa soma exclusivamente os recebimentos pela **data do pagamento** (`paid_on`). Não usa data agendada, conclusão, preço do catálogo ou criação do registro. Reserva, cancelamento e atendimento passado sem recebimento não geram receita. Cancelar não apaga dinheiro já recebido. Nenhuma taxa por falta é calculada ou lançada automaticamente; a combinação e o pagamento continuam manuais e presenciais.

Cliente e serviço são agrupados pelos IDs dentro do estabelecimento, sem misturar pessoas de mesmo nome. Os nomes e o preço sugerido vêm da reserva, preservando os dados históricos; mudar o catálogo não recalcula valores recebidos.

## Dados, acesso e atualização

Execute `npm run db:migrate` antes de iniciar a versão atualizada. A migração aditiva `0007_receipts.sql` acrescenta conclusão e cria recebimentos, índices e chaves estrangeiras compostas. Preserva reservas, cancelamentos, clientes, sessões e links anteriores. Nenhum atendimento existente é presumido concluído ou pago. `0005` continua reservado ao PR #5 separado.

As rotas exigem sessão administrativa do estabelecimento. Consultas, gravações, conflitos e referências conferem `shop_id`; cliente e serviço vêm do banco, sem confiar em identidades enviadas no corpo. POST valida origem. A área do cliente recebe somente a situação do atendimento, sem dados financeiros. O service worker continua sem guardar API, agenda, clientes ou relatórios em cache.

| Rota sob `/api/shops/<slug>/admin` | Uso |
| --- | --- |
| `POST /bookings/:id/complete` | Conclusão idempotente com `requestKey` e `expectedVersion`. |
| `GET /bookings/:id/payment` | Dados históricos do atendimento e eventual recebimento. |
| `POST /bookings/:id/payment` | Recebimento com `requestKey`, `amountCents`, `paidOn` e `method` (`pix`, `cash`, `card`). |
| `GET /receipts?from=...&to=...&cursor=...` | Hoje/mês, total e agrupamentos do período, lista paginada. |

Conclusão concorre com remarcação/cancelamento por versão e guarda no banco; a tentativa perdedora não modifica o atendimento. Concluir suprime o lembrete sem criar mensagem; receber pagamento não cria mensagem nem altera lembrete. `WHATSAPP_MODE=off` permanece. O piloto do PR #5 fica para depois, limitado à confirmação do agendamento e ao lembrete dez minutos antes, atualizado na remarcação e retirado no cancelamento.

## Validação e telas

- `npm run check`: TypeScript, build e **123 testes de API/D1**, incluindo os 105 anteriores e 18 novos de recebimentos, conclusão, acesso, concorrência, períodos e paginação.
- Testes de navegador: fluxos de conclusão, pagamento e resumo nos dois salões em 390 e 320 pixels; toque duplo e perda da resposta sem duplicação.
- TOMAZ e Aurora preservam totais, clientes, serviços e registros separados. Cookie ou ID do outro salão não dá acesso.
- Concluir sem pagar e pagar sem concluir são verificados separadamente. Atendimentos históricos são importados somente no banco de testes; o agendamento público continua impedindo datas passadas.

Veja as [telas no celular](previas-recebimentos/README.md). A integração deste PR e a publicação ficam para revisão do proprietário.

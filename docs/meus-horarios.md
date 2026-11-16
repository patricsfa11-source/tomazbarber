# Meus horários e verificação do celular

A primeira reserva continua no navegador, com somente nome completo e celular com DDD. Não há senha, e-mail ou instalação de aplicativo. A TOMAZ BARBER mantém o catálogo escuro, a logo e o agendamento atual.

A etapa [Cliente e hub instalável](cliente-hub.md) acrescenta um link privado por reserva, independente desta verificação. A sessão de 24 horas de Meus horários permanece. Sem remetente configurado, a interface orienta a usar o link salvo na confirmação, sem solicitar um código que não poderia ser entregue. Os totais atuais da suíte e as novas telas estão naquela documentação.

## Fluxo proposto para avaliação

1. O cliente abre **Meus horários** pelo catálogo ou pela confirmação da reserva.
2. Informa o celular utilizado na reserva. O remetente recebe uma solicitação de código de seis dígitos pelo WhatsApp, identificando o estabelecimento.
3. O cliente digita o código no navegador. O código vale por cinco minutos, pode ser usado uma única vez e permite até cinco tentativas.
4. Depois da verificação, vê **Próximos** e **Histórico** apenas daquele número e estabelecimento. A sessão dura 24 horas, com opção **Sair**. Em outro navegador ou estabelecimento, precisa verificar novamente.

O remetente real ainda precisa ser escolhido. Nesta entrega, os testes usam um Worker simulado: nenhuma mensagem real é enviada. Não há código de teste fixo nem forma de obter o código pela API pública da aplicação. Sem remetente e segredo configurados, o agendamento continua funcionando e a verificação informa que está indisponível.

Uma proposta de texto para o futuro remetente:

> Seu código para acessar Meus horários em **{{estabelecimento}}** é **{{codigo}}**. Ele vale por 5 minutos. Não compartilhe com ninguém. Se você não solicitou, ignore esta mensagem.

## Acesso e ações

As páginas ficam em `/s/tomaz-barber/meus-horarios` e `/s/salao-aurora/meus-horarios`. Cada sessão usa um cookie separado por caminho, `HttpOnly`, `SameSite=Strict` e `Secure` no HTTPS. Só o hash do token fica no banco. A identidade autorizada vem da sessão; parâmetros como `phone` e `customerId` enviados pelo cliente não mudam o acesso.

Todas as consultas e alterações conferem estabelecimento e telefone verificado, inclusive reservas cadastradas pelo hub. O cliente recebe somente os campos necessários da própria reserva; não recebe clientes, telefones, eventos internos, dados do hub ou estado dos lembretes. As listas são paginadas em grupos de 50.

**Remarcar** usa a duração e o preço originais e a disponibilidade do canal público: não permite encaixe em faixa oculta só no link. O cliente escolhe data e horário, revisa a mudança e toca em **Confirmar remarcação**. A transação ocupa o destino antes de liberar a origem. Conflito, alteração concorrente ou indisponibilidade mantêm a reserva original. Uma versão e uma chave de solicitação evitam sobrescritas e duplicidades em reenvios.

**Cancelar** mostra a regra de cancelamento sem custo com pelo menos duas horas de antecedência e exige uma confirmação explícita. Libera a ocupação e mantém a reserva cancelada no histórico. Os eventos e o estado desejado do lembrete são atualizados atomicamente, como no hub.

**Decisão pendente: alterações com menos de duas horas.** Até a definição da regra de cancelamento tardio, a área do cliente orienta a combinar diretamente com o salão e preserva a reserva. A API não aplica taxa nem cancela automaticamente. A mesma restrição provisória vale para remarcações próximas ao atendimento, para evitar liberar um horário tardio por remarcação seguida de cancelamento. O hub continua permitindo a decisão humana. A taxa de falta de R$ 15,00 permanece tratada presencialmente; esta entrega não cria cobrança.

## Código e proteção contra abuso

- Código aleatório de seis dígitos; no banco, HMAC SHA-256 com `CUSTOMER_AUTH_SECRET` de no mínimo 32 caracteres, separado dos dados.
- Desafio vinculado ao estabelecimento e ao telefone normalizado. Um novo envio invalida desafios anteriores ainda não utilizados naquele escopo.
- Reenvio após pelo menos 60 segundos; até cinco envios por telefone/hora e 20 por IP/hora em cada estabelecimento. Até 50 verificações por IP a cada 15 minutos.
- Limites, consumo do código e criação da sessão são transacionais no D1. Duas verificações simultâneas geram uma única sessão.
- A resposta de solicitação é igual para números com ou sem reservas. Falha no remetente não autentica ninguém nem altera uma reserva.
- POST exige origem igual à página. Payloads são limitados. Códigos, telefones e corpos das mensagens não são registrados em logs da aplicação.

A aplicação verifica posse atual do número, não a identidade civil. Compartilhamento e reciclagem de números continuam sendo limitações desse modelo. Mudança de telefone e recuperação por outro canal não fazem parte desta etapa.

## Configuração e testes

Execute `npm run db:migrate` para aplicar `0004_customer_access.sql`. A migração acrescenta desafios, sessões, limites e um índice para as consultas do cliente; preserva reservas, regras de agenda e sessões do hub.

O contrato `VERIFICATION_SENDER` é um service binding com `fetch(POST https://verification-sender/send)`, recebendo JSON com `challengeId`, `shopId`, `shopName`, `phone`, `code` e `expiresAt`. Uma resposta 2xx significa que o remetente aceitou a mensagem; o provedor deve deduplicar por `challengeId`. A aplicação limita a espera a dez segundos. A aceitação do remetente não substitui a digitação do código correto. Em produção, o adaptador precisará tratar credenciais, modelo de mensagem aprovado, confirmação de entrega e falhas do provedor.

O segredo deve ser configurado fora do repositório, por exemplo com `wrangler secret put CUSTOMER_AUTH_SECRET`. O binding do provedor real permanece ausente na configuração normal; não há envio externo nesta entrega.

As rotas ficam em `/api/shops/<slug>/customer`:

| Método e rota                                                   | Uso                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /verification`                                            | Solicita código para o celular informado, com limites de envio.               |
| `POST /verify`                                                  | Recebe `challengeId` e `code`; consome o desafio e cria a sessão.             |
| `GET /session` e `POST /logout`                                 | Consulta o celular mascarado da sessão e encerra o acesso.                    |
| `GET /bookings?view=upcoming\|history&cursor=...`               | Lista apenas as reservas do telefone verificado.                              |
| `GET /bookings/:id` e `GET /bookings/:id/availability?date=...` | Consulta a própria reserva e os destinos válidos para remarcar.               |
| `POST /bookings/:id/reschedule` e `POST /bookings/:id/cancel`   | Exigem `expectedVersion` e `requestKey`; remarcação também recebe `startsAt`. |

Para validar:

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

O Playwright inicia a aplicação com `wrangler.e2e.jsonc` e o remetente em `tests/whatsapp-simulated/`. Essa configuração e suas chaves fictícias são exclusivas de testes locais e não devem ser publicadas. O endpoint do simulador que permite ao teste ler a mensagem só atende em loopback e exige uma chave de teste; ele não existe na aplicação normal. Os códigos ficam em memória e desaparecem ao encerrar o processo.

Os 92 testes de API cobrem os fluxos anteriores e dois clientes e dois estabelecimentos, código errado/expirado/reutilizado, limites, concorrência na verificação, falha no envio, logout, sessão expirada, propriedade das reservas, remarcação concorrente e em conflito, canal público, cancelamento, histórico e preservação dentro do prazo pendente. Nos 12 testes de navegador, o fluxo usa o código efetivamente recebido pelo remetente simulado, sem atalho de autenticação. As telas são verificadas em 320 e 390 pixels, mantendo as verificações anteriores de 1440 pixels.

As [capturas no celular](previas-meus-horarios/README.md) fazem parte deste PR. WhatsApp real, confirmação e lembretes enviados, tratamento de cancelamentos tardios e publicação continuam para decisão posterior.

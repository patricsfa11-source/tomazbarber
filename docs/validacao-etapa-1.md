# Validação da primeira etapa

Validação local realizada em 13/11/2026, com dados fictícios. Não houve publicação, uso de banco remoto ou envio de mensagens.

## Resultado

`npm run check`: TypeScript e build aprovados; **31 testes de API aprovados**, executados no runtime Workers com D1 local e a migração real do projeto.

`npm run test:browser`: **3 testes de navegador aprovados**, usando Chromium, com fluxos completos e telas de 320, 390 e 1440 pixels. O navegador usa uma base descartável própria, separada do desenvolvimento. O teste em aparelho físico continua previsto para o piloto.

| Cenário                   | Evidência                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Sete serviços             | Preços e durações conferidos, incluindo os dois preços do corte masculino e luzes a partir de R$ 60,00.                                        |
| Expediente                | Corte disponível até 19h30; corte com barba até 19h20; domingo fechado; passado e inícios fora da grade rejeitados.                            |
| Duas reservas simultâneas | Um `201 Created` e um `409 Conflict`, tanto no mesmo início quanto em inícios diferentes que se sobrepõem.                                     |
| Concorrência entre canais | Link e hub disputam a mesma restrição: apenas uma reserva confirmada.                                                                          |
| Atomicidade               | Reserva rejeitada não permanece no banco e não deixa segmentos ocupados. Inserção SQL direta conflitante também é rejeitada.                   |
| Idempotência              | Reenvio simultâneo ou posterior da mesma solicitação retorna o mesmo identificador, com uma única reserva gravada.                             |
| Agenda compartilhada      | Reserva pelo link aparece no hub; encaixe de 40 minutos retira todo o intervalo do link; horário adjacente continua disponível.                |
| Acesso                    | Sem sessão, leitura e escrita administrativas retornam `401`. Logout e expiração revogam acesso. API pública não lista clientes nem histórico. |
| Conflito na interface     | Ao confirmar um horário recém-ocupado, a tela informa o conflito e recarrega as opções, preservando nome e celular.                            |
| Navegação responsiva      | Reserva, confirmação, login e agenda do hub exercitados; sem rolagem horizontal nas larguras verificadas.                                      |

Também foram executados `npm run db:migrate` e `npm run db:seed` sobre a base local de desenvolvimento. O seed foi repetido para conferir que não duplica o cliente fictício.

## Como repetir neste ambiente

```sh
XDG_CONFIG_HOME="$PWD/work/config" WRANGLER_LOG_PATH="$PWD/work/wrangler.log" npm run check
XDG_CONFIG_HOME="$PWD/work/config" WRANGLER_LOG_PATH="$PWD/work/wrangler.log" CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Em outro computador, os comandos usuais estão no [README](../README.md). A CI repete a validação com Chromium instalado pelo Playwright.

## Limites desta entrega

Logo original ausente: a interface usa texto provisório. Não há WhatsApp, notificações, publicação, recebimentos, histórico autenticado do cliente, remarcações, cancelamentos ou edição de disponibilidade. Esses itens permanecem nas próximas etapas do [plano técnico](plano-tecnico.md).

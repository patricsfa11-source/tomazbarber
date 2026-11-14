# WhatsApp da TOMAZ BARBER

Esta etapa integra a WhatsApp Cloud API da Meta ao código de acesso, às confirmações e aos lembretes da agenda. Usa os eventos transacionais já registrados pelo banco, preserva a sessão de **24 horas** em Meus horários e mantém o cadastro com somente nome completo e celular com DDD.

## Estado da entrega

A configuração normal permanece em `WHATSAPP_MODE=off`. O único modo de envio implementado nesta entrega é `test`: permite **um número explicitamente autorizado**, somente na TOMAZ BARBER. `live` não habilita envios. Mensagens de outros clientes não são redirecionadas para o número de teste, e o Salão Aurora não usa as credenciais da TOMAZ.

O transporte é substituído por um simulador nos testes. O código do adaptador chama o endpoint real `https://graph.facebook.com/<versão>/<phone-number-id>/messages` quando existem credenciais válidas e não há transporte simulado configurado. Nenhuma credencial real integra o repositório. Publicação, configuração de conta/segredos e ativação para clientes dependem da revisão do proprietário.

As [capturas do painel no celular](previas-whatsapp/README.md) mostram o fluxo com dados e recibos simulados.

**Piloto autorizado:** usar o remetente de teste da Meta e somente o destinatário informado pelo proprietário do teste, registrado em configuração privada. O dono da barbearia usa WhatsApp pessoal; o número oficial da TOMAZ BARBER será definido com ele antes da produção. O piloto não migra nem vincula esse WhatsApp pessoal.

**Envio real:** o destinatário já foi informado; ainda falta configurar o acesso ao remetente de teste da Meta e seus secrets no ambiente privado. Um teste simulado aprovado ou uma resposta 2xx não é prova de entrega no WhatsApp. O primeiro teste real deve registrar seu identificador e aguardar o webhook de entrega ou a confirmação do destinatário; não incluir telefone completo ou token no PR público.

## Comportamento

- **Código de acesso:** o cliente solicita no navegador, recebe um modelo AUTHENTICATION com seis dígitos e botão de copiar e digita o código em Meus horários. Validade de cinco minutos, uso único, cinco tentativas, reenvio após 60 segundos e os limites existentes. A sessão continua em 24 horas. Um código expirado, consumido ou substituído não é enviado novamente.
- **Reserva pelo link ou hub:** modelo de confirmação para o telefone registrado, com serviço, data, hora, regras de atendimento e link para Meus horários.
- Reservas próximas do início mantêm pelo menos dez minutos de janela para processar a confirmação, para não perdê-la se o horário começar segundos depois do pedido. Isso não cria lembrete adicional.
- **Lembrete:** desejado para `starts_at - 600` somente quando a reserva foi criada/remarcada com **mais de dez minutos** de antecedência. Com dez minutos ou menos, só a confirmação. O remetente confere situação e versão novamente antes do envio.
- **Remarcação:** confirma o novo horário e suprime os envios pendentes da versão anterior; o lembrete acompanha a nova versão. Preço e duração continuam os originais.
- **Cancelamento:** confirma o cancelamento e suprime o lembrete pendente. Reserva, histórico e ocupação seguem as garantias anteriores.

As mensagens usam modelos aprovados, inclusive fora da janela de atendimento do WhatsApp. Essa janela da Meta é independente da sessão de 24 horas do navegador. A taxa de falta continua presencial e não há cobrança automática. As regras provisórias para alterações com menos de duas horas continuam as de Meus horários; o WhatsApp não decide cancelamentos tardios.

## Fila, falhas e concorrência

`0005_whatsapp.sql` acrescenta a fila de envios, tentativas, comandos de repetição e recibos de webhook. Não altera reservas ou sessões existentes. O payload, incluindo código de acesso, é criptografado com AES-GCM e um segredo separado. Depois da aceitação, supressão ou expiração, o conteúdo deixa de ser necessário e é apagado do registro; a expiração é limpa pelo processador. Códigos e corpos das mensagens nunca vão para os logs.

Cada mensagem tem uma chave única por estabelecimento, reserva, versão e tipo; o código usa o identificador do desafio. Um `UPDATE` condicional adquire o envio e registra uma tentativa na mesma transação. Dois consumidores não fazem dois POSTs para o mesmo envio. O histórico de processamento da outbox também é deduplicado.

O processador roda em segundo plano depois das ações da agenda e por cron a cada minuto. O lembrete é elegível no instante previsto e tem uma janela de até dois minutos para tolerar a execução do agendador; depois disso é descartado, em vez de enviar um aviso atrasado. Nunca é enviado antes de uma confirmação da mesma versão ser aceita pela Meta.

Durante os poucos segundos de uma requisição em voo, a reserva é protegida contra alteração concorrente; a interface pede para tentar novamente e preserva o horário. O POST tem timeout de oito segundos e o lease expira em 45 segundos se o Worker for interrompido. Na retomada, esse envio fica **incerto**, não é reenviado automaticamente. Uma confirmação já aceita pela Meta não pode ser retirada do aparelho; as alterações cancelam os envios ainda pendentes.

Estados visíveis no hub distinguem **Aceita pela Meta**, **Enviada**, **Entregue** e **Lida**. Só webhook válido informa os estados de entrega. São verificados HMAC SHA-256 do corpo original, WABA, número remetente, destinatário e correlação da tentativa. Webhooks repetidos são inofensivos e estados atrasados não rebaixam Entregue/Lida. O evento é persistido antes da resposta 200.

Política de novas tentativas:

- **429 com rejeição explícita da API:** espera pelo menos 60 segundos, respeita `Retry-After` e aplica espera progressiva, com no máximo cinco tentativas e o prazo do evento.
- **4xx com rejeição explícita:** exibe falha/código. O hub permite tentar novamente após corrigir a causa, se a mensagem continua atual e dentro do prazo. O comando de repetição também é idempotente.
- **Timeout, 5xx, resposta inválida ou queda após enviar:** resultado incerto. Não há novo POST automático, pois a Meta pode já ter aceitado a mensagem. `biz_opaque_callback_data` permite conciliar o resultado pelo webhook mesmo se a resposta original se perdeu.
- **Falha de entrega recebida por webhook:** fica registrada com o identificador Meta e não é repetida automaticamente. Entregas confirmadas não são rebaixadas por um evento fora de ordem.

Essa política evita repetir uma mensagem em situações ambíguas; não promete entrega exatamente uma vez em uma API externa sem uma chave de idempotência documentada. Um envio incerto sem recibo exige conferência na Meta, e não pode ser repetido pelo botão do hub.

## O que preparar na Meta

1. **Portfólio empresarial, aplicativo com WhatsApp e WABA.** Para o primeiro envio, prefira o número de teste oferecido pela Meta. Adicione e verifique o seu destinatário no painel de configuração da API. Não é preciso alterar o WhatsApp atual da barbearia para esse primeiro teste.
2. **Identificadores:** `Phone Number ID`, `WhatsApp Business Account ID` (WABA) e a versão da Graph API suportada pelo aplicativo. Esses IDs são diferentes do telefone visível.
3. **Token de acesso:** o temporário pode servir ao piloto inicial enquanto válido. Para operação contínua, prepare acesso de usuário do sistema com `whatsapp_business_messaging`, acesso aos ativos corretos e rotação/renovação. A gestão de modelos e assinatura da conta também pode exigir `whatsapp_business_management`. A validade e as permissões precisam ser conferidas no aplicativo; não assumir que o token nunca expira.
4. **Webhook HTTPS:** apontar para `/webhooks/whatsapp`, escolher um Verify Token próprio, guardar o App Secret e assinar o campo `messages` da WABA. Conferir a associação/assinatura do aplicativo à conta WhatsApp. O Verify Token não é o token de acesso.
5. **Cinco modelos em `pt_BR`:** um AUTHENTICATION para acesso e quatro UTILITY para a agenda. Submeter à aprovação da Meta. As categorias propostas dependem dessa aprovação; não inserir propaganda nesses modelos.
6. **Antes dos clientes:** revisar o remetente definitivo, nome de exibição, permissões, exigências de verificação/pagamento aplicáveis à conta e como registrar a autorização para receber avisos, inclusive no agendamento manual. O número de teste autorizado nesta conversa não autoriza avisos para a base de clientes.

Os corpos, parâmetros e arquivos de submissão estão em [modelos Meta](whatsapp-modelos/README.md). Eles são propostas para aprovação; o PR não cria ou aprova modelos na conta Meta.

Referências oficiais consultadas:

- [WhatsApp Cloud API — coleção oficial da Meta](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api)
- [Modelo AUTHENTICATION com botão de copiar — Meta/Postman](https://www.postman.com/meta/whatsapp-business-platform/request/6vkv46u/create-authentication-template-w-otp-copy-code-button)
- [Tokens de usuário do sistema e permissões — Meta](https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens/)
- [Validação e assinaturas de webhooks — Meta](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/)

## Configuração privada e primeiro envio real

Use `.dev.vars` local (ignorado pelo Git) ou secrets do Worker no ambiente privado. `.dev.vars.example` contém somente os nomes. As chaves fictícias de `wrangler.e2e.jsonc` são exclusivas dos testes; não publicar esse arquivo ou o simulador.

No piloto real da Meta, não configurar os bindings de simulador `VERIFICATION_SENDER` ou `WHATSAPP_HTTP`. Eles são usados apenas na suíte isolada e substituem o transporte de verdade.

| Variável                                                                                                  | Valor necessário                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `WHATSAPP_MODE`                                                                                           | `off` por padrão; `test` só para o piloto autorizado.                                                                             |
| `WHATSAPP_TEST_RECIPIENT`                                                                                 | Seu destinatário autorizado em E.164, com `+55`, DDD e celular. Nunca redirecionar outras reservas para ele.                      |
| `WHATSAPP_ENABLED_SINCE`                                                                                  | Início do piloto em ISO 8601, definido **agora**, para não enviar eventos antigos.                                                |
| `WHATSAPP_PUBLIC_BASE_URL`                                                                                | Origem HTTPS do agendamento de teste para os links das mensagens.                                                                 |
| `WHATSAPP_GRAPH_VERSION`                                                                                  | Versão válida da Graph API no aplicativo.                                                                                         |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`                                                            | IDs da conta e do número remetente.                                                                                               |
| `WHATSAPP_ACCESS_TOKEN`                                                                                   | Token privado com as permissões de envio.                                                                                         |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`                                                            | Segredos usados para validar o webhook; Verify Token com pelo menos 32 caracteres.                                                |
| `WHATSAPP_PAYLOAD_SECRET`                                                                                 | Segredo aleatório próprio de pelo menos 32 caracteres para criptografar a fila. Preservar enquanto existirem mensagens pendentes. |
| `CUSTOMER_AUTH_SECRET`                                                                                    | Segredo existente da verificação; manter separado e com pelo menos 32 caracteres.                                                 |
| `WHATSAPP_TEMPLATE_ACCESS_CODE`, `..._CONFIRMATION`, `..._RESCHEDULE`, `..._CANCELLATION`, `..._REMINDER` | Nomes dos modelos aprovados, se diferentes dos sugeridos.                                                                         |

Secrets podem ser cadastrados com `wrangler secret put NOME`, sem escrever valores na linha do comando, histórico do shell ou descrição do PR. A publicação do Worker e a URL HTTPS do webhook devem ser tratadas como ambiente privado de piloto; não implicam ativar os clientes.

Depois de aplicar `npm run db:migrate`, iniciar o ambiente com os secrets privados e autenticar no hub, abrir **WhatsApp → Conferir destinatário → Enviar teste**. Essa ação envia somente o modelo pré-aprovado `hello_world` (`en_US`) ao número de teste configurado, sem dados de reserva. O mesmo pedido não gera outro envio. Confira o WhatsApp do destinatário, o identificador da mensagem e, com webhook configurado, o estado Entregue. Não repetir um resultado incerto.

Só depois valide o AUTHENTICATION e os modelos UTILITY aprovados usando reservas fictícias com **esse mesmo número**. O fluxo de Meus horários e as reservas do hub continuam separados por estabelecimento. Ainda não há ativação geral para clientes nesta entrega.

## Validação automatizada

`npm run check` executa TypeScript, build e **116 testes** no D1/Workers, incluindo os 92 anteriores e 24 de WhatsApp. Os testes de WhatsApp usam transporte simulado e verificam códigos, confirmação nos dois canais, agendamento/supressão de lembretes, remarcação, cancelamento, concorrência, limites, rejeição/novas tentativas, perda de resposta, webhook e isolamento.

Os **13 testes** de `npm run test:browser` mantêm os fluxos anteriores e testam o painel WhatsApp, incluindo falha recuperável, confirmação de entrega e visual em 320/390 pixels. O simulador não chama a rede Meta. Nenhum código, token, telefone real ou comprovante privado deve ser anexado ao repositório.

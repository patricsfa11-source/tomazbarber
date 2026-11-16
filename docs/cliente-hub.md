# Agendamento pelo navegador e hub instalável

Esta etapa parte da `main`, preserva o catálogo compacto, o fundo escuro e a logo original. Não ativa a Meta nem publica a aplicação. As [telas para revisão](previas-cliente-hub/README.md) foram capturadas na aplicação com dados fictícios.

## Reserva e acesso privado

O cliente escolhe serviço, data e horário, informa nome completo e celular com DDD, revisa e confirma. A confirmação na tela oferece **Consultar ou alterar esta reserva** e **Copiar link privado**. Não exige instalar aplicativo nem receber mensagem para concluir o agendamento.

O link autoriza somente aquela reserva, naquele estabelecimento. Ele não verifica a posse do telefone e não abre uma lista de reservas do número. Nome, telefone, ID da reserva ou um link de outra pessoa não autorizam acesso. Quem receber o link completo poderá consultar, remarcar ou cancelar a reserva correspondente: a confirmação orienta a guardá-lo em segurança.

O segredo de 256 bits fica no fragmento `#acesso=...`, que não acompanha a requisição HTTP da página. O navegador troca o segredo por uma sessão e remove o fragmento do endereço. A sessão usa cookie `HttpOnly`, `SameSite=Strict`, `Secure` em HTTPS, restrito ao caminho da reserva e com duração de 24 horas. A aplicação usa `Referrer-Policy: no-referrer` e não guarda o link no armazenamento local.

O D1 guarda o hash do segredo e da sessão. Uma chave aleatória por estabelecimento permite recuperar o mesmo link em reenvios idempotentes da criação, sem salvar o segredo do link em texto puro. A chave fica no banco, nunca no repositório. O link vale até revogação; a sessão de 24 horas não muda sua validade. Depois de expirar a sessão, é necessário abrir o link original salvo. **Fechar acesso** encerra a sessão atual. O hub pode revogar o link e todas as suas sessões por `POST /api/shops/<slug>/admin/bookings/<id>/access/revoke`; isso não cancela o atendimento nem permite reativar o link por reenvio da criação.

Na remarcação, a disponibilidade é a do cliente, incluindo faixas ocultas e bloqueios. O cliente revisa o destino e confirma; a transação ocupa o novo horário antes de liberar o antigo. Conflito preserva a reserva original. O cancelamento exige confirmação, libera a faixa e mantém o histórico. Ambos atualizam o estado desejado do lembrete e os eventos existentes, sem enviar mensagens.

Permanece a regra de cancelamento sem custo com pelo menos duas horas de antecedência. Alterações dentro desse prazo continuam dependendo de decisão do salão pelo hub; não há cobrança automática. A taxa de falta continua presencial.

**Meus horários** agora é a [conta do cliente](conta-cliente.md), com nome, posse do número por código e sessão de 30 dias. O transporte real preparado é SMS; o piloto oferece simulação restrita a números fictícios. O acesso pelo link individual continua independente e não libera o histórico do telefone.

## Hub no celular

Cada `/s/<slug>/hub` mantém agenda diária, encaixes, clientes e configurações de disponibilidade. O cadastro de cliente pode ser feito sem reservar horário. **Marcar horário** preenche o encaixe com os dados escolhidos. Um telefone já cadastrado com outro nome não é sobrescrito silenciosamente. O nome completo e o telefone aparecem na agenda e na lista de clientes. Tocar no número abre a conversa com aquele cliente no WhatsApp, sem mensagem preenchida ou envio automático; o barbeiro escreve e envia pela própria conta conectada no aparelho.

**Divulgar agendamento** oferece o link público daquele estabelecimento, botão para copiá-lo, compartilhamento manual pelo WhatsApp e QR Code em PNG. O barbeiro escolhe o destinatário e confirma no WhatsApp. O QR contém somente o link público, sem clientes, senhas ou links privados. TOMAZ e Aurora têm links e QR Codes diferentes.

**Instalar hub** orienta Chrome no Android e Safari no iPhone. Quando o navegador oferece a instalação nativa, o diálogo permite solicitá-la. Há manifesto, identificador, escopo e ícones de 192 e 512 pixels por estabelecimento. Os ícones da TOMAZ usam a logo original preservada; Aurora usa um monograma próprio. A instalação exige HTTPS ou ambiente local compatível.

O service worker guarda somente a tela genérica de reconexão, seu CSS e os ícones públicos. Não guarda respostas da API, agenda, clientes, páginas privadas ou credenciais. Sem rede, uma abertura do hub mostra **Vamos reconectar**; uma agenda já aberta avisa que pode estar desatualizada. Não há fila de reservas offline ou confirmação sem resposta do servidor. Ao voltar a conexão, o hub consulta os dados novamente.

Foram verificados manifesto, ícones, escopo, service worker e reconexão no Chromium, com telas de 320 e 390 pixels. A instalação na tela inicial de um aparelho Android/iPhone físico ainda deve ser conferida no piloto; esta validação não simula a interface do sistema operacional.

Referências: [requisitos de instalação de PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [cache e service workers](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching) e [adicionar um site à tela inicial no iPhone](https://support.apple.com/guide/iphone/iphea86e5236/ios).

## Atualização e validação

Execute `npm run db:migrate` antes de iniciar a versão atualizada. A migração aditiva `0006_booking_links.sql` preserva clientes, reservas e sessões existentes. O número `0005` está reservado à integração WhatsApp do PR #5, que continua separado; o Wrangler aplica as migrações disponíveis ainda não registradas. Antes de retomar esse PR, é necessário atualizá-lo com a `main` e validar as duas migrações em conjunto.

`WHATSAPP_MODE` está explicitamente em `off` nas configurações normal e de navegador. Não há adaptador Meta, cron de envio nem credenciais Meta nesta branch. O compartilhamento manual não passa pela API da Meta.

- `npm run check`: TypeScript, build e **105 testes de API** com D1 local.
- `npm run test:browser`: **15 testes de navegador**, incluindo o fluxo completo sem Meta, acesso privado, conflito, remarcação, cancelamento, cadastro no hub, links, QR, instalação e reconexão.
- Dois clientes e dois estabelecimentos: sessões, reservas e clientes isolados; ambos podem atender no mesmo horário; sobreposição dentro de um salão continua bloqueada.
- Links inválidos, sessão expirada, logout, revogação, origem diferente e tentativas por nome/telefone são rejeitados. Remarcação concorrente confirma só um destino e preserva a reserva perdedora.
- Os PNGs baixados são decodificados nos testes para confirmar o link exato de cada estabelecimento. A suíte anterior de disponibilidade continua cobrindo expediente, pausas, exceções, faixa oculta para encaixe manual e bloqueio nos dois canais.

O PR #5 será retomado depois desta revisão, com apenas dois eventos de envio automático: confirmação do agendamento e lembrete dez minutos antes. Remarcação deverá atualizar o lembrete pendente; cancelamento deverá retirá-lo. A implementação antiga desse PR ainda precisa ser ajustada a esse escopo antes de integrar. Publicação, credenciais reais e ativação para clientes continuam pendentes de revisão.

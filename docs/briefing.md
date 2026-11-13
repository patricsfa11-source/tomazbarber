# TOMAZ BARBER — briefing para o Codex

[Repositório do projeto](https://github.com/patricsfa11-source/tomazbarber)

## Objetivo

Substituir a agenda em papel por um sistema próprio para um único barbeiro. O cliente agenda pelo navegador do celular, a partir de um link. O barbeiro usa um hub privado, instalável no celular. Os dois acessam a mesma agenda. Desenvolver código próprio em um projeto novo. Easy!Appointments, Ekwugha/barberShop e FSW Barber são referências de fluxo e organização.

## Identidade e telas

Usar o nome TOMAZ BARBER e a logo original enviada na conversa. Preto, dourado e branco são a proposta visual do rascunho. Priorizar leitura, botões grandes, contraste e linguagem simples no celular.

- **Cliente** — página inicial com marca e serviços, escolha de data e horário, revisão da reserva, confirmação e tela Meus horários. Mostrar o preço e a duração antes de pedir os dados do cliente. Usar uma faixa de datas e agrupar os horários disponíveis por turno. Oferecer remarcação, cancelamento e acesso ao endereço nos detalhes da reserva. O atalho para o calendário do celular é uma proposta de conveniência.
- **Hub** — abrir na agenda de hoje, com visualizações de dia, semana e mês. Dar acesso a Novo agendamento, Editar disponibilidade, Clientes, Financeiro, Relatórios e Configurações. O hub registra reservas recebidas pelo WhatsApp ou presencialmente, remarcações, cancelamentos, atendimentos concluídos e faltas.
- **Conta do cliente** — pedir somente nome completo e celular com DDD na primeira reserva. O modo de verificar a posse do número e recuperar a conta ainda precisa ser definido. Código pelo WhatsApp é a proposta a avaliar. Proteger o histórico e as ações da reserva contra acesso de terceiros.
- **Acesso do barbeiro** — login administrativo separado. A página pública divulga apenas horários disponíveis, sem expor nomes, telefones ou dados do hub.

## Catálogo inicial

| Serviço | Preço exibido | Duração |
|---|---|---:|
| Corte masculino | R$ 30,00 no Pix ou dinheiro · R$ 33,00 no cartão | 30 min |
| Barba | R$ 15,00 | 20 min |
| Corte com barba | R$ 38,00 | 40 min |
| Pé de cabelo | R$ 15,00 | 20 min |
| Pé com barba | R$ 20,00 | 60 min |
| Pigmentação | R$ 20,00 | 60 min |
| Luzes | A partir de R$ 60,00 | 60 min |

O corte masculino é um único serviço. O hub registra a forma de pagamento e o valor efetivamente recebido, inclusive o valor final de luzes. Guardar na reserva os dados do serviço e as condições oferecidas no momento da confirmação, para preservar o histórico após alterações no catálogo.

## Agenda e disponibilidade

- Expediente padrão de segunda a sábado, das 7h30 às 20h. Domingo fechado por padrão, com possibilidade de abertura pelo hub. Usar o horário local da Bahia.
- No hub, permitir editar o expediente semanal e as pausas fixas. Permitir configurar horário especial para uma data ou período, inclusive abertura mais cedo, fechamento mais tarde e domingos. Após o período, volta o padrão semanal.
- Na opção Editar disponibilidade, permitir ocultar intervalos somente do agendamento online, liberar faixas específicas, reabrir intervalos e restaurar o padrão do dia. Um intervalo oculto continua disponível para encaixe manual. Um bloqueio geral fecha o intervalo nos dois canais.
- A reserva precisa caber por inteiro na disponibilidade do canal e respeitar as reservas existentes. Proposta inicial de horários de início de 10 em 10 minutos. Às 19h30 cabe um corte de 30 minutos antes das 20h. Um corte com barba de 40 minutos pode começar até 19h20, se o intervalo estiver livre.
- Conferir sobreposição no servidor e fazer a gravação de modo que duas solicitações simultâneas para o mesmo intervalo gerem apenas uma reserva. Aplicar a mesma regra a reservas online, encaixes manuais e remarcações.
- Se uma alteração de expediente ou bloqueio atingir uma reserva confirmada, mostrar quais reservas serão afetadas e permitir que o barbeiro decida como tratá-las. Preservar as reservas até ação explícita.

## Confirmação, lembretes e regras de atendimento

- Cliente recebe confirmação imediata pelo WhatsApp do número cadastrado, tanto para reserva online quanto manual. O cliente usa o navegador e pode receber os avisos pelo WhatsApp sem instalar o aplicativo.
- Enviar lembrete 10 minutos antes do início. Reservas feitas com 10 minutos ou menos de antecedência recebem uma única confirmação. Ao remarcar, enviar o novo horário e atualizar o lembrete. Ao cancelar, confirmar o cancelamento e suprimir o lembrete. Agendar e enviar pelo servidor, com registro de status e tratamento de falhas e duplicidades.
- Quando o cliente fizer nova reserva online, o barbeiro recebe uma notificação do hub no celular. Ao tocar, abre o atendimento. Validar o aviso com o hub fechado no aparelho do barbeiro.
- Mostrar ao cliente antes da confirmação que deve chegar 10 minutos antes, que há 10 minutos de tolerância após o início marcado e que o cancelamento sem custo pode ser feito com pelo menos 2 horas de antecedência.
- A mensagem informa a taxa de R$ 15,00 por falta. O barbeiro decide e trata a cobrança presencialmente. Marcar Faltou apenas atualiza a situação da reserva. Se o barbeiro receber o valor, pode lançá-lo manualmente na data do pagamento. A regra operacional de cancelamento tardio e atraso acima da tolerância ainda precisa de confirmação.

### Texto base — confirmação no WhatsApp

Confirmado na *TOMAZ BARBER* ✅

📅 *{{dia_da_semana}}, {{data}}, às {{horário}}*
💈 {{serviço}}

Por gentileza, chegue *10 minutos antes*. A tolerância para atraso é de *10 minutos* após o horário marcado.

Se precisar desmarcar, você pode cancelar *até 2 horas antes*, sem custo. Em caso de falta, a taxa é de *R$ 15,00*, tratada presencialmente.

Para ver ou desmarcar seu horário, acesse {{link_da_reserva}}. 🤝

### Texto base — lembrete no WhatsApp

Oi, {{primeiro_nome}}! Seu horário na *TOMAZ BARBER* é daqui a *10 minutos*. 💈

*{{serviço}} às {{horário}}.*

Até já! 🤝

## Recebimentos e relatórios

- Financeiro inicial voltado a recebimentos. Depois do atendimento, o barbeiro registra valor, data e forma de pagamento (Pix, dinheiro ou cartão). Conclusão do serviço e registro do pagamento são ações distintas. Exibir o recebido no dia e no mês.
- Reservas confirmadas, cancelamentos e faltas sem pagamento ficam fora do total recebido. Evitar lançamentos duplicados se o botão for tocado novamente ou a operação for repetida.
- Em Clientes, mostrar nome, telefone, histórico, última visita e total pago. Em Relatórios, mostrar recebimentos por mês e por cliente, quantidade de serviços concluídos por tipo e recebimentos por serviço.

## Implementação e validação

1. Começar por catálogo, cálculo de disponibilidade e agendamento online/manual com uma agenda única.
2. Montar o hub, o login administrativo, as exceções de disponibilidade e o controle de recebimentos.
3. Integrar WhatsApp para clientes e notificações do hub para o barbeiro. Separar dados de teste dos reais. Manter credenciais e dados de clientes fora do repositório público.
4. Testar no celular antes de divulgar o link. Cloudflare Workers e D1 são a proposta de hospedagem e banco. A configuração de produção e do número remetente do WhatsApp fica para a etapa de integração.

### Critérios para aceitar a primeira versão

- Um cliente reserva pelo link no celular com dois campos de cadastro e vê preço, data e horário antes de confirmar.
- Dois clientes tentam o mesmo horário e somente um confirma. Um encaixe manual ocupa o intervalo no link público.
- O barbeiro oculta uma faixa só do cliente e ainda consegue encaixar alguém nela. Um bloqueio geral fecha a faixa nos dois canais. Um domingo aberto excepcionalmente aparece no link.
- A confirmação chega no WhatsApp correto. O lembrete acompanha uma remarcação, desaparece após cancelamento e é suprimido nas reservas feitas com 10 minutos ou menos de antecedência. Uma falha no envio pode ser identificada no hub sem perder a reserva.
- O aviso de nova reserva chega ao celular do barbeiro com o hub fechado e abre o atendimento.
- Um corte pago no cartão entra como R$ 33,00 no dia do recebimento. Uma falta atualiza o histórico, e a taxa só entra no financeiro quando o valor for registrado manualmente.

## Primeira instrução para o Codex

Leia este briefing e use-o como referência para o projeto TOMAZ BARBER. Antes de programar, proponha a arquitetura, a divisão em etapas e a forma de testar a primeira etapa. Comece pelo catálogo e pela agenda única, com reservas online e manuais e teste de conflito de horários. Trate as propostas e os pontos pendentes como decisões a revisar. Use dados fictícios no ambiente de testes. Mantenha a publicação e as credenciais de produção para a etapa de integração.

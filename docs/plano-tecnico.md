# TOMAZ BARBER — plano técnico da primeira etapa

O [briefing](briefing.md) reúne as regras do produto. Este plano propõe a arquitetura e define como demonstrar que a agenda funciona antes de integrar os avisos e o financeiro.

A evolução para estabelecimentos independentes está documentada em [Separação por estabelecimento](estabelecimentos.md). A TOMAZ permanece como primeira unidade; catálogo, expediente, clientes, reservas e sessões passam a ser separados por estabelecimento.

A gestão de expediente, pausas, exceções, bloqueios, remarcações e cancelamentos está descrita em [Gestão de agenda](gestao-agenda.md), incluindo a preparação dos lembretes para a futura integração com WhatsApp.

## Arquitetura proposta

- **Um projeto TypeScript**, com duas interfaces web no mesmo domínio. A página pública abre pelo link no celular. O hub fica em uma área administrativa com autenticação própria e poderá ser instalado como PWA. O servidor autoriza as operações administrativas.
- **Uma API e uma agenda compartilhada.** A página pública e o hub consultam o mesmo catálogo e gravam na mesma base. A API pública retorna serviços e horários livres. Nome, telefone e histórico ficam restritos ao titular ou ao barbeiro, conforme a operação.
- **Cloudflare Workers e D1** como destino proposto. Usar migrações versionadas, ambiente de teste com dados fictícios e configuração de produção separada. Validar o mecanismo de gravação no banco antes de publicar.
- **Horário da Bahia** para exibição e regras de expediente. Persistir instantes de início e fim com referência UTC. A reserva guarda o nome, a duração e o preço anunciado do serviço no momento da confirmação.
- **Dados mínimos do cliente.** Nome completo e telefone brasileiro normalizado com DDD. A primeira etapa valida a criação de reservas. O acesso ao histórico e a recuperação da conta dependem do método de verificação que será definido antes da abertura ao público.

## Sequência de trabalho

| Etapa | Resultado para revisar |
| --- | --- |
| 1. Catálogo e agenda | Página do cliente com os sete serviços e seleção de horário. Hub com agenda diária e encaixe manual. As duas entradas usam o mesmo cálculo de disponibilidade e a mesma validação de conflito. |
| 2. Gestão da agenda | Expediente semanal, pausas, horários especiais, bloqueios, faixas ocultas só no link, remarcações e cancelamentos. O hub lista reservas afetadas por alterações. |
| 3. Mensagens e acesso do cliente | Confirmação, remarcação, cancelamento e lembrete de 10 minutos pelo WhatsApp. Notificação de nova reserva no celular do barbeiro. Verificação do telefone e acesso aos próprios horários. |
| 4. Recebimentos e piloto | Registro manual de recebimentos, relatórios e teste com o barbeiro no celular. Taxa de falta entra no caixa mediante registro do valor recebido. |

## Como a primeira etapa trata horários

1. Calcular horários de início de 10 em 10 minutos, conforme a proposta do briefing. Aplicar o expediente inicial de segunda a sábado, das 7h30 às 20h, e oferecer somente horários em que o serviço inteiro cabe.
2. Na confirmação, recalcular as regras no servidor e proteger a gravação contra concorrência com uma restrição no banco. Para a grade inicial, a proposta é gravar a reserva e os segmentos de 10 minutos que ela ocupa em uma única operação atômica, com chave única por segmento. Os dois canais usam a mesma restrição. A proposta deve ser validada com o banco escolhido.
3. Permitir que uma reserva comece quando outra termina. Se o intervalo acabou de ser ocupado, informar o cliente e atualizar a lista de horários. Gravar a origem da reserva (link ou hub) e evitar repetição de uma solicitação já processada.

## Testes de aceite da primeira etapa

| Teste | Resultado esperado |
| --- | --- |
| Conferir os sete serviços | Preços e durações batem com o briefing, incluindo os dois preços do corte masculino e o valor inicial de luzes. |
| Selecionar serviço às 19h30 | Um corte de 30 minutos cabe até as 20h. Um corte com barba de 40 minutos exige início às 19h20 ou antes. |
| Consultar um domingo | O dia aparece fechado no expediente padrão. |
| Criar encaixe manual de 40 minutos | O período inteiro some da disponibilidade pública e o horário após o fim continua elegível. |
| Fazer duas reservas concorrentes com intervalos sobrepostos | Uma é confirmada. A outra recebe conflito, inclusive quando os horários de início são diferentes. |
| Reenviar a mesma solicitação | A agenda exibe uma única reserva. |
| Abrir pelo celular | O cliente escolhe serviço, dia e horário e revisa os dados antes de confirmar. |
| Acessar o hub sem sessão | A agenda privada e os dados dos clientes ficam inacessíveis. |

A validação de posse do telefone, o comportamento em cancelamento tardio ou atraso, e os dados do remetente do WhatsApp seguem em aberto. A proposta visual usa preto, dourado e branco, com a logo original fornecida pelo proprietário.

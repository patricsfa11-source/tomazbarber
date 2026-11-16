# Serviços do estabelecimento

No Hub autenticado, a aba **Serviços** permite cadastrar serviços e editar nome, duração (10 a 240 minutos, em passos de 10), preço exibido, condições de pagamento e descrição. O preço aceita textos como “A partir de R$ 60,00”. As condições são exibidas junto ao preço; elas não realizam cobrança nem ativam integrações.

O dono pode desativar e reativar cada serviço. Somente serviços ativos aparecem no catálogo e permitem novas reservas pelo link ou encaixes. Recarregue a página pública para consultar a configuração atual. Expediente, horários especiais e bloqueios continuam na tela **Configurar agenda**.

Cada reserva guarda uma cópia do nome, preço/condições e duração do momento da confirmação. Alterações do catálogo não atualizam essas cópias nem os horários existentes. Mesmo após desativar o serviço, uma reserva anterior pode ser consultada, remarcada e cancelada respeitando as regras já existentes. O recebimento continua registrado separadamente.

A API exige a sessão do estabelecimento para listar ou salvar a gestão de serviços. Consultas e gravações usam o estabelecimento da URL autenticada. Uma versão de edição evita que uma tela antiga sobrescreva outra alteração. A inserção da reserva confere atomicamente que o serviço ainda está ativo e na versão lida pelo servidor.

## Atualização do piloto

A migração `0008_service_management.sql` apenas acrescenta três colunas à tabela de serviços. Todos os serviços existentes começam ativos, com condições adicionais vazias e versão 1. Nenhuma reserva, cliente, pagamento ou configuração de agenda é regravada. O texto de preço anterior é preservado literalmente, inclusive condições que já estavam no próprio texto.

Aplicar apenas migrações pendentes no D1 existente, sem executar seed ou redefinir dados. Publicar código/assets com o mesmo binding D1, endereço e secrets. Comparar as tabelas de reservas e recebimentos antes/depois da atualização. WhatsApp automático continua desligado; futuras notificações limitam-se à confirmação e ao lembrete do agendamento.

## Validação

Testes de API cobrem autenticação, isolamento entre lojas, limites de duração/texto, edições concorrentes, criação, desativação/reativação, novas condições e preservação/remarcação/cancelamento de reservas antigas. O teste de navegador cobre os formulários, atualização do catálogo público, tamanhos móveis e isolamento da gestão de serviços. As suítes existentes continuam cobrindo agenda, bloqueios, clientes, conclusão, recebimentos, relatórios, cópia do link e decodificação do QR para ambas as lojas.

O piloto remoto mantém somente TOMAZ configurada. Aurora é validada na base descartável dos testes, sem criar outra loja nem credencial no D1 remoto. Conclusão e pagamentos fictícios são testados com históricos descartáveis; nenhuma reserva existente do piloto é modificada para simular um atendimento passado.

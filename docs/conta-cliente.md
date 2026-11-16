# Conta do cliente e comprovantes

A confirmação, “Sua reserva” e os cartões em “Meus horários” usam o mesmo resumo: selo compacto, serviço, data, intervalo completo, preço/condições e código discreto. A confirmação destaca **Ver meus horários** e mantém o link privado individual. Agendar como convidado continua disponível.

O cliente informa nome completo e o número usado no WhatsApp/cadastro. O código de seis dígitos confirma a posse desse mesmo número; **o transporte real é SMS**, sem mensagens de login por WhatsApp. O código expira em cinco minutos, é de uso único, fica armazenado como HMAC e está sujeito a limites de tentativas/reenvio/IP. Nome e telefone sozinhos não liberam histórico.

Somente depois da prova, o cadastro é criado/atualizado no estabelecimento e as reservas do mesmo número são vinculadas. Nome, preço e horários gravados nas reservas não mudam. A sessão é privada, HttpOnly, Secure em HTTPS, SameSite Strict, restrita ao estabelecimento e persiste por 30 dias; Sair a revoga no servidor. Não há armazenamento de agenda/identidade em localStorage ou cache offline.

Próximos horários estão em ordem cronológica; Histórico identifica cancelados, concluídos e atendimentos passados. Outro número ou uma sessão de outra loja não acessa a lista ou um atendimento individual. O link privado continua dando acesso a uma única reserva.

## Piloto sem envio real

Configurar `APP_STAGE=pilot`, `CUSTOMER_VERIFICATION_MODE=simulated`, `PILOT_VERIFICATION_PHONES` como array JSON com apenas números fictícios em E.164 e `CUSTOMER_AUTH_SECRET` como secret aleatório de pelo menos 32 caracteres. A tela identifica a simulação, lista os números permitidos e mostra o código fictício gerado. Nenhum SMS/WhatsApp é enviado. Somente o desafio para um número dessa lista pode devolver `simulatedCode`. O modo é recusado fora do piloto. Não cadastrar números reais nessa lista.

## Ativar SMS real

1. Escolher/contratar o fornecedor SMS e configurar suas credenciais no serviço remetente, nunca no frontend ou Git.
2. Vincular `VERIFICATION_SENDER` a um Worker adaptador de SMS e mudar `CUSTOMER_VERIFICATION_MODE` para `sms`. Remover `PILOT_VERIFICATION_PHONES`.
3. O adaptador recebe `POST https://verification-sender/send` com JSON `{channel:"sms",challengeId,shopId,shopName,phone,code,expiresAt}`. `phone` é o mesmo número normalizado do cadastro, com +55/DDD. Deve aceitar apenas canal SMS, conferir o prazo, usar challengeId para idempotência, retornar 2xx após o fornecedor aceitar e nunca registrar códigos nos logs. Um erro do adaptador invalida a entrega do desafio.
4. Conceder acesso de rede ao fornecedor no ambiente de implantação, validar remetente/rota brasileira, limites e custos. Testar entrega, expiração, reenvio e sessão com um número autorizado antes de liberar usuários reais.

Sem o remetente ou o secret, o acesso por código fica indisponível; os convidados continuam usando o link individual. No modo SMS a API e a tela nunca retornam o código. WhatsApp automático continua desligado nesta entrega; notificações futuras ficam reservadas à confirmação e ao lembrete do agendamento.

A migração 0009 apenas acrescenta o nome informado ao desafio. Não reescreve as reservas existentes. Os cenários de reserva antiga/nova/concluída/cancelada, sessão, outro cliente e TOMAZ/Aurora são cobertos pela suíte de API; as telas e o fluxo pelo navegador são conferidos em 320/390/430 px.

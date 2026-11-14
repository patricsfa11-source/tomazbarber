# Modelos propostos para aprovação na Meta

Estes arquivos são exemplos de submissão para a WABA. Não contêm credenciais e não foram enviados à Meta. Confirmar aprovação, categoria, idioma e nomes antes de configurar o piloto. A URL nos exemplos é fictícia; no envio, a aplicação usa o endereço privado configurado para o teste.

| Nome e arquivo                                                  | Categoria proposta | Parâmetros de envio, na ordem                                                    |
| --------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| [tomaz_acesso_v1](tomaz_acesso_v1.json)                         | AUTHENTICATION     | Código no corpo e o mesmo código no botão OTP de copiar. Expiração de 5 minutos. |
| [tomaz_reserva_confirmada_v1](tomaz_reserva_confirmada_v1.json) | UTILITY            | Primeiro nome, data completa, hora local, serviço, link Meus horários.           |
| [tomaz_reserva_remarcada_v1](tomaz_reserva_remarcada_v1.json)   | UTILITY            | Primeiro nome, nova data, nova hora local, serviço, link Meus horários.          |
| [tomaz_reserva_cancelada_v1](tomaz_reserva_cancelada_v1.json)   | UTILITY            | Primeiro nome, data, hora local, serviço, link Meus horários.                    |
| [tomaz_lembrete_10min_v1](tomaz_lembrete_10min_v1.json)         | UTILITY            | Primeiro nome, serviço, hora local, link Meus horários.                          |

Todos em `pt_BR`. No modelo AUTHENTICATION, o texto de autenticação é padronizado pela Meta; não substituir por um modelo promocional ou livre. O botão **Copiar código** atende ao navegador e dispensa integração de aplicativo Android. A validade efetiva de cinco minutos também é conferida no servidor.

Os demais textos estão completos nos arquivos JSON. São exclusivamente transacionais, ligados à reserva. A confirmação informa as regras de antecedência, tolerância e falta; o cancelamento não calcula taxa nem decide sobre um cancelamento tardio. O lembrete é programado para dez minutos antes, com o horário explícito no texto.

Para conferir apenas a conexão inicial com o número de teste da Meta, o botão **Enviar teste** usa `hello_world` em `en_US`. Esse teste não substitui a aprovação e a validação dos cinco modelos acima.

Veja [conta, secrets, webhook e teste real](../whatsapp.md).

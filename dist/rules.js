'use strict';

const rule = (title, text, ...sources) => ({ title, text, sources });

window.businessRules = [
  {
    title: 'Contas, cadastro e administração',
    open: true,
    entries: [
      rule('Cadastro e dados obrigatórios', 'A web cadastra moradores, prestadores e síndicos. A API PHP e o app cadastram moradores e prestadores. Nome, e-mail válido, telefone com DDD e senha são obrigatórios. E-mail e telefone são únicos. Os formulários web e móvel exigem CPF com 11 dígitos, mas a API PHP direta aceita omissão. Contas administrativas são provisionadas individualmente.', 'backend/includes/functions.php', 'frontend/pages/cadastro.php', 'api/register.php'),
      rule('Senhas e login', 'A senha tem pelo menos oito caracteres, com maiúscula, minúscula, número e símbolo. O PHP limita a 255 bytes e armazena um hash. Conta ativa entra com e-mail e senha. O fluxo atual dispensa confirmação de e-mail e 2FA. O login é limitado após cinco falhas por e-mail ou trinta por IP em quinze minutos. A sessão web expira após duas horas de inatividade.', 'backend/includes/functions.php', 'backend/includes/security.php', 'frontend/pages/login.php'),
      rule('Recuperação de senha', 'E-mail, CPF e telefone devem corresponder a uma conta ativa. A nova senha exige confirmação. A redefinição revoga tokens da API e invalida sessões web que registram a versão da senha.', 'frontend/pages/recuperar-senha.php', 'backend/includes/functions.php', 'backend/includes/auth.php'),
      rule('Prestadores e perfis', 'Prestador informa CNPJ válido e único, numérico ou alfanumérico, e dispensa vínculo com condomínio. O perfil próprio permite atualizar nome, bio, especialidades, serviços, avatar, portfólio e certificado quando aplicável. O diretório autenticado busca prestadores ativos por nome, especialidade ou serviço e mostra as avaliações.', 'backend/includes/functions.php', 'frontend/pages/perfil.php', 'frontend/pages/pesquisa.php'),
      rule('Verificação de síndico', 'O cadastro exige condomínio ativo e certificado. Um administrador ativo aprova ou rejeita o certificado pendente. Rejeição exige justificativa e um certificado com prazo vencido exige reenvio. A aprovação cria vínculo com o condomínio de cadastro. Reenvio retorna a análise para pendente.', 'frontend/pages/admin-verificacoes.php', 'backend/includes/functions.php', 'frontend/pages/admin-sindicos.php'),
      rule('Gerenciar Usuários hoje', 'Administradores ativos podem consultar e filtrar contas e gerenciar vínculos de moradores. O cadastro, a edição e o bloqueio de contas pelo painel são propostas para a próxima etapa.', 'frontend/pages/admin-usuarios.php', 'backend/includes/auth.php'),
    ],
  },
  {
    title: 'Condomínios, unidades e vínculos',
    entries: [
      rule('Cadastro e situação do condomínio', 'O administrador registra nome único, endereço, cidade e estado. O condomínio nasce pendente, pode ser ativado ou rejeitado, e depois pode ser suspenso e reativado. As decisões são auditadas. O condomínio deve estar ativo para novos cadastros e vínculos.', 'frontend/pages/admin-condominios.php', 'backend/includes/community.php'),
      rule('Escopo por perfil', 'O administrador gerencia os condomínios. Um síndico ativo e aprovado gerencia os condomínios ativos aos quais está formalmente vinculado, com seleção de contexto quando há mais de um. O morador acessa a comunidade de acordo com o vínculo ativo. A unidade pertence a um bloco do mesmo condomínio.', 'backend/includes/community.php', 'backend/database/community_schema.sql'),
      rule('Pedido de vínculo de morador', 'O cadastro exige selecionar unidade do condomínio ativo. O pedido nasce pendente. O síndico responsável pode aprovar uma unidade do mesmo condomínio ou rejeitar com motivo de até 500 caracteres. As decisões notificam o morador. Enquanto aguarda, a conta permite login web com restrições de comunidade. O app mantém o novo morador fora da sessão.', 'backend/includes/functions.php', 'backend/includes/community.php', 'frontend/pages/solicitacoes-unidades.php', 'mobile/src/lib/domain.ts'),
      rule('Vincular e desvincular', 'O administrador consulta pedidos e tem ação direta para adicionar ou retirar unidades. Ao retirar a unidade principal, outro vínculo ativo pode assumir. Sem unidade restante, o morador volta a ficar pendente.', 'frontend/pages/admin-usuarios.php', 'backend/includes/community.php'),
    ],
  },
  {
    title: 'Chamados, atendimento, visitas e avaliações',
    entries: [
      rule('Abertura do chamado', 'Morador ativo com unidade vinculada abre chamado com categoria, título, descrição, prioridade e data válida. Se houver múltiplas unidades, seleciona uma. O sistema gera protocolo e usa a unidade como local quando o campo fica vazio. A web permite imagem opcional de até 2 MB e restringe o acesso ao anexo.', 'backend/includes/tickets.php', 'frontend/pages/novo-chamado.php', 'api/anexo.php'),
      rule('Visibilidade', 'O morador vê os próprios chamados, o síndico vê os do condomínio sob sua gestão e o administrador pode consultar todos. Prestadores veem chamados abertos livres e os atribuídos a si. Chamados livres omitem campos privados para prestadores.', 'backend/includes/tickets.php', 'api/tickets.php'),
      rule('Propostas e ciclo do chamado', 'Um prestador pode enviar uma proposta por chamado, de até 4.000 caracteres, ou assumir um chamado aberto e livre. O autor pode escolher uma proposta. A atribuição é de um único prestador, muda o status para em andamento e abre o chat. O solicitante ou síndico responsável pode cancelar, e o prestador atribuído pode concluir. Mudanças entram no histórico e podem gerar notificações.', 'backend/includes/tickets.php', 'backend/includes/chat.php'),
      rule('Visita e orçamento', 'O prestador atribuído pode agendar visita futura e enviar orçamento com descrição e valor positivo em chamado em andamento. O morador decide sobre o orçamento pendente. Uma versão aceita fica imutável. Quando a política de visita está ativa, calcula distância em linha reta com raio máximo, tarifa base, excedente, mínimo e arredondamento. O total inclui serviço e visita e a aceitação registra a versão e o consentimento.', 'backend/includes/tickets.php', 'backend/includes/visit_pricing.php'),
      rule('Avaliação do prestador', 'Após a conclusão, o autor do chamado pode avaliar uma vez o prestador atribuído. Nota geral, qualidade, pontualidade e comunicação vão de 1 a 5, com comentário de até 2.000 caracteres. O perfil exibe média e distribuição.', 'backend/includes/reviews.php', 'backend/database/migrations/20261117_reviews.php'),
    ],
  },
  {
    title: 'Chat, comunicados, reservas e notificações',
    entries: [
      rule('Chat', 'Conversas diretas incluem administração ou morador e síndico responsável. A conversa com prestador depende de chamado atribuído em andamento ou concluído. O prestador atribuído ou o síndico participante pode iniciar mensagens e o morador responde. Cancelamento encerra envios. Mensagens de até 4.000 caracteres são exibidas aos participantes autorizados.', 'backend/includes/chat.php', 'api/chat.php'),
      rule('Comunicados', 'Administrador e síndico responsável podem criar, editar, publicar, arquivar ou excluir logicamente. Morador vê comunicados publicados no seu escopo e pode marcar leitura. Alterações no conteúdo reiniciam a leitura e publicações notificam moradores ativos do condomínio principal.', 'backend/includes/community.php', 'frontend/pages/comunicados.php'),
      rule('Reservas', 'Morador, síndico ou administrador com acesso ao condomínio pode reservar área ativa em intervalo futuro de até 24 horas, sem conflito com reserva confirmada na mesma área. A confirmação é imediata. Titular ou gestor pode cancelar. A agenda preserva o nome dos demais moradores.', 'backend/includes/community.php', 'frontend/pages/reservas.php'),
      rule('Notificações', 'As notificações pertencem ao usuário e a lista mostra até as cem mais recentes. O usuário pode marcar uma ou todas como lidas. O destino depende do contexto, como chat, chamado, avaliação ou área comum.', 'backend/includes/functions.php', 'backend/includes/community.php', 'api/notificacoes.php'),
    ],
  },
  {
    title: 'Cobranças, comissões, Pix e assinaturas',
    entries: [
      rule('Cobrança de serviço ou visita', 'O prestador atribuído emite cobrança em BRL no chat ativo de chamado em andamento ou concluído. A cobrança exige descrição de até 500 caracteres, valor total positivo, vencimento a partir de hoje e chave idempotente. O morador recebe aviso. Estados possíveis incluem pendente, aguardando pagamento, pago, vencido, cancelado e estornado. O prestador pode cancelar a própria cobrança pendente ou vencida antes de uma tentativa de pagamento externo.', 'backend/includes/billing.php', 'api/cobrancas.php'),
      rule('Comissão da plataforma', 'O administrador configura taxas separadas para serviço e visita. Para cada parcela abaixo de R$ 1.000, a faixa é de 3% a 5%, com padrão de 3%. A partir de R$ 1.000, a faixa é de 5% a 8%, com padrão de 5%. A comissão é arredondada por parcela e registrada na emissão. O Pix envia o total ao recebedor configurado. O repasse automático à plataforma está pendente.', 'backend/services/commission_policy.php', 'api/comissoes.php'),
      rule('Pagamento Pix e conciliação', 'O checkout piloto depende do prestador e da conta Mercado Pago configurados. O morador titular precisa de CPF de 11 dígitos e e-mail válido. A emissão inicial ocorre entre 31 minutos e 30 dias antes do vencimento. Tentativas existentes são reutilizadas. Quando uma emissão fica dez minutos sem retorno, exige conferência. O webhook assinado consulta o provedor e concilia referência, valor, recebedor e status, com avisos de pagamento e estorno integral.', 'backend/services/billing_mercadopago.php', 'api/mercadopago.php'),
      rule('Mensalidade de condomínio', 'A assinatura custa R$ 500 por mês até 40 moradores ativos vinculados e R$ 1.000 acima disso. A contagem usa moradores distintos e exclui os pendentes. O administrador ajusta situação, vencimento de 1 a 28 e antecedência de aviso de 1 a 30 dias. Cada ciclo registra contagem e valor. A geração é manual. Envio automático de aviso e fluxo de pagamento da mensalidade estão pendentes.', 'backend/services/condominium_subscription.php', 'api/assinaturas-condominio.php'),
    ],
  },
  {
    title: 'Assistente, API, app e demonstrações',
    entries: [
      rule('Assistente do site', 'A rota usa sessão web e proteção CSRF. Responde com o catálogo local de guias, filtrado pelo perfil e pela verificação de síndico. Recebe até 2.000 caracteres e orienta a reformular a pergunta ou procurar Contato quando necessário. A integração separada com a OpenAI está fora do fluxo dessa rota.', 'api/openai.php', 'backend/services/assistant_service.php', 'backend/services/openai_service.php'),
      rule('Sessão da API e escopo do app', 'A API PHP responde em JSON e usa token Bearer de sete dias, armazenado como hash e revogado no logout. A conta deve estar ativa. O app conectado oferece chamados, notificações, perfil de consulta e seleção de condomínio autorizada para síndicos. Chat, anexos, reservas, pagamentos, edição de perfil e recuperação ficam na web.', 'api/_api.php', 'api/me.php', 'api/tickets.php', 'mobile/README.md'),
      rule('Ambientes de demonstração', 'A demonstração Expo usa estado fictício no dispositivo. A API alternativa Netlify usa Blobs e exige ambiente de desenvolvimento com demo explicitamente habilitada. O PHP possui habilitação própria para contas demo.', 'mobile/src/lib/demo-store.ts', 'netlify/functions/api.mjs', 'backend/database/seed_demo.php'),
    ],
  },
  {
    title: 'Site público e contato',
    entries: [
      rule('Mensagem de contato', 'O formulário público exige nome, e-mail válido, assunto e mensagem. Os três primeiros campos aceitam até 30 bytes e a mensagem até 300. O site grava a mensagem no banco e confirma o recebimento na página.', 'frontend/pages/contato.php'),
    ],
  },
  {
    title: 'Próxima etapa e pontos a decidir',
    entries: [
      rule('CRUD administrativo proposto', 'Cadastrar, consultar, editar, bloquear e reativar contas. Restringir ações a administradores ativos. Preservar históricos no bloqueio, proteger a própria conta de bloqueio ou rebaixamento, manter pelo menos um administrador ativo e registrar mudanças em auditoria. Alterações de papel devem validar vínculos e requisitos do novo perfil.', 'frontend/pages/admin-usuarios.php', 'backend/includes/auth.php'),
      rule('Divergências de regra', 'Alinhar o CPF obrigatório do formulário com a API que aceita omissão. Confirmar se o condomínio deve permitir múltiplos síndicos, pois o esquema admite vínculos múltiplos e um teste exige exclusividade. Revisar reservas e leitura de comunicados quando o condomínio em uso difere do principal. Alinhar a reativação de registros legados ao fluxo de condomínio suspenso.', 'api/register.php', 'tests/Integration/UserFunctionsTest.php', 'backend/includes/community.php'),
      rule('Navegação a corrigir', 'O menu lê $isVerified sem definição. Links de pedidos de unidade e de administração de condomínios ou síndicos apontam para rotas públicas ausentes apesar de existirem páginas internas correspondentes.', 'frontend/includes/navbar.php', 'frontend/pages/admin-usuarios.php'),
    ],
  },
];

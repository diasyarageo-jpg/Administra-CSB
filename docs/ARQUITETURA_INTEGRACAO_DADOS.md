# Arquitetura de Integração de Dados — Administra Barragens

Este documento registra a arquitetura acordada de governança cadastral e integração entre o **Administra** e os sistemas **Classifica**, **Notifica** e **Fiscaliza** no âmbito da Coordenadoria de Segurança de Barragens (CSB / SURH / SEMA-MT).

> **Escopo desta entrega:** documentação arquitetural de referência e especificação da fundação S2S v2 versionada neste repositório. A migration corretiva incremental `supabase/migrations/20261127_s2s_v2_fix_cadastro_novo_entidade_origens.sql` (que alinha exclusivamente `public.s2s_executar_cadastro_novo` ao schema real de `public.entidade_origens`) está preparada no repositório para revisão e execução controlada — **não** deve ser presumida como aplicada em produção.

---

## 1. Fonte Oficial e Única (Master Data)

O **Administra** é a **fonte oficial e única** de cadastros mestres para as quatro entidades centrais:

1. **Empreendedores** (`empreendedores`)
2. **Empreendimentos** (unidades/propriedades rurais ou urbanas associadas aos empreendedores e respectivos registros fundiários/CAR)
3. **Barragens** (`barragens`, incluindo titularidade vigente e histórico de vínculos)
4. **Responsáveis Técnicos — RTs** (`rts` e vínculos técnicos com barragens/ARTs)

Todas as decisões de criação, consolidação, vinculação, transferência de titularidade e inativação dessas entidades pertencem exclusivamente ao domínio do Administra.

---

## 2. Papel dos Sistemas Satélites

Os sistemas **Classifica**, **Notifica** e **Fiscaliza**:

- **Mantêm seus próprios fluxos operacionais** e regras de negócio específicas (classificação CRI/DPA, emissão de notificações/ofícios, planejamento e execução de vistorias/fiscalização).
- **Referenciam as entidades mestras pelo identificador oficial do Administra**, evitando cadastros paralelos independentes ou sobrescrita unilateral de atributos mestres.
- Consultam ou exibem documentos e vínculos correlacionados preservando a separação entre dados operacionais de cada sistema e o cadastro mestre oficial.

---

## 3. Política Híbrida e Fundação S2S v2 (`default-deny`)

As operações servidor-a-servidor (`/api/v2/operacoes`) seguem o princípio **default-deny**: tudo é proibido por padrão enquanto não existir política ativa na tabela `public.integracao_s2s_politicas` para `(sistema_origem, operacao)` **e** validação completa no backend (assinatura Ed25519 + nonce anti-replay + escopo `operacoes:write` + contrato de payload tipado + idempotência + auditoria sanitizada).

### 3.1. Operações Liberadas (Mediante Política Ativa)

1. **Cadastro novo (`execucao_direta`, somente se inexistente):** `cadastrar_empreendedor`, `cadastrar_barragem`, `cadastrar_rt`. Não sobrescrevem registros existentes (`409 DUPLICATE_RECORD`) e registram origem (`sistema_origem`, usuário/matrícula) e auditoria transacional.
2. **Proposta de alteração em cadastro existente (`proposta_aprovacao` obrigatório):** `propor_alteracao_empreendedor`, `propor_alteracao_barragem`, `propor_alteracao_rt`. Criam solicitação `Pendente` em `public.integracao_s2s_solicitacoes` e **nunca** aplicam alteração direta no cadastro mestre.
3. **Cancelamento de solicitação ainda pendente (`execucao_direta` restrita):** `cancelar_solicitacao_pendente`, permitido apenas ao mesmo sistema de origem e ao solicitante/delegado autorizado em política, com motivo obrigatório e trilha de auditoria.

### 3.2. Operações Bloqueadas por Padrão

- **Bloqueadas por lacuna de contrato no repositório (`ativo = false` por constraint e bloqueio no backend):**
  - `cadastrar_empreendimento` e `propor_alteracao_empreendimento`: não há DDL/migration de tabela `public.empreendimentos` versionada neste repositório (apenas `empreendedores.empreendimentos` JSONB e `barragens.empreendimento` texto).
  - `registrar_documento`: não há DDL/migration versionada para `public.documentos_catalogo` nem índice único de idempotência `(origem_sistema, origem_documento_id)` neste repositório.
- **Bloqueadas nesta etapa até definição de fluxo específico:**
  - `desativar_cadastro`, `cancelar_ato_aplicado`, `transferir_titularidade`, `reverter_ato`.

---

## 4. Governança, Aprovação e Restrições Vigentes

- **Gestão de políticas e aprovação exclusivas de Administrador:** apenas usuário com papel ativo `Administrador` autenticado no Administra (`/api/v2/politicas` e `/api/v2/solicitacoes`, validadas novamente no banco por `public._validar_admin_ativo_s2s`) pode criar/alterar políticas ou aprovar/rejeitar solicitações. Sistemas S2S e chamadas `service_role` sem contexto de Administrador ativo são bloqueados.
- **Isolamento do navegador:** as tabelas `integracao_s2s_politicas`, `integracao_s2s_solicitacoes` e `integracao_s2s_operacoes_log` e as funções `SECURITY DEFINER` relacionadas têm acesso revogado para `PUBLIC`, `anon` e `authenticated`.
- **Desindexação preservada:** o domínio oficial e os deployments Preview mantêm `<meta name="robots" content="noindex, nofollow" />` em `index.html` e o cabeçalho `X-Robots-Tag: noindex, nofollow` em `vercel.json`.

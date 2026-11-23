# Arquitetura de Integração de Dados — Administra Barragens

Este documento registra a arquitetura acordada de governança cadastral e integração entre o **Administra** e os sistemas **Classifica**, **Notifica** e **Fiscaliza** no âmbito da Coordenadoria de Segurança de Barragens (CSB / SURH / SEMA-MT).

> **Escopo desta entrega:** documentação arquitetural de referência. Nenhuma API de escrita/criação cadastral, sincronização automática de gravação, alteração de schema SQL ou migration foi implementada nesta etapa.

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

## 3. Política Híbrida para Propostas Futuras de Cadastro

Em etapa futura, os sistemas **Classifica**, **Notifica** e **Fiscaliza** poderão **propor** ao Administra o cadastro de uma entidade ausente identificada em seus fluxos operacionais, seguindo obrigatoriamente uma **política de migração híbrida**:

### 3.1. Caminho Automático (Restrito)

A criação automática no Administra só poderá ocorrer quando a proposta atender **simultaneamente** a todos os critérios abaixo:

1. **Validações cadastrais e estruturais aprovadas:** campos obrigatórios completos, formato válido (ex.: CPF/CNPJ completo e válido quando aplicável, registro profissional válido para RT, coordenadas e município consistentes) e ausência de dados mascarados/truncados.
2. **Verificação determinística de duplicidade sem ambiguidade:** confirmação objetiva de que a entidade ainda não existe no cadastro mestre e de que não há múltiplos candidatos ou conflitos com registros vigentes.
3. **Rastreabilidade registrada:** gravação obrigatória da **origem** (sistema proponente e referência de origem) e da **data** (carimbo temporal da proposta/criação) para auditoria e proveniência.

### 3.2. Revisão Humana Obrigatória

Qualquer proposta que não satisfaça os critérios estritos de automação deve ser retida para **revisão humana** no Administra antes de gerar ou alterar um registro mestre, incluindo obrigatoriamente:

- **Casos inválidos ou incompletos:** campos essenciais ausentes, documentos mascarados ou inválidos, coordenadas fora dos limites válidos ou inconsistentes.
- **Casos ambíguos:** múltiplos candidatos no cadastro mestre, homônimos sem identificador forte, conflito de titularidade/papel (ex.: pessoa notificada ou responsável pela área versus empreendedor/proprietário) ou múltiplas barragens compartilhando o mesmo código CAR (já que o CAR não identifica uma barragem isoladamente).
- **Registro de fila e proveniência:** toda ocorrência encaminhada à revisão humana preserva **origem**, **data**, evidências de comparação e decisão final do usuário responsável.

---

## 4. Estado Atual e Restrições Vigentes

- **Sem endpoints de escrita externa:** não existem nesta fase rotas de criação ou atualização automática disparadas pelos sistemas satélites, nem rotinas de escrita ou migração automática de dados.
- **Rota S2S bloqueada:** a integração servidor-a-servidor permanece bloqueada e inalterada.
- **Leitura e conciliação assistida:** as rotinas atuais operam sem mesclagem ou criação automática unilateral, exigindo validação assistida para consolidação de vínculos e auditoria de proveniência.
- **Desindexação preservada:** o domínio oficial e os deployments Preview mantêm `<meta name="robots" content="noindex, nofollow" />` em `index.html` e o cabeçalho `X-Robots-Tag: noindex, nofollow` em `vercel.json` (camada exclusiva de não indexação por buscadores, complementar e nunca substituta ao controle de acesso e autenticação).

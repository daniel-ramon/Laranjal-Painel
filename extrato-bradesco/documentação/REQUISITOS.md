# Dashboard Financeiro — Requisitos

Versão 0.1 (30/10/2026). Rascunho: as decisões marcadas como **[pendente Qn]** dependem das
perguntas da seção 8.

## 1. Objetivo

Centralizar contas a pagar, contas a receber, extratos bancários e antecipações de títulos em um
só sistema, com visão consolidada, identificação de atrasos e apoio de LLM para categorizar
lançamentos e sugerir decisões.

## 2. Escopo funcional inicial

| Página | Conteúdo |
|---|---|
| Dashboard | Totais de contas a pagar e a receber, filtráveis por categoria e por data |
| Contas a pagar | Lista detalhada, com identificação de atrasados |
| Contas a receber | Lista detalhada, com identificação de atrasados e de títulos cedidos |
| Extratos | Movimentação por banco e conta |
| Importações | Envio manual de faturas de cartão e documentos de antecipação |
| Assistente | Sugestões de categoria e dicas sobre gastos e entradas |

## 3. Fontes de dados

| Fonte | Dados | Meio | Situação |
|---|---|---|---|
| ERP | Títulos a pagar e a receber, clientes, fornecedores, categorias | API (futuro) | **[pendente Q1]** |
| Bradesco | Extrato de conta corrente | API OAuth2 + mTLS | Cliente pronto neste repositório; validado só no sandbox, que é um stub |
| BMP (banco 274) | Boletos, extrato, antecipações | **A definir** | **[pendente Q2]** |
| Faturas de cartão | Itens da fatura | Upload | **[pendente Q12]** |
| Termos de cessão | Borderô de títulos cedidos | Upload de PDF | Layout analisado (seção 4) |

**Risco — BMP:** a busca pública não encontrou documentação de API de extrato ou boletos do BMP. O
único portal achado cobre FGTS, a Kobana indica conexão só por EDI para esse banco, e a Omie
documenta CNAB 240 para pagamentos. Isso não prova que a API não exista: é preciso perguntar ao
gerente do BMP. Se não houver API, o plano B é importar CNAB e OFX/CSV.

## 4. O que o documento de antecipação mostra

Termo de Cessão analisado:

- 88 títulos; a soma confere com o total do documento: R$ 125.210,87.
- Preço de aquisição de R$ 120.756,63, ou seja, deságio de R$ 4.454,24 (3,56%).
- Prazo médio ponderado de cerca de 30 dias, com vencimentos de 04/11 a 14/12/2026.
- Cerca de 31 grupos de sacados (raiz de CNPJ).

Consequências para o projeto:

1. **Título cedido não é mais "a receber" comum.** O dinheiro já entrou na cessão e o sacado paga
   ao fundo. Se o total ignorar isso, o caixa previsto fica superestimado em cada borderô. O
   dashboard precisa separar "em carteira" de "cedido".
2. **Há risco de recompra.** O termo tem avalista como devedor solidário, então um título cedido
   atrasado pode virar passivo. **[pendente Q6]**
3. **A cessionária é a Confiança FIDC, não o BMP.** O BMP aparece só pelo código 274 na conta de
   depósito. O modelo deve tratar instituição financeira e cessionário como entidades distintas.
4. **A conta de depósito tem CNPJ diferente da cedente.** 44.236.451/0001-06 no depósito, contra
   22.175.369/0001-78 no nome do arquivo. **[pendente Q5]**
5. **Não há custo por título.** O documento só traz o deságio agregado; o custo por título exige
   rateio, e taxas à parte precisam de outra fonte.
6. **Vencimentos caem em fim de semana** (07/11, 28/11 e 29/11/2026), o que afeta a regra de
   atraso. **[pendente Q9]**
7. **O parser precisa conferir o total.** O título 11486-1 está quebrado entre duas páginas e um
   parser ingênuo o perde. A importação só deve ser aceita se a soma bater com o total impresso.

## 5. Requisitos técnicos

### 5.1 Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Backend | Python 3.12+, FastAPI, Pydantic v2 | Reaproveita o cliente Bradesco, os modelos e os testes já existentes; tipagem validada na borda |
| Banco | PostgreSQL | `NUMERIC` exato para dinheiro, transações, constraints e consultas de agregação; substitui o SQLite atual |
| Acesso a dados | SQLAlchemy 2 + Alembic | Queries parametrizadas e migrações versionadas |
| Jobs | Procrastinate (fila sobre o PostgreSQL) | Retentativas e agendamento duráveis sem adicionar Redis |
| Frontend | React, TypeScript, Vite, TanStack Query e Table, shadcn/ui, ECharts | Tabelas densas e filtros, com ecossistema grande **[pendente Q19]** |
| PDF | pdfplumber, com um parser por layout | Determinístico e auditável; LLM só como fallback |
| LLM | SDK oficial `anthropic`, modelo `claude-opus-5-5` ($4/$20 por MTok) | Structured outputs para respostas validadas, Batches (50% do custo) para o histórico |
| Empacotamento | Docker Compose, Caddy (TLS automático) | Ambiente reproduzível com um único comando de deploy |
| Qualidade | uv, ruff, mypy, pytest, respx, Testcontainers, Playwright | `ruff`, `pytest` e `respx` já são usados aqui |
| CI | GitHub Actions, pip-audit, gitleaks, Dependabot | Bloqueia vulnerabilidade conhecida e segredo versionado |

**Arquitetura:** monólito modular (`financeiro`, `integracoes`, `importacao`, `assistente`, `auth`).
Uma pessoa mantém um deploy só; os módulos podem ser separados depois, se for necessário. Cada fonte
fica atrás de uma interface `Conector`, no mesmo padrão do `Notifier` atual, para que trocar CNAB por
API no BMP não toque no resto do código.

**Custo do LLM:** o modelo padrão fica configurável. Para categorização em volume, vale medir o
`claude-haiku-5-5` ($0,10/$0,50 por MTok) com um conjunto de avaliação antes de decidir a troca.

### 5.2 Modelo de dados (núcleo)

`empresa`, `conta_bancaria`, `parte` (cliente/fornecedor), `categoria`, `titulo` (pagar/receber),
`baixa`, `movimento_bancario`, `conciliacao`, `cessao`, `cessao_titulo`, `fatura_cartao`,
`item_fatura`, `documento`, `importacao`, `regra_categorizacao`, `sugestao_ia`, `audit_log`.

Regras:

- Dinheiro em `NUMERIC(15,2)` e `Decimal`; nunca `float`. As datas de vencimento são `DATE`, e as
  demais datas usam o fuso `America/Sao_Paulo`.
- Todo registro guarda `origem` e `id_externo`, com unicidade entre os dois, para a importação ser
  idempotente.
- O status do título (aberto, atrasado, pago, cedido, recomprado) é derivado no backend, em um único
  lugar, e nunca calculado no frontend.
- Documentos recebem hash SHA-256, o que barra reimportação do mesmo arquivo.
- Fatura de cartão e título do ERP podem representar a mesma despesa; o total precisa evitar a dupla
  contagem. **[pendente Q12]**
- Transferências entre contas próprias não contam como entrada nem saída.

### 5.3 Segurança

| Tema | Requisito |
|---|---|
| Acesso à rede | Sistema fora da internet pública, acessível por VPN (WireGuard/Tailscale) **[pendente Q18]** |
| Autenticação | Sessão no servidor, cookie `HttpOnly`/`Secure`/`SameSite`, senha com Argon2id, TOTP obrigatório |
| Autorização | Perfis por papel, checados no backend em toda rota **[pendente Q17]** |
| Web | Proteção CSRF, CSP restritiva, rate limit no login, validação de upload (tipo real, tamanho) |
| Segredos | Fora do código e da imagem Docker: Docker secrets ou SOPS + age; rotação documentada |
| Certificado do banco | Chave mTLS somente leitura, acessível apenas pelo worker de integração |
| ERP | Credencial somente leitura; o sistema não escreve no ERP **[pendente Q3]** |
| Dados em repouso | Disco criptografado; campos sensíveis (conta, CPF) criptografados na aplicação |
| Backup | Diário, criptografado, fora do servidor (restic), com teste de restauração agendado |
| Auditoria | `audit_log` somente inserção: quem, quando, antes e depois, inclusive decisões sobre sugestões da IA |
| Logs | Sem token, documento ou dado bancário (o `logging_setup` atual já silencia o httpx) |
| LGPD | CPFs de avalistas, sacados pessoa física e signatários são dados pessoais: definir base legal, retenção e acesso |

**Antes de produção:** o README registra credenciais em texto puro em
`C:\TOTVS2410\Protheus\bin\certificado\cliente_id.txt`, que precisam ir para um cofre. Esta pasta
ainda não é um repositório git; ao criar, conferir se `.env` e `certs/` ficaram de fora.

### 5.4 Regras para o uso de LLM

1. **O LLM não faz contas.** Totais vêm de SQL; o modelo só comenta números já calculados e recebidos
   no prompt.
2. **O LLM não grava direto.** Toda categoria é uma sugestão com confiança e justificativa, que uma
   pessoa aprova; a aprovação pode virar regra determinística.
3. **Regras primeiro.** A categorização segue: regra exata, regra aprendida, e só então LLM. Assim o
   custo cai com o uso e o resultado é explicável.
4. **Minimização de dados.** CPF, conta bancária e dados de avalista são removidos ou pseudonimizados
   antes do envio.
5. **Documento é dado, não instrução.** PDFs e descrições podem conter texto malicioso (prompt
   injection), então a saída é validada por schema e o modelo não recebe ferramentas de escrita.
6. **Avaliação.** Um conjunto rotulado mede a acurácia antes de trocar modelo ou prompt.
7. **Rastreio.** Registrar modelo, versão do prompt, tokens e custo de cada chamada; limite mensal de
   gastos configurado.
8. **Conferir o contrato.** Confirmar retenção de dados da API com a Anthropic e registrar a operação
   no inventário de LGPD.

### 5.5 Requisitos não funcionais

- Dashboard responde em até 2 s com 5 anos de dados (índices em vencimento, categoria e status).
- Cada integração mostra a data da última sincronização bem-sucedida; dado defasado é sinalizado na
  tela, e falhas geram alerta pelo `Notifier`.
- Ambientes de desenvolvimento, homologação e produção com dados separados, como já ocorre hoje.
- Testes offline para cada conector, usando fixtures anonimizadas de respostas e documentos reais.

## 6. Reaproveitamento do código atual

| Módulo | Destino |
|---|---|
| `auth.py`, `bradesco.py`, `models.py` | Viram o conector Bradesco, praticamente inalterados |
| `notify/` | Passa a ser o canal de alertas |
| `storage.py` | Substituído por PostgreSQL; os valores hoje em `TEXT` migram para `NUMERIC` |
| `report.py`, comando `diario` | Mantidos como rotina do PDF diário **[pendente Q16]** |

## 7. Fases sugeridas

| Fase | Entrega |
|---|---|
| 0 | Repositório git, CI, Docker, PostgreSQL, autenticação com TOTP, auditoria |
| 1 | Bradesco no banco novo e página de extratos |
| 2 | Importação de títulos (ERP ou planilha), dashboard e páginas a pagar/a receber com atrasos |
| 3 | Importação de termos de cessão e faturas de cartão; separação carteira/cedido |
| 4 | Conector BMP e conciliação |
| 5 | LLM: categorização assistida, depois dicas |

## 8. Perguntas em aberto

Respostas devem ser registradas aqui, e as seções acima atualizadas.

### Fontes e integrações
- **Q1.** O ERP é o Protheus (há uma instalação em `C:\TOTVS2410`)? Ele já expõe REST, ou criamos endpoints em TLPP?
- **Q2.** O BMP oferece API de extrato e boletos, ou só internet banking e CNAB?
- **Q3.** O sistema só lê do ERP, ou algo deve voltar para ele (categoria, baixa)?
- **Q4.** Com que frequência os dados precisam atualizar?

### Antecipação
- **Q5.** De quem é a conta do CNPJ 44.236.451/0001-06 que recebe o depósito?
- **Q6.** Vocês recompram título cedido não pago? Como isso é registrado hoje?
- **Q7.** Título cedido entra no total "a receber"? Sugestão: separado, com filtro.
- **Q8.** Além do deságio há outras taxas? Onde elas aparecem? O sistema deve simular a antecipação antes do pedido?

### Regras de negócio
- **Q9.** Atraso conta a partir de quando, em fim de semana e feriado? Há carência?
- **Q10.** As categorias vêm das naturezas do ERP ou de um plano próprio? Há centro de custo?
- **Q11.** Regime de caixa, competência ou ambos? As datas filtram por vencimento, emissão ou pagamento?
- **Q12.** Como a fatura de cartão aparece no ERP: valor único a pagar? Os itens substituem esse valor na análise?
- **Q13.** Quantas contas bancárias e empresas/filiais entram? Precisa visão por CNPJ?

### Dashboard e IA
- **Q14.** Que decisões a IA deve apoiar? Exemplos: quando antecipar, qual fornecedor negociar, cliente com risco.
- **Q15.** Além dos totais, quer fluxo de caixa projetado, aging e inadimplência por cliente?
- **Q16.** O PDF diário por e-mail continua existindo?

### Acesso e operação
- **Q17.** Quantos usuários e quais perfis? Alguém só pode ver parte dos dados? Haverá edição manual de título?
- **Q18.** Onde vai rodar: nuvem no Brasil ou servidor na empresa? Precisa de acesso por celular fora da empresa?
- **Q19.** Você tem preferência de frontend? React é uma recomendação, não um requisito.
- **Q20.** Quanto de histórico importar no início e por quanto tempo reter documentos?

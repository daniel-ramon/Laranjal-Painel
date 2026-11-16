# Extrato Diário Bradesco

Rotina que consulta o extrato de conta corrente na API do Bradesco, gera um PDF e envia
automaticamente para um ou mais destinatários. Roda sem interface, agendada na máquina local.

Plano completo aprovado: `C:\Users\Daniel Ramon\.claude\plans\nested-waddling-cocke.md`
Documentação oficial do banco: `documentação/`

## Estado atual

| Fase | Situação |
|---|---|
| 0 — Spec da API | ✅ obtida dos manuais em `documentação/` |
| 1 — Esqueleto e configuração | ✅ |
| 2 — Autenticação | ✅ validada contra o sandbox real |
| 3 — Consulta do extrato | ✅ validada contra o sandbox real |
| 4 — Persistência / idempotência | ✅ |
| 5 — PDF | ✅ |
| 6 — Envio por e-mail | ✅ código pronto; falta você configurar o SMTP |
| 7 — Agendamento | ✅ `run_diario.bat` pronto; falta criar a tarefa |
| 8 — WhatsApp | ⏸ |
| 9 — Produção | ⏸ |

97 testes, todos offline.

## A API, em resumo

Fonte: `Manual do Desenvolvedor "mTLS" v1.0.0` e `Manual API de Saldo e Extrato v2.2.1`.

**Autenticação** — OAuth 2.0 `client_credentials` sobre mTLS. Não há JWT assertion.

| Ambiente | Token |
|---|---|
| Sandbox | `https://openapisandbox.prebanco.com.br/auth/server-mtls/v2/token` |
| Produção | `https://openapi.bradesco.com.br/auth/server-mtls/v2/token` |

`POST` com `application/x-www-form-urlencoded`, campos `grant_type=client_credentials`,
`client_id`, `client_secret`. Token vale 1 hora — o manual alerta que gerar tokens em excesso
pode acionar restrições de segurança, por isso o `TokenProvider` cacheia e reusa.

**Extrato** — `GET /v1/fornecimento-extratos-contas/extratos`

Params: `agencia` (4 dígitos, **sem** o dígito verificador), `conta` (7, sem dígito),
`dataInicio` e `dataFim` no formato `ddmmaaaa`, `tipo` (`cc`/`cp`), `tipoOperacao` (1/2).

A resposta traz **três blocos independentes**, cada um com seu próprio `codigoRetorno` e cobrindo
faixas de data distintas:

| Bloco | Cobertura | Estrutura |
|---|---|---|
| `extratoUltimosLancamentos` | D-1 e D0 | `listaLancamentos`: dict grupo → lista |
| `extratoLancamentosFuturos` | futuro | `listaLancamentos`: dict grupo → lista |
| `extratoPorPeriodo` | D-2 pra trás | `lstLancamentoMensal`: lista plana |

Detalhes que o parsing trata: valores vêm como texto pt-BR (`"1.233,00"`) com o sinal em campo
separado (`sinalLancamento`/`sinalSaldo`); datas em `DD/MM/AAAA`; o "Saldo Anterior" aparece
como se fosse um lançamento nos dois formatos e é extraído como saldo inicial, não somado aos
totais. O saldo final vem do `valorSaldoAposLancamento` do banco, e só cai para o cálculo
(anterior + créditos − débitos) se o banco não informar.

**Limites:** 5.000 transações por requisição; histórico de até 10 anos, recomendado consultar em
janelas de 1 ano. **Pré-requisito de negócio: ser correntista PJ.**

## Setup

```bash
py -3 -m venv .venv
```

```bash
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
```

Copie `.env.example` para `.env` e preencha. O `.env` e a pasta `certs/` estão no `.gitignore`.
Os hosts são derivados de `EXTRATO_ENV` — não precisa preenchê-los.

## Comandos

```bash
.\.venv\Scripts\python.exe -m extrato check-config --extrato
```

```bash
.\.venv\Scripts\python.exe -m extrato testar-auth
```

```bash
.\.venv\Scripts\python.exe -m extrato consultar --data-inicio 2024-11-06 --data-fim 2024-11-20
```

```bash
.\.venv\Scripts\python.exe -m extrato diario --dry-run
```

```bash
.\.venv\Scripts\python.exe -m pytest -q
```

`consultar` sem argumentos usa o dia anterior. `--salvar-json <caminho>` grava a resposta crua do
banco, útil para atualizar o fixture de teste.

`diario` é o comando do agendador: consulta o dia anterior, grava, gera o PDF, envia e expurga
PDFs antigos. Flags úteis:

- `--dry-run` — faz tudo menos enviar
- `--forcar` — reprocessa um dia já concluído
- `--payload <arquivo.json>` — usa uma resposta salva no lugar da API, para testar o pipeline
  inteiro (inclusive o envio real de e-mail) sem depender do banco

## Agendamento

`run_diario.bat` é o alvo da tarefa — ele ativa a venv, chama `diario` e propaga o código de
saída, para a tarefa aparecer como falha no Agendador quando algo der errado.

No Agendador de Tarefas do Windows, crie uma tarefa com:

- **Gatilho:** diariamente, 07:00
- **Ação:** iniciar programa → `run_diario.bat`, com "Iniciar em" apontando para a pasta do projeto
- **Executar mesmo que o usuário não esteja conectado**
- Em Configurações: **"Executar a tarefa assim que possível após uma inicialização agendada
  perdida"** — cobre o caso do PC estar desligado no horário

Se a execução falhar, a rotina manda um e-mail `[FALHA]` curto (sem stacktrace) para os mesmos
destinatários; o detalhe fica em `logs/extrato.log`.

## Estrutura

```
src/extrato/
  config.py         configuração validada, hosts derivados do ambiente, dirs por ambiente
  auth.py           client_credentials + mTLS, cache de token, tradução dos erros do FAQ
  bradesco.py       cliente da API: params, retry com backoff, renovação de token em 401/403
  models.py         Lancamento / Conta / Extrato + parsing dos 3 blocos e do formato pt-BR
  storage.py        SQLite: lançamentos com chave natural, execuções e envios
  report.py         PDF (ReportLab), resumo textual e expurgo por retenção
  notify/           base.py (interface Notifier) + email.py (SMTP)
  logging_setup.py  console + arquivo rotativo; httpx silenciado para não vazar token
  main.py           CLI (typer)
run_diario.bat      alvo do Agendador de Tarefas
tests/
  fixtures/extrato_sandbox.json   resposta real do sandbox
certs/  data/  out/  logs/        ignorados pelo git
```

## Idempotência

A API devolve o extrato inteiro a cada chamada, então rodar duas vezes o mesmo dia traria os
mesmos lançamentos. Cada lançamento recebe uma chave natural (conta + data + documento + código +
valor + descrição + ordinal) e a tabela recusa duplicatas — mas lançamentos genuinamente idênticos
no mesmo dia, como duas tarifas iguais, são preservados via ordinal.

Um dia só conta como processado depois de uma execução que **entregou** para alguém: se a consulta
ou o envio falhar, a próxima execução refaz o dia. Valores monetários são gravados como TEXT, não
REAL — ponto flutuante não tem lugar em dado financeiro.

## Decisões

- **ReportLab** no lugar de WeasyPrint para o PDF: WeasyPrint exige o runtime GTK/Pango instalado
  no Windows, dependência nativa frágil para um job desassistido. ReportLab é Python puro.
- **E-mail primeiro**, WhatsApp depois, ambos atrás da interface `Notifier` — trocar o canal não
  toca no resto do código.
- Base SQLite e pasta de saída **separadas por ambiente** (`data/sandbox` vs `data/prod`), para não
  misturar dado de teste com dado real.

## Observações sobre o sandbox

O sandbox **não é um ambiente de teste, é um stub**. Ele responde apenas ao conjunto exato de
parâmetros do manual:

```
agencia=3750  conta=75557  dataInicio=06112024  dataFim=20112024  tipo=cc
```

Qualquer outra combinação — inclusive um dia único dentro desse mesmo intervalo — devolve
`HTTP 404 {"cenario":"ERRO","mensagem":"Erro de estrutura."}`. O `{{header_token}}` não resolvido
no corpo da resposta confirma que é um mock.

Consequências práticas:

- o filtro de data **não é verificável** aqui;
- o comando `diario`, que consulta um dia único, **não roda contra o sandbox** — use
  `--payload tests/fixtures/extrato_sandbox.json` para exercitar o pipeline completo;
- a orquestração do `diario` é coberta por testes de integração offline
  (`tests/test_diario.py`), não pelo ambiente do banco.

## Segurança

O arquivo `C:\TOTVS2410\Protheus\bin\certificado\cliente_id.txt` guarda em texto puro as
credenciais de Cobrança, Pagamento, PIX e Extrato, e tem uma seção "PRODUÇÃO" ainda vazia. Quando
ela for preenchida, vale mover tudo para um gerenciador de senhas ou para o Windows Credential
Manager.

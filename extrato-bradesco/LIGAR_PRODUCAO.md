# Ligar a API real do Bradesco (produção)

Checklist para sair do modo **Demonstração** e passar a consultar o extrato real na
página **Banco › Bradesco** do painel.

> ⚠️ **Importante — qual pasta editar.** Existem duas cópias do projeto:
> - a original em `D:\Projetos\Projetos pessoais\API Extrato bradesco`
> - a cópia **que o painel usa**, em `D:\Laranjal\PainelCP\extrato-bradesco`
>
> Todas as edições abaixo (`.env`, `certs/`) devem ser feitas na **cópia do painel**:
> `D:\Laranjal\PainelCP\extrato-bradesco`.

---

## 1. Pré-requisitos (dependem do banco, não do código)

- [ ] **Ser correntista PJ** no Bradesco (exigência do manual da API).
- [ ] Acesso ao **portal Bradesco Developers** (https://developers.bradesco.com.br)
      com a empresa habilitada para a API **"Saldo e Extrato"**.

## 2. Gerar as credenciais e o certificado de produção

No portal, no ambiente **Produção** (não Sandbox):

- [ ] Criar ou selecionar a aplicação e **assinar o produto "Saldo e Extrato"**.
- [ ] Gerar o **`client_id`** e o **`client_secret`** de produção.
- [ ] Gerar/registrar o **certificado de cliente (mTLS)**. Você terá dois arquivos:
      o **certificado** (`.crt`/`.pem`) e a **chave privada** (`.key`).

> 🔑 **Regra de ouro do mTLS:** o certificado usado na chamada tem de ser **exatamente o
> mesmo** que foi cadastrado na geração da credencial no portal. Se forem diferentes, o
> banco responde `401 "SSL with client authentication is required"`.

## 3. Colocar o certificado na pasta do painel

Substitua os arquivos de sandbox pelos de produção em
`D:\Laranjal\PainelCP\extrato-bradesco\certs\`:

- [ ] `certs\certificado.crt`  ← seu certificado de produção
- [ ] `certs\chave.key`        ← sua chave privada de produção

(Pode usar outros nomes, desde que aponte os caminhos no `.env`, passo 4.)

## 4. Editar o `.env` da cópia do painel

Arquivo: `D:\Laranjal\PainelCP\extrato-bradesco\.env`

```ini
# troca o ambiente: os hosts passam a apontar para openapi.bradesco.com.br
EXTRATO_ENV=prod

# credenciais de PRODUÇÃO (do passo 2)
EXTRATO_CLIENT_ID=<seu client_id de produção>
EXTRATO_CLIENT_SECRET=<seu client_secret de produção>

# certificados (do passo 3)
EXTRATO_CERT_PATH=certs/certificado.crt
EXTRATO_KEY_PATH=certs/chave.key

# a CONTA REAL — agência e conta vão SEM o dígito
EXTRATO_AGENCIA=<4 dígitos, sem dígito verificador>
EXTRATO_CONTA=<até 7 dígitos, sem dígito verificador>
EXTRATO_CONTA_DIGITO=<o dígito, só para exibição>
EXTRATO_TIPO_CONTA=cc          # cc = corrente | cp = poupança
EXTRATO_TIPO_OPERACAO=1        # 1 = saldo do dia | 2 = unificado c/ Invest Fácil
```

> Os hosts de produção são derivados automaticamente de `EXTRATO_ENV=prod`
> (`https://openapi.bradesco.com.br`). Não precisa preencher URL nenhuma.

## 5. Reiniciar o painel

O `.env` é lido quando o servidor sobe. Depois de editar, reinicie o servidor do painel
para ele recarregar a configuração.

## 6. Testar

**Pelo painel (jeito mais direto):**
- [ ] Abra **Banco › Bradesco**.
- [ ] Troque a fonte de **Demonstração** para **API Bradesco**.
- [ ] Escolha o período (comece com um intervalo curto, ex.: últimos 7 dias) e clique **Aplicar**.

**Checagem de baixo nível (opcional), usando a venv do projeto original:**
```bat
cd "D:\Projetos\Projetos pessoais\API Extrato bradesco"
.\.venv\Scripts\python.exe -m extrato check-config --extrato
.\.venv\Scripts\python.exe -m extrato testar-auth
.\.venv\Scripts\python.exe -m extrato consultar --data-inicio 2026-11-01 --data-fim 2026-11-07
```
(Esses comandos de CLI usam `typer`, que só existe na venv do projeto original —
por isso rodam a partir da pasta original, não da cópia do painel.)

## 7. Boas práticas de produção

- **Não gere tokens em excesso.** O token vale 1 hora; o painel já reaproveita o token
  dentro de cada consulta. Evite ficar clicando "Aplicar" repetidamente em sequência —
  o banco pode acionar bloqueio de segurança (foi o que vimos no sandbox).
- **Janelas de no máximo ~1 ano** por consulta (limite de 5.000 lançamentos por requisição).
- **Segredos:** `.env` e `certs/` contêm credenciais e chave privada. Já estão no
  `.gitignore` da cópia. Se um dia o painel virar repositório git, confirme que essas
  duas entradas continuam ignoradas antes do primeiro commit.
- **Dica:** depois de validar produção, dá para tornar **"API Bradesco"** a fonte padrão
  da página (hoje o padrão é Demonstração).

---

## Resumo do que cada erro significa

| O que aparece | O que é | O que fazer |
|---|---|---|
| `400 invalid_client` | client_id/secret errados, de outro ambiente, ou throttling de token | Conferir credenciais de produção; esperar alguns minutos se foi excesso de tokens |
| `401 SSL with client authentication` | certificado mTLS diferente do cadastrado no portal | Usar o mesmo cert que gerou a credencial |
| `404 Erro de estrutura` | parâmetros fora do padrão (conta/agência/datas) | Conferir agência/conta **sem dígito** e o formato das datas |
| `configuracao incompleta` | falta algo no `.env` | Preencher o campo indicado na mensagem |

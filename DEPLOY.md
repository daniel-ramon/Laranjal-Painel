# Subir o Painel CP no servidor

Guia para rodar o painel no servidor da loja, acessível pela rede e pela VPN
(inclusive celular). **Sem login** por enquanto — ver a seção de segurança no fim.

Os segredos (`.env`, certificados do Bradesco) **não vêm no git** — você cria no
servidor a partir dos arquivos `.env.example`.

---

## 1. Pré-requisitos no servidor

| Item | Para quê | Observação |
|---|---|---|
| **Git** | clonar o projeto | — |
| **Node.js LTS** (18+) | rodar o painel | inclui o `npm` |
| **Python 3.13** | pontes (extrato, folha, adiantamentos) | o mesmo que a automação já usa |
| **Java 8 (JDK/JRE)** + `ojdbc14.jar` | acesso ao Oracle 10.2 via JDBC | só se `DRIVER=jdbc` (padrão) |
| **Rede até o Oracle** | consultar AK e JRF | o servidor precisa enxergar os bancos |

> O `ojdbc14.jar` **não** está no repositório (é binário do Oracle). Copie o que a
> loja já usa e aponte em `OJDBC_JAR`. A alternativa é `DRIVER=thick` com o Oracle
> Instant Client — ver `.env.example`.

## 2. Clonar o projeto

```bash
cd D:\Laranjal
git clone https://github.com/daniel-ramon/<REPO-DO-PAINEL>.git PainelCP
cd PainelCP
```

## 3. Instalar as dependências

Node:
```bash
npm install
```

Python (as pontes usam o Python do sistema):
```bash
python -m pip install openpyxl xlrd reportlab pydantic httpx pydantic-settings
```

Se for usar a folha de separação (página Entregas), instale também as dependências
da automação, porque a folha reaproveita o código dela:
```bash
python -m pip install -r D:\LARANJAL\pedidos-automacao\requirements.txt
```

## 4. Criar os segredos (não vêm do git)

**`.env` na raiz** — copie de `.env.example` e preencha:
```bash
copy .env.example .env
```
Preencha usuário/senha do Oracle (AK e JRF), o caminho do TNS, e — se `DRIVER=jdbc`
— `JAVA_BIN` e `OJDBC_JAR`. Deixe `USE_MOCK=false` para conectar no banco de verdade.

**Extrato Bradesco** — copie `extrato-bradesco\.env.example` para `extrato-bradesco\.env`
e coloque os certificados em `extrato-bradesco\certs\` (ver `extrato-bradesco\LIGAR_PRODUCAO.md`).
Se não for usar o Bradesco agora, a página funciona em modo **demonstração** sem isso.

## 5. Apontar para a automação de pedidos (página Entregas)

No `.env`, defina a pasta onde a automação está clonada no servidor:
```ini
PEDIDOS_DIR=D:\LARANJAL\pedidos-automacao
```
O painel só **lê** os pedidos e **lê/escreve** `lojas.csv` e `rotas.csv` dessa pasta.
A automação continua rodando sozinha pelo Agendador de Tarefas (rotina das 2h) — o
painel não interfere nisso.

## 6. Testar antes de virar serviço

```bash
node server.js
```
Abra `http://localhost:3300` no próprio servidor. Se as páginas carregam e o Oracle
responde, pode seguir.

## 7. Rodar como Serviço do Windows (NSSM)

Para o painel subir sozinho com a máquina, sem console aberto, use o **NSSM**
(https://nssm.cc):

```bash
nssm install PainelCP "C:\Program Files\nodejs\node.exe" "D:\Laranjal\PainelCP\server.js"
nssm set PainelCP AppDirectory "D:\Laranjal\PainelCP"
nssm set PainelCP Start SERVICE_AUTO_START
nssm start PainelCP
```

Para atualizar o painel depois: `git pull`, `npm install` (se mudou dependência),
e `nssm restart PainelCP`.

> Alternativa sem NSSM: `pm2` + `pm2-windows-startup`. O NSSM é o mais simples para
> um serviço único.

## 8. Liberar na rede da loja

O servidor Express já escuta em todas as interfaces. Abra a porta no firewall:

```bash
netsh advfirewall firewall add rule name="Painel CP 3300" dir=in action=allow protocol=TCP localport=3300
```

As máquinas da rede acessam `http://IP-DO-SERVIDOR:3300`.

## 9. Acesso externo e pelo celular

Duas formas (pode combinar):

- **VPN (recomendado).** Quem estiver na VPN acessa `http://IP-DO-SERVIDOR-NA-VPN:3300`,
  inclusive no celular. É o jeito mais seguro, porque o painel **não fica exposto na
  internet pública** — importante, já que não há login.
- **Proxy reverso com HTTPS (Caddy).** Coloque o Caddy na frente para ter um endereço
  bonito e **cadeado (HTTPS)** em vez de `http://ip:porta`. O Caddy cuida do certificado
  sozinho. Exemplo de `Caddyfile`:
  ```
  painel.sualoja.com.br {
      reverse_proxy localhost:3300
  }
  ```
  O celular abre `https://painel.sualoja.com.br`. (Precisa de um nome/DNS apontando
  para o servidor.)

A interface **já é responsiva** — no celular a barra lateral vira menu (botão ☰),
os cards empilham e as tabelas rolam na horizontal.

## 10. Segurança (ler antes de expor)

O painel **não tem login**. Os dados são informativos e as pessoas da loja já têm
acesso a eles — mas, mesmo assim:

- **Prefira a VPN** a abrir a porta direto para a internet. Se precisar expor para fora,
  faça via VPN ou atrás do Caddy, nunca com a porta 3300 crua na internet pública.
- Restrinja, no firewall, quem alcança a porta 3300 (rede da loja + faixa da VPN).
- Quando quiser, dá para adicionar um login simples depois, sem refazer nada.

---

### Resumo do fluxo de atualização

```bash
cd D:\Laranjal\PainelCP
git pull
npm install
nssm restart PainelCP
```

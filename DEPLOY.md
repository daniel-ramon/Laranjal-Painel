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

> **Python como serviço (importante):** rodando como serviço, o processo enxerga só
> o PATH do sistema. Se o Python foi instalado "só para o usuário", o `py`/`python`
> podem não ser encontrados (erro `spawnSync python ENOENT`). O painel tenta
> descobrir o `python.exe` sozinho, mas o jeito garantido é **fixar no `.env`** o
> caminho absoluto do interpretador onde as dependências Python foram instaladas:
> ```ini
> PYTHON_BIN=C:\Caminho\para\python.exe
> ```
> Descubra o caminho rodando, no mesmo console onde fez o `pip install`:
> `python -c "import sys;print(sys.executable)"`

> Alternativa sem NSSM: `pm2` + `pm2-windows-startup`. O NSSM é o mais simples para
> um serviço único.

## 8. Liberar na rede da loja

O servidor Express já escuta em todas as interfaces. Abra a porta no firewall:

```bash
netsh advfirewall firewall add rule name="Painel CP 3300" dir=in action=allow protocol=TCP localport=3300
```

As máquinas da rede acessam `http://IP-DO-SERVIDOR:3300`.

## 9. Acesso externo e pelo celular (DuckDNS + Caddy com HTTPS)

Objetivo: abrir o painel no celular de **qualquer lugar** (4G/outra rede), pelo
navegador, com cadeado (HTTPS) e sem instalar app. Como **não há login no painel**,
colocamos uma **senha no próprio Caddy** (`basic_auth`) para não deixar aberto.

> Alternativa sem expor na internet: **VPN** (Radmin para PCs, ou Tailscale para PC +
> celular). Mais seguro, mas o celular precisa do app da VPN. O caminho abaixo é o de
> acesso público pelo navegador.

### 9.1. Registrar o endereço no DuckDNS (grátis)

1. Acesse `https://www.duckdns.org` e entre com Google/GitHub.
2. Crie um subdomínio, ex.: `painelloja` → vira `painelloja.duckdns.org`.
3. Anote o **token** que aparece no topo da página.

Mantenha o endereço apontando para o IP da loja (que pode mudar) com uma Tarefa
Agendada no servidor, rodando a cada 5 min:

```powershell
# troque SUBDOMINIO e TOKEN
Invoke-RestMethod "https://www.duckdns.org/update?domains=SUBDOMINIO&token=TOKEN&ip="
```

(O `ip=` vazio faz o DuckDNS usar o IP público de onde a chamada saiu — o da loja.)

### 9.2. Roteador: redirecionar portas (precisa de acesso ao roteador)

No roteador da loja, crie **port forwarding**:

| Porta externa | Protocolo | Destino | Porta interna |
|---|---|---|---|
| 80 | TCP | 192.168.30.61 | 80 |
| 443 | TCP | 192.168.30.61 | 443 |

A porta 80 é só para o Caddy emitir o certificado; o acesso é pela 443.
Sem esse redirecionamento, o endereço **não abre de fora**.

### 9.3. Firewall do servidor: liberar 80 e 443

```bash
netsh advfirewall firewall add rule name="Caddy HTTP 80" dir=in action=allow protocol=TCP localport=80
netsh advfirewall firewall add rule name="Caddy HTTPS 443" dir=in action=allow protocol=TCP localport=443
```

### 9.4. Instalar o Caddy e configurar

Instale o Caddy (ex.: `winget install CaddyServer.Caddy`, ou baixe o `.exe` em
`https://caddyserver.com/download`). Gere o hash da senha de acesso:

```bash
caddy hash-password --plaintext "SUA_SENHA"
```

Crie o `Caddyfile` (ex.: `C:\caddy\Caddyfile`) com o subdomínio, a senha e o proxy
para o painel:

```
painelloja.duckdns.org {
    basic_auth {
        laranjal <HASH_GERADO_ACIMA>
    }
    reverse_proxy localhost:3300
}
```

> Se não quiser senha, remova o bloco `basic_auth` — mas aí o painel fica aberto
> para quem tiver o endereço.

### 9.5. Rodar o Caddy como serviço (NSSM) e testar

```bash
nssm install Caddy "C:\caddy\caddy.exe" "run --config C:\caddy\Caddyfile"
nssm set Caddy AppDirectory "C:\caddy"
nssm set Caddy Start SERVICE_AUTO_START
nssm start Caddy
```

No celular, **fora do Wi-Fi da loja** (ex.: 4G), abra `https://painelloja.duckdns.org`.
Deve pedir a senha e abrir o painel com cadeado.

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

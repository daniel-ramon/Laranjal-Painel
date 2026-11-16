# Painel Contas a Pagar (AK + JRF)

Painel web para monitorar contas a pagar das bases **AK** (AKHORTIFRUTI) e **JRF** (LARANJAL)
no Oracle 10.2, em tempo (quase) real.

## Como rodar
```
cd D:\Laranjal\PainelCP
npm start
```
Depois abra no navegador: http://localhost:3300

## Telas
- **Visão geral:** cards de Atrasados, Vencem hoje e Próximos vencimentos, com quebra por empresa (AK/JRF).
- **Contas a pagar:** KPIs clicáveis (Vencidos, Vencem hoje, Vencem esta semana, Pagos) que filtram a
  lista; lista ordenada do vencimento mais próximo ao mais distante; seletor de mês (‹ ›).

## Como conecta
- **Driver JDBC** (sem Oracle Instant Client): o Node chama um programa Java (`java/OraRunner`)
  que usa o `ojdbc14.jar` do cliente Oracle já instalado. Config em `.env` (`DRIVER=jdbc`).
- Competência = mês do **DTVENC**. "Pago" = **STATUS = 'B'** (A = aberto). Semana = seg–dom.
- Nome do fornecedor vem do join com a tabela **FORNECEDOR** (CODFORNEC → FORNECEDOR).

## Configuração (.env)
- `USE_MOCK=false` usa o Oracle; `true` usa dados de exemplo (para testar sem banco).
- `AK_PASSWORD` / `JRF_PASSWORD`: senha do usuário `DBCONSULTA`.
- `AK_JDBC` / `JRF_JDBC`: URLs JDBC (troque o host pelo IP se o nome não resolver).
- `JAVA_BIN` / `OJDBC_JAR`: caminhos do Java 8 e do driver.

## Recompilar o programa Java (só se editar OraRunner.java)
```
"C:\Program Files\Java\jdk1.8.0_202\bin\javac.exe" -encoding UTF-8 java\OraRunner.java
```

## Observações
- É **somente leitura** (consulta). Não altera nada no ERP.
- Precisa rodar numa máquina com acesso de rede às duas bases (hosts AK-SERVER e DESKTOP-1MSLGLE).

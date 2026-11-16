@echo off
REM Alvo do Agendador de Tarefas do Windows.
REM Sai com codigo != 0 em caso de falha, para a tarefa aparecer como erro no Agendador.

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo ERRO: ambiente virtual nao encontrado em .venv
    exit /b 2
)

".venv\Scripts\python.exe" -m extrato diario %*
exit /b %ERRORLEVEL%

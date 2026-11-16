"""CLI do projeto.

Comandos disponiveis hoje (Fases 1 e 2):
  check-config  valida .env, certificados e diretorios
  testar-auth   obtem um access_token real no ambiente configurado

Os comandos de consulta, PDF e envio entram nas fases seguintes, depois que a
spec da API de Extrato for confirmada no portal Bradesco Developers.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal

import typer

from . import __version__
from .auth import AuthError, TokenProvider, criar_http_client
from .bradesco import ClienteBradesco, ExtratoHTTPError
from .config import get_settings
from .logging_setup import configurar_log
from .models import Conta, Extrato, ExtratoAPIError, parse_extrato
from .notify import EmailNotifier
from .report import expurgar_antigos, gerar_pdf, gerar_resumo, nome_arquivo
from .storage import STATUS_ERRO, STATUS_OK, Storage

app = typer.Typer(add_completion=False, help="Extrato diario Bradesco")
log = logging.getLogger(__name__)


def _preparar():
    settings = get_settings()
    settings.ensure_dirs()
    configurar_log(settings.logs_dir, settings.log_level)
    return settings


@app.command()
def version() -> None:
    """Mostra a versao."""
    typer.echo(f"extrato-bradesco {__version__}")


@app.command("check-config")
def check_config(
    email: bool = typer.Option(False, "--email", help="Tambem validar a configuracao de e-mail."),
    extrato: bool = typer.Option(
        False, "--extrato", help="Tambem validar conta e path da API de extrato."
    ),
) -> None:
    """Valida a configuracao e o material criptografico."""
    settings = _preparar()
    problemas = settings.validar(exigir_extrato=extrato, exigir_email=email)

    typer.echo(f"ambiente      : {settings.env}")
    typer.echo(f"token url     : {settings.token_url}")
    typer.echo(f"certificado   : {settings.cert_path}")
    typer.echo(f"chave privada : {settings.key_path}")
    typer.echo(f"conta         : {settings.conta_formatada or '(nao configurada)'}")
    typer.echo(f"destinatarios : {len(settings.destinatarios)}")
    typer.echo(f"dados / saida : {settings.data_dir} | {settings.out_dir}")

    if problemas:
        typer.secho("\nconfiguracao incompleta:", fg=typer.colors.RED, bold=True)
        for p in problemas:
            typer.secho(f"  - {p}", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    typer.secho("\nconfiguracao ok", fg=typer.colors.GREEN, bold=True)


@app.command("testar-auth")
def testar_auth() -> None:
    """Obtem um access_token no ambiente configurado."""
    settings = _preparar()
    problemas = settings.validar()
    if problemas:
        typer.secho("configuracao incompleta:", fg=typer.colors.RED, bold=True)
        for p in problemas:
            typer.secho(f"  - {p}", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    try:
        with criar_http_client(settings) as client:
            token = TokenProvider(settings, client).get()
    except AuthError as exc:
        typer.secho(f"falha na autenticacao: {exc}", fg=typer.colors.RED, bold=True)
        raise typer.Exit(code=1) from exc

    # Nunca imprimir o token inteiro — nem em terminal, nem em log.
    typer.secho(
        f"autenticado com sucesso (token de {len(token)} chars, prefixo {token[:8]}...)",
        fg=typer.colors.GREEN,
        bold=True,
    )


def _parse_data_opcao(texto: str | None, padrao: date) -> date:
    if not texto:
        return padrao
    for formato in ("%Y-%m-%d", "%d/%m/%Y", "%d%m%Y"):
        try:
            return datetime.strptime(texto, formato).date()
        except ValueError:
            continue
    raise typer.BadParameter(f"data invalida: {texto!r} (use AAAA-MM-DD)")


def _brl(valor: Decimal) -> str:
    inteiro, _, centavos = f"{abs(valor):,.2f}".partition(".")
    sinal = "-" if valor < 0 else ""
    return f"{sinal}{inteiro.replace(',', '.')},{centavos}"


def _imprimir(extrato: Extrato) -> None:
    typer.echo(f"\nconta {extrato.conta} - {extrato.conta.nome_cliente}")
    typer.echo(
        f"periodo {extrato.data_inicio:%d/%m/%Y} a {extrato.data_fim:%d/%m/%Y}"
    )
    anterior = (
        f" (em {extrato.data_saldo_anterior:%d/%m/%Y})" if extrato.data_saldo_anterior else ""
    )
    typer.echo(f"saldo anterior: {_brl(extrato.saldo_anterior)}{anterior}\n")

    if not extrato.lancamentos:
        typer.secho("nenhum lancamento no periodo", fg=typer.colors.YELLOW)
    for lanc in extrato.lancamentos:
        data = f"{lanc.data:%d/%m/%Y}" if lanc.data else "  -  "
        cor = typer.colors.GREEN if lanc.credito else typer.colors.RED
        typer.echo(
            f"{data}  {lanc.descricao[:30]:<30} {lanc.documento:>8}  "
            + typer.style(f"{_brl(lanc.valor):>14}", fg=cor)
            + f"  {_brl(lanc.saldo_apos) if lanc.saldo_apos is not None else '':>14}"
        )

    typer.echo(
        f"\ncreditos: {_brl(extrato.creditos)}   debitos: {_brl(extrato.debitos)}"
        f"   saldo final: {_brl(extrato.saldo_final)}"
    )
    if extrato.futuros:
        typer.echo(f"\nlancamentos futuros: {len(extrato.futuros)}")
        for lanc in extrato.futuros:
            data = f"{lanc.data:%d/%m/%Y}" if lanc.data else "  -  "
            typer.echo(f"{data}  {lanc.descricao[:30]:<30} {_brl(lanc.valor):>14}")


@app.command()
def consultar(
    data: str = typer.Option(None, "--data", help="Dia unico (AAAA-MM-DD). Default: ontem."),
    data_inicio: str = typer.Option(None, "--data-inicio", help="Inicio do periodo."),
    data_fim: str = typer.Option(None, "--data-fim", help="Fim do periodo."),
    salvar_json: str = typer.Option(
        None, "--salvar-json", help="Grava a resposta crua da API no caminho informado."
    ),
) -> None:
    """Consulta o extrato e imprime os lancamentos."""
    settings = _preparar()
    problemas = settings.validar(exigir_extrato=True)
    if problemas:
        typer.secho("configuracao incompleta:", fg=typer.colors.RED, bold=True)
        for p in problemas:
            typer.secho(f"  - {p}", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    ontem = date.today() - timedelta(days=1)
    if data:
        inicio = fim = _parse_data_opcao(data, ontem)
    else:
        inicio = _parse_data_opcao(data_inicio, ontem)
        fim = _parse_data_opcao(data_fim, ontem)

    try:
        with criar_http_client(settings) as client:
            cliente = ClienteBradesco(settings, client)
            if salvar_json:
                # Refaz a chamada crua para gravar exatamente o que o banco devolveu.
                bruto = cliente._get(  # noqa: SLF001 - diagnostico deliberado
                    settings.statement_url,
                    {
                        "agencia": settings.agencia,
                        "conta": settings.conta,
                        "dataInicio": inicio.strftime("%d%m%Y"),
                        "dataFim": fim.strftime("%d%m%Y"),
                        "tipo": settings.tipo_conta,
                        "tipoOperacao": settings.tipo_operacao,
                    },
                )
                with open(salvar_json, "w", encoding="utf-8") as f:
                    json.dump(bruto, f, ensure_ascii=False, indent=2)
                typer.echo(f"resposta crua salva em {salvar_json}")

            extrato = cliente.consultar_extrato(inicio, fim)
    except (AuthError, ExtratoHTTPError, ExtratoAPIError) as exc:
        typer.secho(f"falha na consulta: {exc}", fg=typer.colors.RED, bold=True)
        raise typer.Exit(code=1) from exc

    _imprimir(extrato)


@app.command("gerar-pdf")
def gerar_pdf_cmd(
    data: str = typer.Option(None, "--data", help="Dia unico (AAAA-MM-DD). Default: ontem."),
    data_inicio: str = typer.Option(None, "--data-inicio"),
    data_fim: str = typer.Option(None, "--data-fim"),
    do_banco: bool = typer.Option(
        False,
        "--do-banco",
        help="Usa os lancamentos ja gravados no SQLite, sem chamar a API.",
    ),
) -> None:
    """Gera o PDF do extrato de um periodo."""
    settings = _preparar()
    ontem = date.today() - timedelta(days=1)
    if data:
        inicio = fim = _parse_data_opcao(data, ontem)
    else:
        inicio = _parse_data_opcao(data_inicio, ontem)
        fim = _parse_data_opcao(data_fim, ontem)

    if do_banco:
        storage = Storage(settings.db_path)
        lancamentos = storage.lancamentos_do_periodo(settings.conta, inicio, fim)
        if not lancamentos:
            typer.secho(
                "nenhum lancamento gravado para este periodo — rode 'consultar' antes",
                fg=typer.colors.YELLOW,
            )
            raise typer.Exit(code=1)
        extrato = Extrato(
            conta=Conta(
                agencia=settings.agencia, numero=settings.conta, digito=settings.conta_digito
            ),
            data_inicio=inicio,
            data_fim=fim,
            lancamentos=lancamentos,
        )
    else:
        problemas = settings.validar(exigir_extrato=True)
        if problemas:
            _mostrar_problemas(problemas)
            raise typer.Exit(code=1)
        try:
            with criar_http_client(settings) as client:
                extrato = ClienteBradesco(settings, client).consultar_extrato(inicio, fim)
        except (AuthError, ExtratoHTTPError, ExtratoAPIError) as exc:
            typer.secho(f"falha na consulta: {exc}", fg=typer.colors.RED, bold=True)
            raise typer.Exit(code=1) from exc

    destino = gerar_pdf(extrato, nome_arquivo(extrato, settings.out_dir))
    typer.secho(f"PDF gerado: {destino}", fg=typer.colors.GREEN, bold=True)


@app.command()
def diario(
    data: str = typer.Option(None, "--data", help="Dia a processar. Default: ontem."),
    forcar: bool = typer.Option(
        False, "--forcar", help="Reprocessa e reenvia mesmo se o dia ja foi concluido."
    ),
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Faz tudo menos enviar — util para conferir o PDF."
    ),
    payload: str = typer.Option(
        None,
        "--payload",
        help=(
            "Usa uma resposta ja salva (--salvar-json) no lugar da API. Permite testar "
            "o pipeline inteiro, inclusive o envio, sem depender do banco."
        ),
    ),
) -> None:
    """Pipeline completo: consulta, grava, gera o PDF e envia. Alvo do agendador."""
    settings = _preparar()
    problemas = settings.validar(exigir_extrato=True, exigir_email=not dry_run)
    if problemas:
        _mostrar_problemas(problemas)
        raise typer.Exit(code=1)

    dia = _parse_data_opcao(data, date.today() - timedelta(days=1))
    storage = Storage(settings.db_path)

    if not forcar and storage.ja_processado(settings.conta, dia, dia):
        typer.secho(
            f"{dia:%d/%m/%Y} ja foi processado com sucesso — use --forcar para repetir",
            fg=typer.colors.YELLOW,
        )
        raise typer.Exit(code=0)

    execucao_id = storage.abrir_execucao(settings.conta, dia, dia)
    try:
        if payload:
            with open(payload, encoding="utf-8") as f:
                bruto = json.load(f)
            extrato = parse_extrato(
                bruto, agencia=settings.agencia, data_inicio=dia, data_fim=dia
            )
            log.warning("usando payload de %s — nenhuma chamada ao banco", payload)
        else:
            with criar_http_client(settings) as client:
                extrato = ClienteBradesco(settings, client).consultar_extrato(dia, dia)

        novos = storage.gravar_lancamentos(settings.conta, extrato.lancamentos)
        pdf = gerar_pdf(extrato, nome_arquivo(extrato, settings.out_dir))
        resumo = gerar_resumo(extrato)

        if dry_run:
            typer.echo(resumo)
            typer.secho(f"\n[dry-run] PDF em {pdf}, nada enviado", fg=typer.colors.YELLOW)
            storage.fechar_execucao(
                execucao_id,
                status=STATUS_OK,
                novos=novos,
                total=len(extrato.lancamentos),
                pdf=pdf,
                mensagem="dry-run",
            )
            raise typer.Exit(code=0)

        notifier = EmailNotifier(settings)
        assunto = f"Extrato Bradesco {settings.conta_formatada} - {dia:%d/%m/%Y}"
        resultados = notifier.enviar(
            assunto=assunto,
            corpo=resumo,
            destinatarios=settings.destinatarios,
            anexos=[pdf],
        )
        for r in resultados:
            storage.registrar_envio(
                execucao_id,
                canal=notifier.canal,
                destinatario=r.destinatario,
                status=STATUS_OK if r.sucesso else STATUS_ERRO,
                erro=r.erro,
            )

        falhas = [r for r in resultados if not r.sucesso]
        storage.fechar_execucao(
            execucao_id,
            status=STATUS_ERRO if falhas else STATUS_OK,
            novos=novos,
            total=len(extrato.lancamentos),
            pdf=pdf,
            mensagem=f"{len(falhas)} envio(s) com falha" if falhas else None,
        )
        expurgar_antigos(settings.out_dir, settings.retencao_pdf_dias)

        if falhas:
            for r in falhas:
                typer.secho(f"falha ao enviar para {r.destinatario}: {r.erro}", fg=typer.colors.RED)
            raise typer.Exit(code=1)

        typer.secho(
            f"{dia:%d/%m/%Y}: {len(extrato.lancamentos)} lancamento(s), {novos} novo(s), "
            f"enviado para {len(resultados)} destinatario(s)",
            fg=typer.colors.GREEN,
            bold=True,
        )

    except typer.Exit:
        raise
    except Exception as exc:
        # Execucao desassistida: registra, alerta e devolve codigo de erro para
        # o Agendador marcar a tarefa como falha.
        log.exception("falha na execucao diaria")
        storage.fechar_execucao(execucao_id, status=STATUS_ERRO, mensagem=str(exc)[:500])
        typer.secho(f"falha: {exc}", fg=typer.colors.RED, bold=True)
        _alertar_falha(settings, dia, exc)
        raise typer.Exit(code=1) from exc


def _mostrar_problemas(problemas: list[str]) -> None:
    typer.secho("configuracao incompleta:", fg=typer.colors.RED, bold=True)
    for p in problemas:
        typer.secho(f"  - {p}", fg=typer.colors.RED)


def _alertar_falha(settings, dia: date, exc: Exception) -> None:
    """Avisa por e-mail que a rotina falhou, sem vazar stacktrace nem config."""
    if not settings.destinatarios or not settings.smtp_host:
        return
    try:
        EmailNotifier(settings).enviar(
            assunto=f"[FALHA] Extrato Bradesco - {dia:%d/%m/%Y}",
            corpo=(
                f"A rotina de extrato falhou ao processar {dia:%d/%m/%Y}.\n\n"
                f"Motivo: {type(exc).__name__}: {str(exc)[:300]}\n\n"
                "O detalhe completo esta no log local em logs/extrato.log."
            ),
            destinatarios=settings.destinatarios,
        )
    except Exception:  # noqa: BLE001 - o alerta nunca pode mascarar o erro original
        log.exception("nao foi possivel enviar o alerta de falha")


if __name__ == "__main__":
    app()

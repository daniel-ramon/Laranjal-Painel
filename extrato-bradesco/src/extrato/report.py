"""Geracao do PDF do extrato e do resumo textual que acompanha a mensagem.

ReportLab (Python puro) em vez de WeasyPrint: WeasyPrint depende do runtime
GTK/Pango instalado no Windows, o que e fragil demais para um job desassistido.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .models import Extrato, Lancamento

log = logging.getLogger(__name__)

_VERMELHO = colors.HexColor("#C0272D")
_CINZA_LINHA = colors.HexColor("#EFEFEF")
_CINZA_TEXTO = colors.HexColor("#666666")

_LARGURAS = [22 * mm, 66 * mm, 20 * mm, 28 * mm, 30 * mm]


def formatar_brl(valor: Decimal) -> str:
    """Decimal -> '1.234,56' no padrao pt-BR, com sinal a esquerda."""
    inteiro, _, centavos = f"{abs(valor):,.2f}".partition(".")
    sinal = "-" if valor < 0 else ""
    return f"{sinal}{inteiro.replace(',', '.')},{centavos}"


def _estilos() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "titulo": ParagraphStyle(
            "titulo", parent=base["Heading1"], fontSize=16, textColor=_VERMELHO, spaceAfter=2
        ),
        "sub": ParagraphStyle(
            "sub", parent=base["Normal"], fontSize=9, textColor=_CINZA_TEXTO, spaceAfter=1
        ),
        "secao": ParagraphStyle(
            "secao", parent=base["Heading2"], fontSize=11, spaceBefore=10, spaceAfter=4
        ),
        "celula": ParagraphStyle("celula", parent=base["Normal"], fontSize=7.5, leading=9),
        "celula_dir": ParagraphStyle(
            "celula_dir", parent=base["Normal"], fontSize=7.5, leading=9, alignment=TA_RIGHT
        ),
        "rodape": ParagraphStyle(
            "rodape", parent=base["Normal"], fontSize=7, textColor=_CINZA_TEXTO
        ),
    }


def _celula_descricao(lanc: Lancamento, estilo: ParagraphStyle) -> Paragraph:
    texto = lanc.descricao or "-"
    if lanc.complemento:
        texto += f'<br/><font size="6" color="#888888">{lanc.complemento}</font>'
    return Paragraph(texto, estilo)


def _tabela(lancamentos: list[Lancamento], est: dict, *, com_saldo: bool) -> Table:
    cabecalho = ["Data", "Descrição", "Doc.", "Valor", "Saldo" if com_saldo else ""]
    # As duas ultimas colunas sao numericas: o cabecalho acompanha o alinhamento
    # dos valores, senao a coluna fica visualmente torta.
    linhas = [
        [
            Paragraph(f"<b>{texto}</b>", est["celula_dir"] if i >= 3 else est["celula"])
            for i, texto in enumerate(cabecalho)
        ]
    ]

    for lanc in lancamentos:
        data = f"{lanc.data:%d/%m/%Y}" if lanc.data else "-"
        cor = "#1A7F37" if lanc.credito else "#C0272D"
        saldo = (
            formatar_brl(lanc.saldo_apos)
            if (com_saldo and lanc.saldo_apos is not None)
            else ""
        )
        linhas.append(
            [
                Paragraph(data, est["celula"]),
                _celula_descricao(lanc, est["celula"]),
                Paragraph(lanc.documento, est["celula"]),
                Paragraph(
                    f'<font color="{cor}">{formatar_brl(lanc.valor)}</font>',
                    est["celula_dir"],
                ),
                Paragraph(saldo, est["celula_dir"]),
            ]
        )

    tabela = Table(linhas, colWidths=_LARGURAS, repeatRows=1)
    estilo = [
        ("BACKGROUND", (0, 0), (-1, 0), _VERMELHO),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#DDDDDD")),
    ]
    # Zebra: melhora a leitura em extratos longos.
    for i in range(2, len(linhas), 2):
        estilo.append(("BACKGROUND", (0, i), (-1, i), _CINZA_LINHA))
    tabela.setStyle(TableStyle(estilo))
    return tabela


def _rodape(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(_CINZA_TEXTO)
    canvas.drawString(
        15 * mm,
        10 * mm,
        f"Gerado em {datetime.now():%d/%m/%Y %H:%M} - documento automatico, "
        f"nao substitui o extrato oficial do banco",
    )
    canvas.drawRightString(195 * mm, 10 * mm, f"pagina {doc.page}")
    canvas.restoreState()


def gerar_pdf(extrato: Extrato, destino: Path) -> Path:
    """Gera o PDF do extrato em `destino` e devolve o caminho."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    est = _estilos()

    doc = SimpleDocTemplate(
        str(destino),
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=18 * mm,
        title=f"Extrato {extrato.conta} {extrato.data_inicio:%d/%m/%Y}",
        author="Extrato Diario Bradesco",
    )

    corpo: list = [
        Paragraph("Extrato de Conta Corrente", est["titulo"]),
        Paragraph(f"Banco Bradesco &nbsp;|&nbsp; Conta {extrato.conta}", est["sub"]),
    ]
    if extrato.conta.nome_cliente:
        corpo.append(Paragraph(extrato.conta.nome_cliente, est["sub"]))
    corpo.append(
        Paragraph(
            f"Período de {extrato.data_inicio:%d/%m/%Y} a {extrato.data_fim:%d/%m/%Y}",
            est["sub"],
        )
    )
    corpo.append(Spacer(1, 6 * mm))

    # ------------------------------------------------------------------ resumo
    anterior = (
        f"Saldo anterior ({extrato.data_saldo_anterior:%d/%m/%Y})"
        if extrato.data_saldo_anterior
        else "Saldo anterior"
    )
    resumo = Table(
        [
            [anterior, formatar_brl(extrato.saldo_anterior)],
            ["Créditos no período", formatar_brl(extrato.creditos)],
            ["Débitos no período", f"-{formatar_brl(extrato.debitos)}"],
            ["Saldo final", formatar_brl(extrato.saldo_final)],
        ],
        colWidths=[100 * mm, 66 * mm],
    )
    resumo.setStyle(
        TableStyle(
            [
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#DDDDDD")),
                ("LINEABOVE", (0, -1), (-1, -1), 1, _VERMELHO),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("TEXTCOLOR", (1, 1), (1, 1), colors.HexColor("#1A7F37")),
                ("TEXTCOLOR", (1, 2), (1, 2), _VERMELHO),
            ]
        )
    )
    corpo.append(resumo)

    # ------------------------------------------------------------ lancamentos
    corpo.append(Paragraph("Lançamentos", est["secao"]))
    if extrato.lancamentos:
        corpo.append(_tabela(extrato.lancamentos, est, com_saldo=True))
    else:
        corpo.append(Paragraph("Nenhum lançamento no período.", est["celula"]))

    if extrato.futuros:
        corpo.append(PageBreak())
        corpo.append(
            KeepTogether(
                [
                    Paragraph("Lançamentos futuros (previstos)", est["secao"]),
                    _tabela(extrato.futuros, est, com_saldo=False),
                ]
            )
        )

    if extrato.mensagens:
        corpo.append(Spacer(1, 4 * mm))
        for msg in extrato.mensagens:
            corpo.append(Paragraph(msg, est["rodape"]))

    doc.build(corpo, onFirstPage=_rodape, onLaterPages=_rodape)
    log.info("PDF gerado em %s", destino)
    return destino


def nome_arquivo(extrato: Extrato, out_dir: Path) -> Path:
    conta = f"{extrato.conta.agencia}-{extrato.conta.numero}" or "conta"
    if extrato.data_inicio == extrato.data_fim:
        periodo = extrato.data_inicio.isoformat()
    else:
        periodo = f"{extrato.data_inicio.isoformat()}_a_{extrato.data_fim.isoformat()}"
    return out_dir / f"extrato_{conta}_{periodo}.pdf"


def gerar_resumo(extrato: Extrato) -> str:
    """Resumo curto para o corpo do e-mail / mensagem de WhatsApp."""
    if extrato.data_inicio == extrato.data_fim:
        periodo = f"{extrato.data_inicio:%d/%m/%Y}"
    else:
        periodo = f"{extrato.data_inicio:%d/%m/%Y} a {extrato.data_fim:%d/%m/%Y}"

    linhas = [
        f"Extrato Bradesco - conta {extrato.conta} - {periodo}",
        "",
        f"Saldo anterior: {formatar_brl(extrato.saldo_anterior)}",
        f"Creditos: {formatar_brl(extrato.creditos)}",
        f"Debitos: -{formatar_brl(extrato.debitos)}",
        f"Saldo final: {formatar_brl(extrato.saldo_final)}",
        "",
        f"{len(extrato.lancamentos)} lancamento(s) no periodo.",
    ]
    if extrato.futuros:
        total_futuro = sum((x.valor for x in extrato.futuros), Decimal("0"))
        linhas.append(
            f"{len(extrato.futuros)} lancamento(s) futuro(s), "
            f"totalizando {formatar_brl(total_futuro)}."
        )
    linhas.append("")
    linhas.append("Detalhamento no PDF em anexo.")
    return "\n".join(linhas)


def expurgar_antigos(out_dir: Path, dias: int, *, hoje: date | None = None) -> int:
    """Apaga PDFs mais antigos que `dias`. Devolve quantos foram removidos.

    Extrato e dado financeiro: acumular indefinidamente na maquina local nao e
    desejavel.
    """
    if dias <= 0 or not out_dir.exists():
        return 0

    limite = (hoje or date.today()).toordinal() - dias
    removidos = 0
    for pdf in out_dir.glob("extrato_*.pdf"):
        modificado = date.fromtimestamp(pdf.stat().st_mtime)
        if modificado.toordinal() < limite:
            pdf.unlink()
            removidos += 1

    if removidos:
        log.info("%s PDF(s) expurgado(s) de %s (retencao de %s dias)", removidos, out_dir, dias)
    return removidos

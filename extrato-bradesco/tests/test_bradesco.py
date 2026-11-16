"""Testes offline do cliente da API, incluindo retry e renovacao de token."""

from __future__ import annotations

from datetime import date
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import respx

from extrato.bradesco import ClienteBradesco, ExtratoHTTPError
from extrato.config import Settings

TOKEN_URL = "https://exemplo.invalido/auth/server-mtls/v2/token"
EXTRATO_URL = "https://exemplo.invalido/v1/fornecimento-extratos-contas/extratos"

PAYLOAD_OK = {
    "extratoUltimosLancamentos": {
        "codigoRetorno": "00",
        "mensagem": "CTAS0673 - CONSULTA EFETUADA COM SUCESSO",
        "numeroConta": "75557",
        "digitoConta": "5",
        "listaLancamentos": {
            "Ultimos Lancamentos": [
                {
                    "dataLancamento": "10/01/2025",
                    "valorLancamento": "100,00",
                    "sinalLancamento": "+",
                    "valorSaldoAposLancamento": "100,00",
                    "sinalSaldo": "+",
                    "descritivoLancamentoCompleto": "CREDITO",
                    "numeroDocumento": "0000001",
                }
            ]
        },
    }
}


@pytest.fixture(autouse=True)
def _sem_espera(monkeypatch):
    """Zera o backoff para o teste nao dormir de verdade."""
    monkeypatch.setattr("extrato.bradesco.time.sleep", lambda _: None)


@pytest.fixture
def settings(tmp_path) -> Settings:
    cert = tmp_path / "c.crt"
    cert.write_text("x")
    key = tmp_path / "k.key"
    key.write_text("x")
    return Settings(
        _env_file=None,
        client_id="cid",
        client_secret="csec",
        cert_path=cert,
        key_path=key,
        token_url=TOKEN_URL,
        api_base_url="https://exemplo.invalido",
        agencia="3750",
        conta="75557",
        tipo_conta="cc",
        tipo_operacao=1,
    )


def _mock_token():
    return respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
    )


@respx.mock
def test_monta_params_no_formato_do_manual(settings):
    _mock_token()
    rota = respx.get(EXTRATO_URL).mock(return_value=httpx.Response(200, json=PAYLOAD_OK))

    with httpx.Client() as client:
        ClienteBradesco(settings, client).consultar_extrato(
            date(2024, 11, 6), date(2024, 11, 20)
        )

    params = parse_qs(urlparse(str(rota.calls[0].request.url)).query)
    assert params["agencia"] == ["3750"]
    assert params["conta"] == ["75557"]
    # o manual exige ddmmaaaa, nao ISO
    assert params["dataInicio"] == ["06112024"]
    assert params["dataFim"] == ["20112024"]
    assert params["tipo"] == ["cc"]
    assert params["tipoOperacao"] == ["1"]
    assert rota.calls[0].request.headers["authorization"] == "Bearer tok"


@respx.mock
def test_periodo_invertido_e_recusado_antes_da_chamada(settings):
    _mock_token()
    rota = respx.get(EXTRATO_URL)

    with httpx.Client() as client:
        with pytest.raises(ValueError, match="data_inicio"):
            ClienteBradesco(settings, client).consultar_extrato(
                date(2025, 1, 10), date(2025, 1, 1)
            )

    assert rota.call_count == 0


@respx.mock
def test_401_renova_token_e_tenta_de_novo(settings):
    token = respx.post(TOKEN_URL).mock(
        side_effect=[
            httpx.Response(200, json={"access_token": "velho", "expires_in": 3600}),
            httpx.Response(200, json={"access_token": "novo", "expires_in": 3600}),
        ]
    )
    extrato = respx.get(EXTRATO_URL).mock(
        side_effect=[
            httpx.Response(401, text="expirado"),
            httpx.Response(200, json=PAYLOAD_OK),
        ]
    )

    with httpx.Client() as client:
        resultado = ClienteBradesco(settings, client).consultar_extrato(
            date(2025, 1, 10), date(2025, 1, 10)
        )

    assert len(resultado.lancamentos) == 1
    assert token.call_count == 2
    assert extrato.calls[1].request.headers["authorization"] == "Bearer novo"


@respx.mock
def test_503_e_retentado_com_backoff(settings):
    _mock_token()
    rota = respx.get(EXTRATO_URL).mock(
        side_effect=[
            httpx.Response(503, text="indisponivel"),
            httpx.Response(200, json=PAYLOAD_OK),
        ]
    )

    with httpx.Client() as client:
        ClienteBradesco(settings, client).consultar_extrato(
            date(2025, 1, 10), date(2025, 1, 10)
        )

    assert rota.call_count == 2


@respx.mock
def test_desiste_apos_o_limite_de_tentativas(settings):
    _mock_token()
    rota = respx.get(EXTRATO_URL).mock(return_value=httpx.Response(503, text="fora do ar"))

    with httpx.Client() as client:
        with pytest.raises(ExtratoHTTPError, match="indisponibilidade temporaria"):
            ClienteBradesco(settings, client).consultar_extrato(
                date(2025, 1, 10), date(2025, 1, 10)
            )

    assert rota.call_count == 3


@respx.mock
def test_404_nao_e_retentado_e_explica_a_causa(settings):
    _mock_token()
    rota = respx.get(EXTRATO_URL).mock(return_value=httpx.Response(404, text="nao achou"))

    with httpx.Client() as client:
        with pytest.raises(ExtratoHTTPError, match="conta nao encontrada"):
            ClienteBradesco(settings, client).consultar_extrato(
                date(2025, 1, 10), date(2025, 1, 10)
            )

    assert rota.call_count == 1


@respx.mock
def test_resposta_nao_json_vira_erro_claro(settings):
    _mock_token()
    respx.get(EXTRATO_URL).mock(return_value=httpx.Response(200, text="<html>manutencao"))

    with httpx.Client() as client:
        with pytest.raises(ExtratoHTTPError, match="nao e JSON valido"):
            ClienteBradesco(settings, client).consultar_extrato(
                date(2025, 1, 10), date(2025, 1, 10)
            )

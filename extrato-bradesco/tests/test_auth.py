"""Testes offline do fluxo client_credentials."""

from __future__ import annotations

import time
from urllib.parse import parse_qs

import httpx
import pytest
import respx

from extrato.auth import GRANT_TYPE, AuthError, Token, TokenProvider
from extrato.config import Settings

TOKEN_URL = "https://exemplo.invalido/auth/server-mtls/v2/token"


@pytest.fixture
def settings(tmp_path) -> Settings:
    cert = tmp_path / "certificado.crt"
    cert.write_text("cert")
    key = tmp_path / "chave.key"
    key.write_text("key")
    return Settings(
        _env_file=None,
        client_id="client-de-teste",
        client_secret="segredo-de-teste",
        cert_path=cert,
        key_path=key,
        token_url=TOKEN_URL,
    )


@respx.mock
def test_envia_client_credentials_no_corpo_e_cacheia(settings):
    rota = respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(200, json={"access_token": "tok-123", "expires_in": 3600})
    )

    with httpx.Client() as client:
        provider = TokenProvider(settings, client)
        assert provider.get() == "tok-123"
        assert provider.get() == "tok-123"  # veio do cache

    assert rota.call_count == 1
    corpo = parse_qs(rota.calls[0].request.content.decode())
    assert corpo["grant_type"] == [GRANT_TYPE]
    assert corpo["client_id"] == ["client-de-teste"]
    assert corpo["client_secret"] == ["segredo-de-teste"]
    assert (
        rota.calls[0].request.headers["content-type"] == "application/x-www-form-urlencoded"
    )


@respx.mock
def test_token_proximo_da_expiracao_e_renovado(settings):
    rota = respx.post(TOKEN_URL).mock(
        side_effect=[
            httpx.Response(200, json={"access_token": "tok-1", "expires_in": 30}),
            httpx.Response(200, json={"access_token": "tok-2", "expires_in": 3600}),
        ]
    )

    with httpx.Client() as client:
        provider = TokenProvider(settings, client)
        assert provider.get() == "tok-1"
        # expires_in=30 e menor que a margem de renovacao de 60s
        assert provider.get() == "tok-2"

    assert rota.call_count == 2


@respx.mock
def test_invalidar_forca_nova_autenticacao(settings):
    rota = respx.post(TOKEN_URL).mock(
        side_effect=[
            httpx.Response(200, json={"access_token": "tok-1", "expires_in": 3600}),
            httpx.Response(200, json={"access_token": "tok-2", "expires_in": 3600}),
        ]
    )

    with httpx.Client() as client:
        provider = TokenProvider(settings, client)
        assert provider.get() == "tok-1"
        provider.invalidar()
        assert provider.get() == "tok-2"

    assert rota.call_count == 2


@respx.mock
def test_erro_de_certificado_ganha_dica_do_faq(settings):
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(401, text="SSL with client authentication is required")
    )

    with httpx.Client() as client:
        with pytest.raises(AuthError, match="nao e o mesmo cadastrado"):
            TokenProvider(settings, client).get()


@respx.mock
def test_erro_de_credencial_ganha_dica_do_faq(settings):
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(401, text="The given client credentials were not valid")
    )

    with httpx.Client() as client:
        with pytest.raises(AuthError, match="client_id/client_secret incorretos"):
            TokenProvider(settings, client).get()


@respx.mock
def test_resposta_sem_access_token_vira_auth_error(settings):
    respx.post(TOKEN_URL).mock(return_value=httpx.Response(200, json={"erro": "x"}))

    with httpx.Client() as client:
        with pytest.raises(AuthError, match="sem access_token"):
            TokenProvider(settings, client).get()


@respx.mock
def test_falha_de_rede_vira_auth_error(settings):
    respx.post(TOKEN_URL).mock(side_effect=httpx.ConnectError("sem rota"))

    with httpx.Client() as client:
        with pytest.raises(AuthError, match="falha de rede"):
            TokenProvider(settings, client).get()


def test_token_expirado_nao_e_considerado_valido():
    assert not Token("x", time.time() - 1).valido
    assert Token("x", time.time() + 3600).valido

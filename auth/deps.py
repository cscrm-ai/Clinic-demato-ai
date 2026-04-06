"""Dependencies FastAPI para autenticação via Supabase JWT.

Uso nas rotas:
    @app.get("/rota-protegida")
    async def rota(user_id: str = Depends(get_current_user)):
        ...

    @app.get("/rota-admin-clinica")
    async def rota(request: Request, user_id: str = Depends(require_clinic_admin)):
        ...

    @app.get("/rota-super-admin")
    async def rota(user_id: str = Depends(require_super_admin)):
        ...
"""

from fastapi import Depends, HTTPException, Request, status

from db.supabase_client import get_user_clinic_ids, is_super_admin, verify_jwt


# ---------------------------------------------------------------------------
# Extração do token JWT da request
# ---------------------------------------------------------------------------

def _extract_token(request: Request) -> str | None:
    """Lê JWT do header Authorization ou do cookie sb-access-token."""
    # Header: Authorization: Bearer <token>
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[len("Bearer "):]

    # Cookie definido após magic link callback
    return request.cookies.get("sb-access-token")


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------

async def get_current_user(request: Request) -> str:
    """Valida JWT e retorna user_id.

    Lança 401 se token ausente ou inválido.
    """
    token = _extract_token(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticação não fornecido.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = verify_jwt(token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado. Faça login novamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user_id


async def require_clinic_admin(
    request: Request,
    user_id: str = Depends(get_current_user),
) -> str:
    """Verifica que o usuário é membro (clinic_admin) da clínica da request.

    Lança 403 se a clínica não estiver em request.state.clinic ou
    se o usuário não tiver acesso a ela.
    """
    clinic = getattr(request.state, "clinic", None)
    if not clinic:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clínica não identificada na request.",
        )

    clinic_id = str(clinic["id"])
    allowed_ids = get_user_clinic_ids(user_id)

    if clinic_id not in allowed_ids:
        # Super admin também pode acessar
        if not is_super_admin(user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Você não tem permissão para acessar esta clínica.",
            )

    return user_id


async def require_super_admin(
    user_id: str = Depends(get_current_user),
) -> str:
    """Verifica que o usuário é super admin.

    Lança 403 se não estiver na tabela super_admins.
    """
    if not is_super_admin(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso restrito a super administradores.",
        )
    return user_id

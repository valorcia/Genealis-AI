# -*- mode: python ; coding: utf-8 -*-
"""Construction du moteur GENEALIS AI en exécutable autonome (sidecar Tauri / mode portable)."""
import os
from pathlib import Path

block_cipher = None
here = Path(SPECPATH)
frontend_dist = here.parent / "frontend" / "dist"
datas = [(str(here / "genealis" / "data"), "genealis/data"), (str(here / "alembic"), "alembic"), (str(here / "alembic.ini"), ".")]
if frontend_dist.exists():
    datas.append((str(frontend_dist), "frontend"))

a = Analysis(
    [str(here / "run_backend.py")],
    pathex=[str(here)],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "uvicorn.logging", "uvicorn.loops", "uvicorn.loops.auto", "uvicorn.protocols", "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets", "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan", "uvicorn.lifespan.on", "anyio._backends._asyncio", "sqlalchemy.dialects.sqlite",
        "pydantic_settings", "apscheduler.schedulers.background", "apscheduler.triggers.interval",
        "genealis.connectors.france", "genealis.connectors.international", "genealis.connectors.free_sources",
        "genealis.connectors.insee_local", "reportlab.graphics.barcode.code128", "PIL._tkinter_finder",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "scipy", "numpy.distutils", "pytest"],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz, a.scripts, a.binaries, a.zipfiles, a.datas, [],
    name=os.environ.get("GENEALIS_BIN_NAME", "genealis-backend"),
    debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
    console=True, disable_windowed_traceback=False,
    icon=str(here.parent / "src-tauri" / "icons" / "icon.ico") if (here.parent / "src-tauri" / "icons" / "icon.ico").exists() else None,
)

"""Application setup: templates, static assets, API routes, and startup."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

import backend.helpers as db_helpers
from backend.api import router as api_router
from backend.migrations import init_db as run_migrations

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
DB_PATH = db_helpers.DB_PATH
TEMPLATE_DIR = FRONTEND_DIR / "templates"


def init_db():
    """Run schema setup; the wrapper also keeps legacy test configuration working."""
    db_helpers.DB_PATH = Path(DB_PATH)
    db_helpers.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    run_migrations()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Run database migrations before the server accepts the first request.
    init_db()
    yield


app = FastAPI(title="Forma Invoice Studio", version="1.0.0", lifespan=lifespan)
app.mount(
    "/static",
    StaticFiles(directory=FRONTEND_DIR / "static"),
    name="static",
)
app.include_router(api_router)


def render_page(page_name: str, title: str, body_class: str, script_names: str | list[str]):
    """Compose a page fragment with the shared HTML shell without a template dependency."""
    layout = (TEMPLATE_DIR / "layout.html").read_text(encoding="utf-8")
    page = (TEMPLATE_DIR / page_name).read_text(encoding="utf-8")
    scripts = [script_names] if isinstance(script_names, str) else script_names
    page_scripts = '\n    '.join(f'<script src="/static/js/{name}"></script>' for name in scripts)
    document = (layout
        .replace("__PAGE_TITLE__", title)
        .replace("__BODY_CLASS__", body_class)
        .replace("__PAGE_CONTENT__", page)
        .replace("__PAGE_SCRIPT__", page_scripts))
    return HTMLResponse(document)


@app.get("/", response_class=HTMLResponse)
def admin_page(_request: Request):
    return render_page("admin.html", "Forma — Invoice Studio", "admin-page", "admin.js")


@app.get("/invoice", response_class=HTMLResponse)
def invoice_page(_request: Request):
    return render_page("invoice.html", "Forma — Invoice editor", "invoice-page", ["invoice-vue.js", "invoice.js"])

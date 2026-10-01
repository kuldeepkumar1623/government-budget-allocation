import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.api import router
from services.dataset_store import store

load_dotenv(Path(__file__).resolve().with_name(".env"))
logging.basicConfig(
	level=os.getenv("LOG_LEVEL", "INFO").upper(),
	format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(_: FastAPI):
	store.ensure_demo_dataset()
	yield


app = FastAPI(
	title="Government Budget Allocation Analyzer API",
	version="1.0.0",
	description="Upload, clean, filter, and analyze government budget datasets.",
	lifespan=lifespan,
)

origins = [
	origin.strip()
	for origin in os.getenv(
		"CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"
	).split(",")
	if origin.strip()
]
app.add_middleware(
	CORSMiddleware,
	allow_origins=origins,
	allow_credentials=True,
	allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
	allow_headers=["*"],
)
app.include_router(router)


@app.get("/api/health", tags=["system"])
def health_check() -> dict[str, str]:
	return {"status": "ok"}
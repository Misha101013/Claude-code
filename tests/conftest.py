from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Config  # noqa: E402
from app.filters.rules import RuleEngine  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session")
def config() -> Config:
    return Config.load(ROOT / "config.example.yaml")


@pytest.fixture(scope="session")
def rules(config: Config) -> RuleEngine:
    return RuleEngine(config)


@pytest.fixture(scope="session")
def messages() -> list[dict]:
    lines = (FIXTURES / "messages.jsonl").read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]

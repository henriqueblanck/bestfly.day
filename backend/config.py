from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DUFFEL_API_TOKEN: str
    DUFFEL_API_BASE: str = "https://api.duffel.com"
    CONCURRENCY_LIMIT: int = 20
    MAX_RETRIES: int = 3
    POLL_INTERVAL_SECONDS: float = 2.0
    POLL_TIMEOUT_SECONDS: float = 60.0

    class Config:
        env_file = ".env"


settings = Settings()

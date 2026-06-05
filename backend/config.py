from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    POLL_INTERVAL_SECONDS: float = 2.0
    POLL_TIMEOUT_SECONDS: float = 300.0
    TOP_N_RESULTS: int = 5

    class Config:
        env_file = ".env"


settings = Settings()

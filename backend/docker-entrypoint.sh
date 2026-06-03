#!/bin/sh
set -e

# Ожидание готовности PostgreSQL базы данных перед выполнением миграций
python -c "
import os, time
from sqlalchemy import create_engine
url = os.getenv('TRAMPLIN_DATABASE_URL') or os.getenv('DATABASE_URL')
if url and not url.startswith('sqlite'):
    print('Waiting for PostgreSQL database to be ready...', flush=True)
    for _ in range(30):
        try:
            engine = create_engine(url)
            with engine.connect() as conn:
                print('Database is ready!', flush=True)
                break
        except Exception as e:
            time.sleep(1)
"

if [ -n "$TRAMPLIN_DATABASE_PATH" ]; then
    mkdir -p "$(dirname "$TRAMPLIN_DATABASE_PATH")"
fi

python -m alembic upgrade head

exec "$@"

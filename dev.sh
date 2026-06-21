#!/usr/bin/env bash
# Dev mode launcher — auto-restarts backend on code changes.
# Usage: ./dev.sh           (start everything)
#        ./dev.sh down       (stop everything)
#        ./dev.sh logs       (tail logs)
#        ./dev.sh rebuild    (force rebuild backend image)
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILES="-f docker-compose.yml -f docker-compose.dev.yml"

case "${1:-up}" in
    up|start)
        echo "=== Starting dev environment (auto-reload enabled) ==="
        docker compose $COMPOSE_FILES up --build --remove-orphans
        ;;
    down|stop)
        docker compose $COMPOSE_FILES down
        ;;
    logs|log)
        docker compose $COMPOSE_FILES logs -f backend
        ;;
    rebuild|build)
        docker compose $COMPOSE_FILES build  backend
        docker compose $COMPOSE_FILES up -d backend
        ;;
    restart)
        docker compose $COMPOSE_FILES restart backend
        ;;
    *)
        echo "Usage: $0 {up|down|logs|rebuild|restart}"
        exit 1
        ;;
esac

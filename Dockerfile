# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./frontend
COPY tsconfig.json vite.config.js ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ARG VERSION=development
ARG REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/nikitakiselev/homelab-dashboard" \
      org.opencontainers.image.description="Homelab dashboard; Linux agents run separately" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY homelab ./homelab
COPY deploy/install_agent.sh deploy/AGENT.md deploy/agent.example.yaml ./deploy/
COPY --from=frontend /build/dist ./dist
RUN groupadd --gid 10001 homelab && useradd --uid 10001 --gid 10001 --no-create-home homelab \
    && mkdir /data && chown 10001:10001 /data
RUN VERSION="$VERSION" REVISION="$REVISION" python -c 'import json,os;from pathlib import Path;v=os.environ["VERSION"];r=os.environ["REVISION"];None if v=="development" else Path("RELEASE.json").write_text(json.dumps({"version":v,"commit":r,"data_schema":1})+"\n")' \
    && python -c 'from homelab.server.version import release_info;print(release_info()["version"])'
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["python", "-m", "homelab.server.healthcheck"]
ENTRYPOINT ["python", "-m", "homelab.server"]
CMD ["--bind", "0.0.0.0", "--data", "/data/dashboard.sqlite"]

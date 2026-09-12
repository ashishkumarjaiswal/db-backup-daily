FROM node:22-bookworm-slim

ARG TARGETARCH
ARG MONGO_TOOLS_VERSION=100.18.0

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libgssapi-krb5-2 \
        libkrb5-3 \
        libsasl2-2 \
        libssl3 \
    && if [ "$TARGETARCH" = "arm64" ]; then \
         TOOLS_DIST="ubuntu2204-arm64"; \
       else \
         TOOLS_DIST="debian12-x86_64"; \
       fi \
    && curl -fsSL "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-${TOOLS_DIST}-${MONGO_TOOLS_VERSION}.tgz" \
        | tar -xz -C /tmp \
    && mv /tmp/mongodb-database-tools-*/bin/* /usr/local/bin/ \
    && rm -rf /tmp/mongodb-database-tools-* \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY backup.js .

RUN mkdir -p /backups

ENV BACKUP_DIR=/backups \
    NODE_ENV=production \
    TZ=UTC

VOLUME ["/backups"]

CMD ["node", "backup.js"]

FROM oven/bun:1.3.10

WORKDIR /app

COPY package.json bun.lock* ./
COPY prisma ./prisma/

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl openssl ca-certificates && \
    bun install && \
    bun prisma generate

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "bun prisma migrate deploy && bun run dev"]

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

CMD ["sh", "-c", "until bun prisma db push; do echo 'Waiting for database...'; sleep 2; done && bun run dev"]
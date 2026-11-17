FROM oven/bun:1.3.11-slim
WORKDIR /app
COPY package.json bun.lock ./
COPY vendor ./vendor
RUN bun install --frozen-lockfile --production
COPY *.ts *.json ./
COPY email/gmail-push.ts email/mail.js ./email/
USER bun
EXPOSE 8787
CMD ["bun", "run", "server.ts"]

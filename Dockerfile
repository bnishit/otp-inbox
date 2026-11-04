FROM oven/bun:1.3.11-slim
WORKDIR /app
COPY server.ts mcp.ts tools.json ./
COPY email/gmail-push.ts email/mail.js ./email/
USER bun
EXPOSE 8787
CMD ["bun", "run", "server.ts"]

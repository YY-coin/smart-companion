# ---- 魔搭创空间 Dockerfile ----
FROM node:20-alpine AS runner
WORKDIR /app

COPY package.json ./
RUN node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
COPY server.js ./
COPY data.json ./

RUN addgroup -g 1001 -S nodejs \
 && adduser -S nodejs -u 1001 \
 && chown -R nodejs:nodejs /app
USER nodejs

ENV PORT=7860
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:7860/ || exit 1

EXPOSE 7860
CMD ["node", "server.js"]

# The worker shares src/lib/notamParse.js with the PWA, so the build context
# is the repo root — see fly.toml / railway.json. One parser, two deployables,
# no copy to drift out of sync.
FROM node:20-alpine
WORKDIR /app
COPY services/aviara-svc/package*.json ./services/aviara-svc/
RUN cd services/aviara-svc && npm install --omit=dev
COPY src/lib/notamParse.js ./src/lib/notamParse.js
COPY services/aviara-svc ./services/aviara-svc
WORKDIR /app/services/aviara-svc
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "src/index.js"]

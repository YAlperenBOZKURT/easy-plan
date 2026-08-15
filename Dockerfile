# --- 1. aşama: arayüzü derle ---------------------------------------------
FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# --- 2. aşama: çalışma ortamı --------------------------------------------
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
# Gün sınırları ve hatırlatmalar kullanıcının saat dilimine göre hesaplanır;
# konteyner saati yine de doğru olsun.
ENV TZ=Europe/Istanbul

COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
# tsx sunucuyu doğrudan TypeScript'ten çalıştırır: ayrı derleme adımı yok.
RUN npm install --omit=dev --no-audit --no-fund && npm install --no-save tsx

COPY server ./server
COPY --from=build /app/web/dist ./web/dist

# Veritabanı ve görseller burada; docker-compose ile kalıcı birime bağlanır.
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME /app/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]

FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir data && chown node:node data
COPY server ./server
COPY index.html sw.js manifest.json crest.png icon-192.png icon-512.png ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/app/data/push.sqlite
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]

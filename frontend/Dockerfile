# Dev-oriented image for local docker-compose. Not a hardened production
# build: builds once with Vite, then serves the static output via
# `vite preview`. Good enough for local/demo use; a real production deploy
# would swap the final stage for nginx or a CDN.

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine AS serve
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/vite.config.ts ./vite.config.ts

EXPOSE 4173

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]

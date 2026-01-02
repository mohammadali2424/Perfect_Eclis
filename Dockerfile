FROM node:20.19.0-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.3 --activate

COPY package.json ./
COPY pnpm-lock.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

EXPOSE 3000
CMD ["pnpm","run","start"]

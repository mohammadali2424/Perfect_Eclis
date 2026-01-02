FROM node:20.19.0-alpine

WORKDIR /app

# Copy only manifests first for better caching
COPY package.json ./
COPY package-lock.json ./

# Use npm in container (stable) — or change to pnpm/yarn if you want
RUN npm ci

# Copy the rest
COPY . .

RUN npm run build

EXPOSE 3000
CMD ["npm","run","start"]

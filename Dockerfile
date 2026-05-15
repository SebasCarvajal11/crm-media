FROM node:20-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN npm i -g pnpm && pnpm install --frozen-lockfile=false

COPY . .
RUN pnpm build

EXPOSE 3002
CMD ["pnpm", "start"]
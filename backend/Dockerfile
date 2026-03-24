FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY --from=builder /app/../frontend/dist ./frontend/dist
RUN mkdir -p data logs
EXPOSE 3001
CMD ["node", "src/index.js"]

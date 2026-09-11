FROM node:22-alpine
WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy backend source
COPY src ./src

# Create runtime dirs
RUN mkdir -p data logs

EXPOSE 4673
# node:sqlite è experimental in Node 22 → richiede il flag
CMD ["node", "--experimental-sqlite", "src/index.js"]

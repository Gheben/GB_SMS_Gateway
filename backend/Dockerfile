FROM node:20-alpine
WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy backend source
COPY src ./src

# Create runtime dirs
RUN mkdir -p data logs

EXPOSE 4673
CMD ["node", "src/index.js"]

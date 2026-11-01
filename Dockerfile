# Jirani Live - Production Container
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for optimal docker layer caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY . .

# Environment variables defaults
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]

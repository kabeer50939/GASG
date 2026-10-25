FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Ensure writable directories for SQLite WAL, backups, and custom photo uploads in Hugging Face Spaces (UID 1000)
RUN mkdir -p /app/data /app/public/uploads/custom && chmod -R 777 /app/data /app/public/uploads

ENV NODE_ENV=production
ENV PORT=7860

EXPOSE 7860

CMD ["node", "server/index.js"]

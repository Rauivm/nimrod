FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Required at module import time; catch an incomplete image during the build.
RUN test -s src/services/tavernCollision.json && mkdir -p uploads

EXPOSE 3001

CMD ["node", "src/index.js"]

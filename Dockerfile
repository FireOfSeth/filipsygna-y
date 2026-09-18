FROM node:22-alpine
ENV TZ=Europe/Warsaw NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY src ./src
VOLUME ["/app/data"]
CMD ["node", "src/index.js"]

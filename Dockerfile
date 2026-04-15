FROM node:20-alpine

WORKDIR /app

COPY app/package*.json ./
RUN npm ci --omit=dev

COPY ./app .

ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE ${PORT}

CMD ["node", "server.js"]
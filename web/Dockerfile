FROM node:22-alpine

WORKDIR /app

COPY . .
RUN npm install

EXPOSE 9200

CMD ["npx", "quasar", "dev", "-p", "9200", "-H", "0.0.0.0"]

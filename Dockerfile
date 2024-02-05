FROM node:21-bookworm

RUN npm install -g ts-node

RUN mkdir -p /app
WORKDIR /app
COPY package.json .
COPY package-lock.json .
RUN npm install
COPY src ./src

ENTRYPOINT npm run start

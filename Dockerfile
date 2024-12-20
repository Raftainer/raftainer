FROM node:22-bookworm as build

RUN npm install -g ts-node

RUN mkdir -p /app
WORKDIR /app
COPY tsconfig.json .
COPY package.json .
COPY package-lock.json .
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-bookworm
RUN mkdir -p /app
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENTRYPOINT node ./dist/index.js

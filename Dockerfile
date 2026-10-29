FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

FROM dependencies AS build
COPY tsconfig*.json ./
COPY src ./src
RUN yarn build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY docs ./docs
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM node:22-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci --omit=dev

COPY server ./server

WORKDIR /app/server
ENV NODE_ENV=production

CMD ["npm", "run", "start"]

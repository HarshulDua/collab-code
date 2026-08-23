FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p .git-rooms && chown -R app:app /app
USER app
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "src/server.js"]

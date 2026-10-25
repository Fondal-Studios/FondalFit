FROM node:22-slim
WORKDIR /app
COPY package*.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["npm", "start"]

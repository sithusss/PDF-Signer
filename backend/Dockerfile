FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY template.pdf ./
COPY template2.pdf ./

EXPOSE 5000

CMD ["npm", "start"]
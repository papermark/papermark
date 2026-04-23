FROM node:20-alpine

WORKDIR /usr/src/app

COPY package* .

COPY prisma ./prisma

RUN  npm install

COPY . .

ENV DATABASE_URL="postgresql://postgres:mysecretpassword@db:5432/paper"

RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "run", "docker-dev"]
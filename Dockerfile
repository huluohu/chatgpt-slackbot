FROM node:18
WORKDIR /app
ADD package.json package-lock.json /app/
RUN npm install -g npm@9.5.1
RUN npm install
ADD . /app
EXPOSE 4005 3002
CMD ["npm","--","run","start"]
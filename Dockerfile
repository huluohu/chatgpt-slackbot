FROM node:18
WORKDIR /app
ADD package.json yarn.lock /app/
#RUN apt update
#RUN apt install chromium
#RUN apt install chromium-browser
#RUN export PUPPETEER_SKIP_DOWNLOAD='true'
RUN npm install -g npm@9.5.1
RUN npm install
RUN yarn install
ADD . /app
EXPOSE 4005 3002
CMD ["yarn","--","run","start"]
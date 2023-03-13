FROM node:18
WORKDIR /app
ADD package.json package-lock.json app.ts .example README.md /app/
#ADD --exclude='.env' . /app/
#RUN apt update
#RUN apt install chromium -y
#ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true
#ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN npm install -g npm@9.5.1
RUN npm install
#ADD . /app
EXPOSE 4005 3002
CMD ["npm","--","run","start"]
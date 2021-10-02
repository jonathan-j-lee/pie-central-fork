FROM node:16-alpine3.14
LABEL maintainer="software@pioneers.berkeley.edu"
ENV NODE_ENV production

WORKDIR /root
COPY build build
WORKDIR /root/build
RUN apk add python3 binutils
RUN npm install zeromq@6.0.0-beta.6 sqlite3@5
# Slim the image
RUN npm uninstall --global npm
RUN strip --strip-all /usr/local/bin/node
RUN apk del python3 binutils
RUN rm -rf /tmp/*cache* ~/.npm /usr/local/bin/yarn* /opt/yarn* static/*.js.map
EXPOSE 4040
CMD ["node", "server.js", "serve"]

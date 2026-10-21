FROM node:24-slim
WORKDIR /app
COPY . .
ENV PORT=8080 DATA_DIR=/data SECURE_COOKIE=1
VOLUME /data
EXPOSE 8080
CMD ["node", "server.js"]

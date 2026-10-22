FROM node:24-alpine

ENV NODE_ENV=production HOST=0.0.0.0 PORT=4853 WAIFU_DATA_DIR=/data
WORKDIR /app
COPY --chown=node:node package.json server.mjs auth.mjs cli.mjs ./
COPY --chown=node:node shared ./shared
COPY --chown=node:node public ./public
COPY --chown=node:node docs ./docs
COPY --chown=node:node examples ./examples
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4853
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4853/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]

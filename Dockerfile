# =============================================================================
#  SISTEMA DIGITAL INKO
#
#  Una sola etapa, a propósito: la plataforma no tiene dependencias ni paso de
#  compilación —usa el SQLite que ya trae Node (node:sqlite) y sirve su propio
#  front sin empaquetar nada—. Un multi-stage aquí no quitaría un solo byte y
#  solo haría el archivo más difícil de leer.
#
#  Lo que sí importa:
#    · la imagen NO lleva datos (ver .dockerignore): la base y las fotos van en
#      un volumen, porque la imagen se reemplaza en cada versión y la operación
#      del almacén no;
#    · corre como usuario sin privilegios;
#    · tini como PID 1, para que `docker stop` la detenga al instante y no a los
#      diez segundos a la fuerza —una base de datos a medio escribir no es un
#      buen lugar donde terminar—;
#    · HEALTHCHECK contra /api/salud, la misma puerta que toca la tablet para
#      saber si la plataforma está de pie.
#
#  Construir y levantar:
#     docker build -t inko .
#     docker run -d --name inko -p 3000:3000 -v inko-datos:/datos --restart unless-stopped inko
#
#  O con docker compose, que ya trae todo eso escrito:  docker compose up -d
# =============================================================================

# node:sqlite es estable desde Node 24. Se fija la versión mayor a propósito:
# una plataforma que se actualiza sola de Node es una plataforma que un día no
# arranca y nadie sabe por qué.
FROM node:24-alpine

# tini: 200 KB que convierten un apagado forzado en un apagado limpio.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    # Dónde viven la base y las fotos. El servidor respeta esta variable (db.js)
    # y crea lo que falte al arrancar.
    INKO_DATOS=/datos \
    PORT=3000

# El volumen se crea con dueño antes de bajar de privilegios: si lo creara Node
# ya como 'node', en algunos montajes se quedaría sin permiso de escritura.
RUN mkdir -p /datos && chown -R node:node /datos

WORKDIR /app
COPY --chown=node:node . .

USER node

VOLUME ["/datos"]
EXPOSE 3000

# Si la plataforma deja de contestar, Docker lo dice en `docker ps` en vez de
# que nos enteremos porque alguien en el almacén no pudo capturar.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]

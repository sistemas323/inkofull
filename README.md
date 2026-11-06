# Sistema Digital INKO

La operación del almacén de INKO, en una plataforma que corre en una
computadora del almacén y se usa desde tablets: checklists de unidades,
Producción y la ODT de la semana, Calidad, Almacén —existencias, entradas,
retiros, salidas, conteos y traspasos—, Ventas directas, Logística con el
Formato de Asignación e Inspección Vehicular y la ruta de entrega, Bahía
digital, Reportes y Configuración.

**El manual completo es [LEEME.md](LEEME.md)**: qué hace cada módulo, por qué
está hecho así y cómo se usa en el patio. Es la documentación de verdad; esto
de aquí solo es la portada.

Para mudarla a otra computadora:
[MUDANZA - pasar la plataforma a una computadora del almacen.md](MUDANZA%20-%20pasar%20la%20plataforma%20a%20una%20computadora%20del%20almacen.md).

## Cómo se levanta

Node.js (versión LTS) y nada más: la plataforma **no tiene dependencias**. Usa
el SQLite que trae Node (`node:sqlite`) y sirve su propio front sin compilar
nada.

```
node server.js          # o doble clic en «Iniciar plataforma.bat»
```

Queda en `http://localhost:3000` y en la dirección de red de esa computadora,
que es por donde entran las tablets.

| | |
|---|---|
| `server.js` | el servidor entero: rutas, permisos, reglas de cada módulo |
| `db.js` | el esquema y las migraciones, que corren solas al arrancar |
| `public/` | la pantalla: `app.js`, el estilo «Riel azul» y la marca |
| `seed.js`, `seed-almacen.js` | los catálogos iniciales, transcritos de los Excel que se usaban antes |
| `respaldar.js` | copia fechada de la base y las fotos, con la plataforma encendida |

## Lo que no está aquí

`datos/` y `respaldos/` no se versionan: ahí viven la base de datos y las fotos
de evidencia —información real del almacén, con nombres y claves del equipo—.
Un historial de versiones es para el código, no para la operación.

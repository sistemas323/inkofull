# Mudanza: que la plataforma viva en el almacén

Hoy la plataforma vive en la laptop de Ronaldo. Cuando esa laptop se va, el
almacén se queda sin sistema: el iPad no guarda nada por su cuenta, solo abre
una ventana a la computadora donde la plataforma está corriendo.

Esto es lo que hay que hacer para mudarla, en orden. Toma como una hora, la
mayor parte esperando instalaciones. **Hazlo un día que no se esté capturando**,
de preferencia a primera hora o al final del día.

---

## Qué computadora sirve

No necesita ser nueva ni potente. La plataforma pesa 20 MB y atiende a unas
pocas tablets.

| | |
|---|---|
| **Windows** | 10 u 11 |
| **Memoria** | 4 GB alcanza; 8 GB va sobrado |
| **Disco** | 20 GB libres |
| **Red** | **Mejor por cable** al router. Si no se puede, wifi con buena señal |
| **Lo más importante** | que se quede ahí, enchufada, prendida y con la sesión de Windows iniciada |

Una PC de escritorio vieja, una mini PC o una laptop que ya no se usa: cualquiera
sirve. Lo que no sirve es una computadora que alguien se lleve o que se apague
al final del día.

---

## Paso 1 · Instalar Node.js en la computadora nueva

Es lo único que hay que instalar. Es gratis y es de la Fundación OpenJS, no es
nada nuestro.

1. Entrar a **nodejs.org**
2. Descargar la versión que dice **LTS**
3. Instalarla: siguiente, siguiente, siguiente

Para comprobar que quedó: abrir **Símbolo del sistema** y escribir `node -v`.
Debe contestar algo como `v24.16.0`.

---

## Paso 2 · Sacar los datos de la computadora de ahora

> **Esto es lo delicado de toda la mudanza. Léelo completo antes de hacerlo.**

La base de datos no es un solo archivo mientras la plataforma está encendida: lo
más reciente —a veces semanas de captura— vive en un archivo aparte que termina
en `-wal`. **Si copias solo `checklists.db` con la plataforma prendida, te llevas
la base vieja y pierdes lo último.**

Por eso, en este orden:

1. **Apagar la plataforma.** Administrador de tareas (Ctrl+Shift+Esc) →
   pestaña Detalles → buscar **node.exe** → clic derecho → Finalizar tarea.
   Si hay varios, todos. Al apagarse, la plataforma junta todo en un solo
   archivo.
2. **Copiar la carpeta `plataforma` completa** a una USB. Toda, con sus
   subcarpetas (`datos`, `public`, `respaldos`…). Son unos 20 MB.
3. Comprobar que en la USB, dentro de `plataforma\datos`, está
   **`checklists.db`** y la carpeta **`fotos`**.

---

## Paso 3 · Ponerla en la computadora del almacén

Pegar la carpeta en:

```
C:\INKO\plataforma
```

**Fuera de OneDrive**, a propósito. Dos razones: la computadora del almacén no
tiene tu OneDrive, y OneDrive sincronizando la base mientras alguien captura
puede corromperla. Los respaldos se hacen aparte (Paso 7).

---

## Paso 4 · Primera prueba

1. Doble clic en **`Iniciar plataforma.bat`**
2. Windows va a preguntar si deja pasar a Node.js por el firewall:
   **marcar «Redes privadas» y dar Permitir acceso**. Si te equivocas y le das
   cancelar, el iPad no va a poder entrar (y arreglarlo después es un lío: hay
   que borrar las reglas de bloqueo a mano).
3. En la ventana negra sale la dirección, algo como
   `http://192.168.0.58:3000`. **Anótala.**
4. Abrirla en el navegador de esa misma computadora: debe salir el Sistema
   Digital INKO.

---

## Paso 5 · Que arranque sola y no se duerma

En la carpeta hay un archivo llamado
**`Dejar lista la computadora (ejecutar como administrador).cmd`**.

Clic derecho sobre él → **Ejecutar como administrador**.

Hace tres cosas y te las dice antes de hacerlas:

- crea una tarea que **arranca la plataforma sola** cada vez que esa computadora
  inicia sesión, y sin ventana negra que alguien pueda cerrar sin querer;
- le dice a Windows que **no se duerma** mientras esté enchufada;
- y que **cerrar la tapa tampoco la duerma** (si es laptop).

No toca el firewall ni el antivirus. Para deshacerlo:
`schtasks /delete /tn "INKO Sistema Digital" /f`

**Reiniciar la computadora y comprobar que la plataforma levantó sola**: abrir la
dirección del Paso 4 sin tocar nada más.

---

## Paso 6 · Que la dirección no cambie nunca

Hoy la dirección cambia sola de vez en cuando (`192.168.0.58`, `192.168.1.174`…)
y cuando cambia, el acceso directo del iPad deja de servir. Eso lo decide el
router, no la plataforma.

Hay que pedirle a quien administre el router que le **reserve la dirección** a
esa computadora. Se hace por su MAC, y es cosa de dos minutos en el panel del
router (suele llamarse *DHCP Reservation*, *IP estática* o *Cliente fijo*).

Para saber la MAC: Símbolo del sistema → `ipconfig /all` → buscar la línea
**Dirección física** del adaptador que esté en uso (Ethernet si está por cable).

Si no hay quien le mueva al router, se puede fijar la IP en Windows, pero hay
que escoger una que el router no vaya a repartir. Dime y lo vemos.

---

## Paso 7 · El iPad y las tablets

1. Abrir la dirección en Safari.
2. Botón **Compartir** → **Agregar a pantalla de inicio**. Queda como si fuera
   una aplicación.
3. Borrar el acceso directo viejo, el que apunta a la laptop.

---

## Paso 8 · Apagar la de tu laptop

**Importante: no pueden quedar dos.** Dos plataformas prendidas son dos bases de
datos distintas, y lo que se capture en una no existe en la otra.

En tu laptop:

- Si le habías creado la tarea de arranque: `schtasks /delete /tn "INKO Sistema Digital" /f`
- No volver a abrir `Iniciar plataforma.bat`.
- La carpeta se puede dejar ahí como respaldo de la mudanza, pero **apagada**.

---

## Paso 9 · Respaldos

Ya no va a estar en OneDrive, así que el respaldo se hace a mano o programado.
En la carpeta de la plataforma:

```
node respaldar.js
```

Deja una copia fechada en `respaldos\datos-AAAA-MM-DD`, con base y fotos. **Se
puede correr con la plataforma encendida**, sin sacar a nadie.

Una vez por semana, copiar esa carpeta a una USB o a OneDrive. Si un día la
computadora del almacén se muere, con eso se levanta todo en otra.

---

## Y después, ¿cómo le seguimos haciendo cambios?

Igual que hoy. La mudanza cambia **dónde vive**, no quién manda.

### Usarla y configurarla desde tu laptop

Igual que el iPad: abres la dirección de la computadora del almacén en tu
navegador y entras con tu clave. Configuración, permisos, reportes, resguardo,
todo. Ves los mismos datos que el iPad, en vivo, porque son los mismos datos.

Lo único: tienes que estar **en el wifi del almacén**. Desde tu casa no, a menos
que montemos acceso remoto, y eso es otra conversación —sacar la plataforma a
internet tiene su costo en seguridad y hoy la regla es que los datos no salen.

### Seguir cambiándole cosas

**El código se sigue trabajando en tu laptop.** Ahí está la carpeta, ahí pruebo
yo contra una copia de la base en el puerto 3199, y ahí seguimos igual que
siempre. Lo único que cambia es el último paso: hoy «publicar» es reiniciar el
servidor aquí mismo; después será **copiar los archivos de código** a la
computadora del almacén.

Para que eso no sea una friega cada vez, conviene dejar preparado:

- Una **carpeta compartida** en la computadora del almacén (`C:\INKO`), con
  permiso de escritura para tu usuario.
- Un **`Publicar al almacén.cmd`** en tu laptop que copie únicamente el código
  —`server.js`, `db.js`, `public\`, `LEEME.md`— y **nunca `datos\`**.
- Con eso, la plataforma del almacén se reinicia sola a los pocos segundos y ya
  está corriendo lo nuevo. Si la carpeta queda compartida, yo puedo publicar
  desde nuestra sesión sin que nadie camine hasta allá.

> ⚠️ **Nunca copies `datos\` de tu laptop al almacén.** Esa carpeta es la que
> tiene lo que el equipo capturó; sobrescribirla con la copia vieja de tu
> laptop borraría el trabajo de todos. El código va en un sentido (tu laptop →
> almacén) y los datos en el otro (almacén → tu laptop, solo para probar).

## Lo que esta mudanza NO arregla

**Si el wifi no llega bien a toda la bodega, seguirá sin llegar.** Mudar la
plataforma la vuelve estable y siempre disponible, pero si el iPad se queda sin
señal en el fondo del almacén, ahí no hay programa que valga: lo que hace falta
es un **punto de acceso o un repetidor** más cerca de donde se llena.

Lo que sí hace la plataforma mientras tanto (desde el 28-oct-2026):

- avisa con una tira roja abajo cuando no la encuentra, en vez de quedarse en
  blanco;
- las fotos que no se pudieron subir **se quedan guardadas en el iPad**, a la
  vista y marcadas, y suben solas en cuanto vuelve la señal;
- una miniatura que no se alcanzó a bajar se marca **↻ tocar para verla**: la
  foto está guardada, lo que falló fue traerla;
- en cuanto la plataforma vuelve a aparecer, la pantalla se reconecta sola. No
  hay que salir y entrar.

Para que el iPad tenga todo eso, **tiene que haber recargado la página al menos
una vez después del 28-oct-2026**.

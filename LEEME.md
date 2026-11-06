# Sistema Digital INKO

Plataforma en tablet para la operación del almacén. Hoy funcionan **Checklists**,
**Tránsito**, **Calidad**, **Reportes** y **Configuración**; el menú ya reserva su
lugar a Producción, Envíos Ventas directas, Almacén, Notificaciones e
Incidencias, con sus permisos repartibles desde el primer día. No requiere
instalar nada más que Node.js.

---

## Cómo se usa en la tablet

**1. Pantalla de reposo.** La tablet descansa mostrando el logotipo sobre Azul
INKO. Es el estado normal cuando nadie la está usando.

**2. Un toque** en cualquier parte la despierta y pide **tu clave**.

**3. Se escribe la clave.** No hay lista de nombres: la clave dice quién eres. Se
captura en un **teclado en pantalla** — más fiable que el del sistema cuando se
trae guante puesto — o se teclea, si lleva letras. Da igual mayúscula o
minúscula. Cada persona tiene la suya y **ninguna se repite**; el Administrador
las asigna en Configuración.

> **Mientras alguien activo no tenga clave**, la pantalla sigue pidiendo el
> nombre como antes. Es a propósito: cambiar antes dejaría a esa persona fuera
> del sistema sin manera de pedir ayuda. En cuanto todo el personal activo tiene
> clave, la pantalla cambia sola y deja de mostrar nombres. Configuración →
> Personas dice a quién le falta.

**4. El menú muestra solo lo suyo.** Cada quien ve únicamente los módulos a los
que tiene acceso. Un operador ve Checklists y nada más; el Administrador ve todo.
Los módulos que aún no existen aparecen como *Próximamente*.

**5. A trabajar.** Ya dentro, el botón **Menú** de la barra regresa a la portada.

> La identidad se pide **antes** del menú, no al entrar a cada módulo. Así nadie
> ve secciones que no le tocan, ni siquiera de reojo.

> **La tablet vuelve sola al reposo tras 6 minutos sin uso**, y al hacerlo cierra
> la sesión. Sin esto, el siguiente que la tomara capturaría un checklist a
> nombre de quien la usó antes. Nada se pierde: la captura se guarda sola.
> En computadora con mouse esto no aplica — es un equipo de una sola persona.
>
> La identidad se guarda solo mientras la pestaña sigue abierta. Si se reinicia
> la tablet, se empieza de cero en vez de heredar la sesión de alguien más.

Lo único público es la pantalla que pide la clave — es la puerta, y la tablet
vive dentro del almacén. Desde ahí todo exige identidad, y el servidor vuelve a
verificar el permiso en cada llamada. La pantalla ya no enseña quién trabaja
aquí: sin lista de nombres, quien tome la tablet no se entera del personal ni
puede tocar el nombre de otro por descuido.

**Cinco claves erradas seguidas bloquean ese dispositivo un minuto.** Sin lista
de nombres, la clave es lo único que habría que adivinar; el freno corta el
tanteo a ciegas. No defiende de un ataque serio —la tablet vive en la red del
almacén— pero de eso se encarga la red, no la pantalla.

Si la clave existe pero esa persona no tiene acceso al módulo que pidió, el
sistema lo dice tal cual: *«Tu clave es correcta, pero no tienes acceso a…»*.
Antes esto no hacía falta, porque la lista de nombres ya venía filtrada.

**Configuración vuelve a pedir la clave** si la persona lleva más de 3 minutos
dentro del sistema. Recién identificado entra directo; si la tablet lleva rato
encendida y pudo cambiar de manos, se confirma otra vez.

---

## Módulos

| Módulo | Estado | Quién entra |
|---|---|---|
| **Logística** (con los checklists y las salidas de unidad dentro) | Funcionando | Todo el equipo llena; el resto del módulo se reparte aparte |
| **Bahía digital** | Funcionando | Nace cerrada: solo Administrador. Se reparte después |
| **Producción** | Funcionando | La ODT de la semana y la evaluación de material |
| **Calidad** | Funcionando | Team Leaders y Administrador |
| **Tránsito** | Funcionando | Todo el equipo |
| Envíos Ventas directas | Próximamente | — |
| **Almacén** | Funcionando | Todo el equipo captura; autorizan Team Leaders y Administrador |
| **Notificaciones** | Funcionando | Todos entran; hoy solo el Administrador tiene algo que aprobar |
| **Incidencias** | Funcionando | Todos ven las suyas; los Team Leaders levantan, el Administrador autoriza |
| **Reportes** | Funcionando | Team Leaders y Administrador |
| **Configuración** | Funcionando | Solo Administrador |

**Agregar un módulo es un renglón** en la lista `MODULOS`, al inicio de
`server.js`. Aparece solo en el menú, con su ícono y su control de acceso. Poner
`disponible: false` lo muestra como *Próximamente* sin dejar entrar.

**Tránsito salió de Checklists.** Antes era una tarjeta más de la portada de
Checklists; ahora es módulo propio, con la misma pantalla de envíos de siempre.
La portada de Checklists quedó solo con las inspecciones (unidades, montacargas
e insumos). Se movió de lugar, no se rehizo: los envíos ya capturados siguen
donde estaban y los reportes no cambian.

**Los módulos por construir ya reparten permisos.** Aunque no dejen entrar,
sus acciones existen en el catálogo, así que el Administrador puede decidir
desde hoy quién hará qué dentro de ellos. Cuando el módulo se construya, la
regla ya está puesta en vez de tener que acordarse de ponerla.

**Inventario pasó a llamarse Almacén y ODT de la semana salió del menú.** Los
permisos que ya se habían repartido a mano con el nombre viejo se renombran
solos al arrancar, para no perder ese trabajo.

**La ODT terminó en Producción.** Primero vivió dentro de Almacén, porque ahí se
usaba para cotejar lo que sale. Pero la ODT no es una consulta de almacén: es lo
que producción va a armar, y de ella salen los traspasos que Almacén tiene que
mover. Almacén sigue cotejando sus salidas contra ella; lo que cambió es quién es
su dueño.

---

## Cómo se conectan los módulos

Cuando un documento tiene que ver con otro de otro módulo, arriba lleva la tira
**«Conectado con»** y el folio del otro **se puede tocar** para abrirlo. Si quien
mira no tiene acceso a ese módulo, ve el folio sin enlace.

| Desde | Lleva a |
|---|---|
| Salida de venta directa (Almacén) | Su orden de **Ventas directas**; y la orden lista sus salidas |
| Salida por ODT y traspaso (Almacén) | La **ODT** de Producción que los pidió; la ODT lista sus traspasos |
| Entrada de proveedor (Almacén) | Su revisión en **Calidad**; la recepción de Calidad regresa a su entrada |
| Retiro (Almacén) | Sus **re-ingresos** en Calidad; cada re-ingreso regresa a su retiro |
| Envío de **Tránsito** | Su envío en la **ODT**: cuánto va armado y si va a tiempo |
| Envío de la ODT (Producción → Avance) | Su checklist de **Tránsito** y en qué va: en captura, por autorizar, en ruta, cerrado |

**Tránsito y la ODT se amarran por el número.** El *número de envío* que se
anota en Tránsito es el mismo folio de la cita en la ODT (#73880087). Al abrir un
envío, el campo sugiere las citas de la ODT de una semana atrás a dos adelante;
escoger una llena también su CEDIS. Se comparan solo los dígitos, así que
«#7388 0087» y «73880087» son el mismo envío.

---

## Reportes: todos juntos, en un módulo

Los reportes ya no cuelgan del módulo que los produce. Antes, para revisar la
operación había que entrar a Checklists por unos, a Calidad por otros y acordarse
de que la Comparativa estaba en un tercer botón de la barra. Ahora hay **un solo
lugar**, y con cada módulo nuevo se le suma un renglón.

Al entrar, los reportes vienen separados en dos, porque son dos preguntas
distintas:

- **Cómo va la operación** — la foto de ahora mismo. Vigencias por vencer,
  problemas detectados, historial de lo capturado, muestreos y rechazos.
- **A lo largo del tiempo** — varias semanas juntas, para ver si vamos mejorando.
  Hoy vive aquí la **Comparativa entre semanas** de Checklists; Producción,
  Almacén e Incidencias tienen su lugar apartado.

Lo que no le toca a esa persona **no aparece**: enseñar un reporte apagado solo
informa de que existe algo que no puede abrir. Y **entrar al módulo no da acceso
a todo lo que hay dentro**: cada reporte se otorga por separado en
Configuración → Permisos → Reportes. Por eso los Team Leaders ven los de
Checklists y Calidad, pero la Comparativa sigue siendo de Héctor y del
Administrador.

**La barra de arriba perdió sus atajos a Reportes y Comparativa.** Eran una
segunda puerta al mismo sitio y la barra de una tablet no da para dos.
*Aprobaciones* sí se quedó en Calidad: eso es trabajo, no consulta.

**El reporte de Checklists se filtra** (1-oct-2026): por **fecha de llenado**
(del … al …), por **unidad**, por **checklist** y por **solo los que traen
problemas**. El filtro lo aplica el servidor, no la pantalla: el reporte trae los
últimos renglones nada más, y filtrar después de cortar dejaba fuera justo lo que
se buscaba. Las vigencias y el dinero se siguen mostrando completos, porque son
el último dato de cada unidad y no una lista de capturas.

**Reportes tiene el de Logística**: gasolina y rendimiento por unidad, costo por
kilómetro, servicios y papeles por vencer. Se otorga aparte, como los demás.

**Agregar el reporte de un módulo nuevo es un renglón** en la lista `REPORTES`,
al inicio de `server.js`, junto al de `MODULOS`. La pantalla se arma sola.

Las direcciones viejas (`#/comparativa`, `#/calidad/reportes`) siguen abriendo
donde deben: hay tablets con la pantalla abierta desde antes del cambio.

---

## Identidad de marca

Todo el diseño sigue el **Brand Book INKO 2026**. Lo que viene del brandbook está
aislado en `public/marca.css` para que se actualice en un solo lugar.

**Colores** (p.13): Azul INKO `#002F5D` · Azul oscuro `#001D3A` · Gris `#F3F6FA`
· Negro `#111111` · Blanco `#FFFFFF`.

**Logotipo** (p.8–12): extraído del propio brandbook en sus dos versiones
autorizadas, en `public/marca/`. La blanca se usa sobre azul (reposo y barra
superior) y la azul sobre claro (ícono de la app). Se respeta el área de
protección y no se deforma ni recolorea.

**Tipografías** (p.14): Open Sans como principal y Open Sauce para títulos.

> **Pendiente para quedar al 100%:** las tipografías corporativas no vienen con
> la plataforma y el brandbook no las trae embebidas, así que ahora mismo la
> tablet usa la más parecida que tenga instalada. Para cerrarlo, consigue los
> archivos `.woff2` de Open Sans (Regular, SemiBold, Bold) y Open Sauce One Bold
> y déjalos en `public/fuentes/` con esos nombres — se usan solas, sin tocar
> código.

**Estilo «Riel azul»** (escogido el 18-sep-2026 entre dos propuestas). Vive en
`public/riel.css`, encima de `estilos.css`, y solo cambia la forma —los colores
siguen saliendo de `marca.css`—:

- **El riel**: columna Azul oscuro a la izquierda con el logo, **Inicio**,
  **Avisos** (con su cuenta), los módulos de quien entró y **Salir** hasta abajo.
  Cambiar de módulo es un toque. En pantallas angostas se vuelve una franja
  arriba que se desliza.
- **La cabecera Azul INKO** de cada pantalla, con el círculo del logotipo casi
  transparente. En **Inicio** crece y encima se montan las cifras del día: lo que
  espera por ti, el avance de la ODT, los envíos de hoy y las órdenes por fuera
  por armar —cada una lleva a su pantalla—.
- **Tarjetas de módulo** con borde izquierdo azul y una o dos etiquetas de cómo
  va: *72% armado*, *3 por atender*, *Al día*.
- **Los pasos de un documento** (traspasos, órdenes de venta directa) se ven
  como línea de tiempo vertical, con quién hizo cada paso y cuándo.

Los colores de estado (verde «bien», rojo «problema», ámbar «en proceso») **no
son de la paleta de marca**: son señalética. Un operador tiene que distinguir un
problema de un vistazo y el azul corporativo no puede hacer ese trabajo. Están
ajustados para convivir con el navy sin competir con él.

---

## Cómo arrancarla

1. En la computadora del almacén, instala **Node.js LTS** desde <https://nodejs.org>
   (solo se hace una vez).
2. Doble clic en **`Iniciar plataforma.bat`**.
3. La ventana negra que se abre muestra dos direcciones. **Déjala abierta** — si la
   cierras, la plataforma se apaga.

```
  En esta computadora:  http://localhost:3000
  Desde la tablet:      http://192.168.100.5:3000
```

4. En la tablet o en otra computadora, abre el navegador y escribe la dirección
   que empieza con `192.168`. En la tablet, agrégala a la pantalla de inicio para
   que se abra como una app.

> **Arranca sola al encender la computadora.** Hay un acceso directo al `.bat` en
> la carpeta de Inicio de Windows, así que no hay que acordarse de abrirlo. Para
> quitarlo, borra «Sistema Digital INKO» de esa carpeta: pega
> `shell:startup` en el explorador y ahí está.
>
> **Si la computadora se reinicia y nadie entra a Windows, la plataforma no
> levanta**: el acceso directo corre al iniciar sesión, no antes. Con la sesión
> abierta, la ventana negra reaparece sola.

> Todos los equipos deben estar en la **misma red wifi**. Si la computadora cambia
> de red, la dirección `192.168...` cambia; vuelve a leerla en la ventana negra.

---

## Checklists: revisión, aprobación y editor

### Aprobación de lo que se llena

Un checklist que llena un operador **no llega directo a Reportes**. Al cerrarlo
se **envía**, y un Team Leader lo revisa desde **Notificaciones**:

| Quién lo llenó | Quién lo aprueba |
|---|---|
| Operador | Cualquier Team Leader, o el Administrador |
| Team Leader | **Otro** Team Leader, o el Administrador — quien llena no aprueba lo suyo |
| Administrador | Queda aprobado directo: puede hacer todo |
| Tránsito | Queda aprobado al cerrarse: ya trae su propio paso de supervisión |

En la pantalla de revisión hay dos salidas:

- **Aprobar.** Entra a Reportes de Team Leaders y Administrador.
- **Pedir modificación**, escribiendo qué hay que corregir. El checklist se le
  **reabre a quien lo llenó**, con la nota; se le quita la firma porque firmó otra
  versión. Al operador le llega en Notificaciones como «Checklist que te pidieron
  corregir». Corrige, vuelve a firmar y lo reenvía.

**Qué entra a Reportes:** Vigencias, Problemas, Dinero, Comparativa y la
descarga CSV cuentan **solo lo aprobado**. El **Historial** muestra lo aprobado
y también lo que está en corrección, con cuántas modificaciones se pidieron: que
un checklist haya tenido que corregirse es parte de su historia. El detalle de
cada checklist enseña el camino completo (enviado → modificación → enviado →
aprobado), con quién, cuándo y la nota.

Lo que ya estaba cerrado antes de que existiera la aprobación se tomó por
aprobado, para no sacar la historia de Reportes.

Permiso: **Aprobar o pedir modificación de un checklist** (Configuración →
Permisos → Checklists). Lo heredan quienes ya firmaban la supervisión.

### Documentación por unidad

En «6. Documentación y extras» de la Inspección de Unidad, **tarjeta de
circulación, póliza y fumigación piden su fecha de vencimiento** —obligatoria— y
aparecen en Reportes → Vigencias con los días que les quedan. **El dinero de la
unidad pide el monto y la foto del efectivo**, los dos obligatorios, y aparece en
Reportes → Dinero en las unidades. Los ítems viejos de «bien/problema» se
retiraron sin borrarse: lo capturado con ellos sigue en Reportes. La fecha de
ANTRA se quedó opcional, como estaba.

En las unidades, «Observaciones adicionales» se llama **Comentarios adicionales**.

### Montacargas

Se envía **solo con la firma de quien lo llena**, como los demás. La firma del
coordinador la reemplaza la aprobación del Team Leader.

### Insumos y Cajas

Ya no es checklist. El material de empaque se lleva como **inventario normal de
Almacén**: entra con Entradas, se descuenta con Salidas y se cuadra con el Conteo
semanal. Se agregaron al catálogo los que faltaban: Caja Proveedor 80x70, Cintas
Termiko y Repuestos de Cutter. Lo que se capturó con el checklist sigue en
Reportes.

### Crear un checklist nuevo

**Configuración → Checklists → Agregar un checklist** (2-oct-2026). Antes, un
checklist nuevo había que escribirlo en el código; con los tipos de unidad
entrando y saliendo eso ya no se sostenía.

Se crea de dos maneras:

- **Copiando uno que se parezca** —lo normal—. Trae sus áreas y sus preguntas
  tal cual, y de ahí se ajusta lo que cambie. Una moto se revisa casi como otra
  moto. Lo que **no** se copia es lo capturado: el checklist nuevo nace en blanco.
- **Desde cero**, sin preguntas, para escribirlas en el editor.

Al crearlo se dice **a qué se le llena** (un tipo de unidad, o nada si no es de
una unidad), **cada cuándo**, quién lo firma y si exige foto al marcar un
problema. En cuanto se guarda se abre su editor, porque un checklist nuevo casi
siempre necesita ajustes.

Los ítems marcados para una sola unidad —«solo para el ISUZU»— no se copian a un
checklist de otro tipo: ahí no significan nada.

### Un checklist de unidad sin unidades no aparece

**Es a propósito y no es una falla:** un checklist de unidad se le llena a una
unidad, así que mientras no haya ninguna de su tipo dada de alta no hay a qué
llenárselo y no sale ninguna tarjeta.

Para que no parezca que el checklist no se creó, se ve en dos lugares:

- En **Logística → Checklists**, abajo, como *«Checklists que esperan unidades»*.
- En **Configuración → Checklists**, en la columna *Se le llena a*, que dice
  **sin unidades**.

Las unidades se agregan en **Configuración → Unidades**, y la tarjeta aparece
sola en cuanto hay una.

### Editor de preguntas

**Configuración → Checklists → Editar preguntas** (solo Administrador). Por cada
área: renombrarla, subirla o bajarla, retirarla y agregar preguntas. Por cada
pregunta: cambiar la redacción, el tipo de respuesta y el orden, marcar un
vencimiento como obligatorio, o retirarla.

**Nada se aplica mientras editas.** Al terminar, **Guardar cambios** —en la barra
de hasta abajo, que se enciende en cuanto hay algo pendiente— aplica todo de una
vez: redacción, tipos, orden, preguntas y áreas nuevas, y retiros. Si algo no se
puede guardar, no se guarda nada y dice por qué. **Descartar cambios** regresa a
como estaba, y salir de la pantalla con cambios pendientes pregunta antes.

- **Cambiar la redacción** corrige la pregunta también en lo ya capturado: es la
  misma pregunta.
- **Retirar no borra.** La pregunta o el área dejan de salir en la tablet, pero lo
  contestado sigue en Reportes.
- **El tipo de respuesta** (Bien/Problema, Sí/No, Fecha de vencimiento, Monto con
  foto, Documento adjunto, Texto, Hora) solo se cambia mientras nadie la haya
  contestado. Si ya tiene respuestas:
  retírala y agrega una nueva.
- Las tablas de conteo no se editan desde aquí.
- **Documento adjunto** es el tipo de las hojas de Tránsito; se carga antes o al
  final según el área donde quede. **Texto** es para lo que se escribe (placas,
  chofer) y **Hora** para una hora (arribo del transporte); los dos son obligatorios.
- En Tránsito cada área dice **Aplica a: Envío, Colecta o Todos**.
- **Lo que guardas aquí se queda.** Antes, cada vez que arrancaba la plataforma,
  `seed.js` volvía a alinear las preguntas con su lista original, emparejándolas por
  posición: reordenar en el editor podía hacer que un reinicio reescribiera el texto
  de la pregunta equivocada, y un área renombrada volvía a aparecer con su nombre
  viejo. Ya no: `seed.js` solo crea los checklists que no existen, y un cambio de
  estructura hecho por el sistema va como migración de una sola vez en `db.js`.

Permiso: **Editar las preguntas y áreas de los checklists** (solo Administrador).


### Si se detiene

Desde el 18-sep-2026 `Iniciar plataforma.bat` **la vuelve a levantar sola** a los
5 segundos si se detiene por un error, y cada arranque y cada motivo de salida
queda anotado en **`datos/servidor.log`** (fecha · qué pasó). Para apagarla de
verdad se cierra la ventana negra. Si se abre dos veces, la segunda avisa que ya
estaba abierta y no insiste.

> **Por qué se caía.** No era un error del programa —si lo fuera, la ventana se
> habría quedado abierta con «El servidor se detuvo»—: desaparecía la ventana
> entera. Coincidía con que Claude la había vuelto a arrancar desde su sesión, y
> al cerrarse esa sesión Windows se llevaba todo lo que había arrancado. Ahora
> Claude la arranca a través de WMI (`Win32_Process.Create`), que la deja como
> proceso aparte; ahí no aparece la ventana negra, pero la plataforma queda igual
> de arriba. Al reiniciar la computadora vuelve a arrancar sola, con su ventana.

### Dónde vive la plataforma, y por qué importa

**La plataforma es una computadora, no una aplicación del iPad.** El iPad no
guarda nada: abre una ventana a la computadora donde la plataforma está
corriendo, por el wifi del almacén. Todo —los checklists, las fotos, el
inventario— vive en esa computadora, en `datos/checklists.db`.

De ahí se siguen tres cosas, y conviene decirlas sin rodeos:

- **Si esa computadora se va del almacén, el iPad se queda sin nada que abrir.**
  No es una falla: no hay con quién hablar. (Pasó el 27-oct-2026: la
  computadora se fue a casa y en el almacén dejó de funcionar.)
- **Si se duerme, se apaga o se cierra la ventana, es lo mismo.**
- **Si cambia de wifi, su dirección cambia** y la que el iPad tiene guardada deja
  de servir.

**Lo que hay que hacer: que viva en una computadora que se quede.** Cualquiera
sirve —una PC de escritorio, una mini PC, una laptop vieja— mientras esté
enchufada, prendida y en el wifi del almacén.

> **Los pasos completos están en
> [`MUDANZA - pasar la plataforma a una computadora del almacen.md`](MUDANZA%20-%20pasar%20la%20plataforma%20a%20una%20computadora%20del%20almacen.md)**,
> en esta misma carpeta: qué computadora sirve, cómo sacar los datos sin perder
> lo último, cómo dejarla arrancando sola, cómo fijarle la dirección en el
> router y cómo quedan los respaldos fuera de OneDrive.

**Al copiar los datos hay una trampa.** Con la plataforma encendida, lo más
reciente —a veces semanas— no está en `checklists.db` sino en un archivo
`checklists.db-wal` a su lado. Copiar solo el primero se lleva la base vieja.
Por eso se apaga la plataforma antes de copiar (al apagarse junta todo en un
archivo), o se usa `node respaldar.js`, que hace una copia consistente aunque
alguien esté capturando.

En esa computadora se ejecuta una vez, con clic derecho → **Ejecutar como
administrador**, el archivo **«Dejar lista la computadora»**. Hace tres cosas y
las dice antes de hacerlas: crea una tarea que **arranca la plataforma sola al
iniciar sesión** (sin ventana negra que se pueda cerrar sin querer), le dice a
Windows que **no se duerma** estando enchufada, y que **cerrar la tapa tampoco**
la duerma. No toca el firewall ni el antivirus. Para deshacerlo:
`schtasks /delete /tn "INKO Sistema Digital" /f`.

### Cuando el iPad no la encuentra

Desde el 28-oct-2026 el iPad **lo dice con todas sus letras** en vez de quedarse
en blanco o decir «Ocurrió un error»:

> No se puede hablar con la plataforma. La computadora donde vive está apagada,
> dormida o fuera del wifi del almacén. Lo que ya se guardó está a salvo; en
> cuanto vuelva, esta pantalla sigue sola.

Y abajo queda una **tira roja fija** mientras dure. El iPad toca la puerta cada
medio minuto: en cuanto la plataforma vuelve, la tira se quita sola, la pantalla
se vuelve a pintar y **se suben las fotos que quedaron esperando**. Nadie tiene
que recargar nada.

### Cuando la pantalla se quedó atrás

Una tablet puede pasar días con la pantalla abierta sin recargar: se queda con
la versión que cargó el día que la prendieron, y entonces «no sirve» algo que ya
se arregló. Desde el 3-nov-2026 la plataforma dice qué versión corre y la
pantalla se da cuenta sola: sale una **tira azul abajo** —*«Hay una versión
nueva de la plataforma»*— con un botón **Actualizar ahora**.

**No se recarga sola.** A media captura, recargar sin avisar sería peor que la
enfermedad: la tira espera a que quien la está usando diga cuándo.

---

## Acceso desde otros equipos

Funciona igual desde tablet, laptop o computadora de escritorio: es la misma
dirección en el navegador. La interfaz se adapta sola —en pantalla grande usa el
ancho disponible y los botones se ajustan al mouse— y **el regreso automático al
reposo solo ocurre en dispositivos táctiles**, para no interrumpir a alguien que
lleva rato leyendo un reporte en su computadora.

### Si otro equipo no abre la dirección

Casi siempre es el **Firewall de Windows**, no la plataforma. En esta computadora
hay **cuatro reglas que bloquean Node.js** — dos para redes públicas y dos para
privadas — así que ningún otro equipo puede entrar, ni tablet ni celular.

> **De dónde salen esas reglas:** cuando arrancas la plataforma, Windows pregunta
> si permites que Node se comunique en la red. Si se responde **Cancelar** o
> **Bloquear**, Windows crea una regla de bloqueo permanente. Ha pasado dos
> veces. Si el aviso vuelve a salir, elige **Permitir acceso** y marca las dos
> casillas (redes privadas y públicas).

Para arreglarlo, abre **PowerShell como administrador** (clic derecho en Inicio →
*Terminal (Administrador)*) y corre estos dos comandos:

```powershell
Remove-NetFirewallRule -DisplayName "Node.js JavaScript Runtime" -ErrorAction SilentlyContinue
```

```powershell
New-NetFirewallRule -DisplayName "Sistema Digital INKO" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any -RemoteAddress LocalSubnet
```

El primero borra **las cuatro** reglas de bloqueo. El segundo abre **únicamente
el puerto 3000 y solo para equipos de tu propia red** (`LocalSubnet`), que es lo
mínimo necesario: no expone nada a internet.

Para comprobar que quedó bien, en la misma ventana:

```powershell
Get-NetFirewallRule -DisplayName "Node.js JavaScript Runtime" -ErrorAction SilentlyContinue | Measure-Object | Select-Object Count
```

Debe decir **0**. Si dice otra cosa, las reglas de bloqueo siguen ahí.

No los corrí por ti a propósito. El firewall es una defensa del equipo y esa
decisión debe tomarla una persona, no quedar dentro de un script.

**Si aun así no entra**, revisa en este orden:

1. **La VPN de McAfee** está activa en esta computadora y cuando enruta el
   tráfico puede tapar la red local. Desconéctala un momento y prueba.
2. **El celular debe estar en el wifi del almacén**, no en datos móviles. La
   dirección `192.168.100.5` solo existe dentro de esa red.
3. **La dirección cambia** si la computadora se reconecta. La buena siempre es la
   que aparece en la ventana negra al arrancar.

---

## Primer uso

Entra con **Administrador** y su clave. Luego ve a **Configuración** y:

1. **Cambia la clave del administrador** o crea tu propio usuario admin.
   (En una instalación nueva la clave inicial es `1234`; cámbiala de inmediato.)
2. **Da de alta a tu equipo.** Cada persona con su puesto (ver tabla abajo).
3. **Revisa las unidades.** Vienen cargadas ISUZU, NP300, PARTNER y un montacargas
   genérico (`MC-01`). Ajusta o agrega las que falten.

---

## Puestos y accesos

Cada persona ocupa **un puesto**, y el puesto trae lo que puede hacer. Encima se le
puede dar o quitar algo a ella sola (*Configuración → Permisos*). Los puestos
**viven en la base, no en el código**: el Administrador crea los que hagan falta
conforme cambie el organigrama (ver *Puestos: crear, renombrar, retirar*).

El sistema arrancó con cuatro:

| Puesto | Llena checklists | Firma como operador | Autoriza salida y cierra Tránsito | Reportes | Comparativa | Configuración |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Operador | sí | sí | — | — | — | — |
| **Team Leader** | sí | sí | **sí** | **sí** | — | — |
| **Administrador** | sí | sí | **sí** | **sí** | **sí** | **sí** |

El mismo permiso cubre tres cosas: la firma de autorización del montacargas, la
autorización de salida de Tránsito y el cierre de su proceso.

**Calidad tiene su propia columna de permisos**, aparte de estos. Está descrita en
la sección *Calidad* más abajo.

**El cuarto puesto es «Ventas directas»**: el puesto de quien vende por fuera y
levanta las órdenes de armado. Solo trae **Ventas directas** y **Notificaciones**,
y dentro de Ventas directas solo levanta sus órdenes y les carga la guía o la nota
de remisión: no arma ni cierra, y no ve las órdenes de otros vendedores. Cualquier
otra cosa que haga falta se le da aparte en *Configuración → Permisos*, persona por
persona.

### Configuración, por secciones

| Pestaña | Qué tiene |
|---|---|
| **Personas** | Nombre, puesto, clave, estado (alta/baja) e historial de cada quien |
| **Puestos** | Los puestos del organigrama: crear uno nuevo, renombrarlo, retirarlo |
| **Permisos** | Se escoge el módulo, luego el puesto y, si hace falta, la persona; abajo se marca o se quita cada acción |
| **Unidades** | Camionetas y montacargas, con sus parámetros y su imagen |
| **Checklists** | Qué formatos existen y cuáles están en circulación |
| **Materiales** | Catálogo de Calidad: modelos con su imagen, proveedores y colores de fondo |
| **Modo de pruebas** | Prenderlo, entrar como cualquier puesto o persona, y apagarlo (ver *Modo de pruebas*) |

**Imagen de cada unidad y de cada material.** En *Unidades* y en *Materiales* cada
renglón tiene su columna de imagen: **Subir**, **Cambiar** o quitarla. Aparece
donde se usa:

- La de la **unidad**, en la tarjeta de su checklist y arriba de la hoja al
  llenarlo: quien revisa sabe de un vistazo qué unidad tiene enfrente.
- La del **material**, en cada lote de Calidad al muestrearlo, y en Almacén en los
  productos que se muestrean contra ese material —en Inventario, en su
  consolidado y en los documentos—.

**Borrar o retirar.** Cada producto tiene **Editar** (nombre, stock mínimo, «En
uso») y **Borrar producto**; cada modelo, en *Especificación*, **Borrar modelo**. Se
borra solo lo que **nunca se usó**. Si ya tiene historia —muestreos, movimientos de
inventario, órdenes, o lo usa el catálogo de la ODT— la plataforma dice cuál es y
pide **retirarlo** (desmarcar «En uso» / «Se muestrea»): deja de ofrecerse y la
historia se sigue leyendo igual.

**La foto de cada producto aparece donde se use**: en Almacén (inventario,
documentos, conteos, traspasos), en Producción (partidas y material de la ODT), en
Calidad (re-ingresos y material sin muestreo) y en Ventas directas (lo vendido).
Un producto sin foto propia usa la de su modelo.

**Materiales es un solo catálogo, por familia** (lo pidió así el 18-sep-2026: un
rollo 80x70 es el mismo producto para Calidad que para Almacén, así que no se
divide por módulo sino por lo que es). Arriba se escoge la familia:

| Familia | Qué junta |
|---|---|
| **Rollos de papel** | Rollos térmicos y rollos de papel |
| **Etiquetas térmicas** | Etiquetas térmicas y compatibles Brother |
| **Portarollos** | Portarollos |
| **Material de empaque** | Cajas y material de empaque (sobres, playo, despachadores…) |
| **Proveedores** · **Colores de fondo** | Las listas que usa Calidad al recibir |

En **Rollos** y **Etiquetas**, cada **modelo de muestreo** (80X70, 4X6, 62 BROTHER…)
aparece cerrado con su imagen, un resumen de su especificación y cuántos productos
tiene. Al tocar *N producto(s)* se abren sus productos de Almacén (colores,
presentaciones), cada uno con su imagen; el que no tiene imagen propia usa la de su
modelo. **Especificación** abre la ventana con lo que se llena solo en la hoja de
muestreo, con un solo botón de guardar. Los productos que Calidad no muestrea van
juntos al final, en *Sin modelo de muestreo*. Hasta abajo se agrega un modelo
nuevo a esa familia.

Cada familia trae **filtro por tipo** y **buscador** (modelo, producto o SKU); al
buscar, los modelos se abren solos. La pantalla recuerda la familia y el filtro.

La imagen del **modelo** es la que ve Calidad al muestrear; la del **producto**,
la que ve Almacén y quien escoge la caja de una orden de venta directa.

Una sola imagen por renglón: subir otra reemplaza la anterior.

### Puestos: crear, renombrar, retirar

En **Configuración → Puestos** está cada puesto con cuántas personas lo ocupan.

- **Crear un puesto:** nombre, una línea de qué hace, y **de qué puesto nace
  copiando**. Puede copiar cualquiera, **incluso el de Administrador**: copia todo
  lo que el Administrador puede repartir, pero **nunca** lo que es solo suyo
  —Configuración, la aprobación final de Calidad y autorizar incidencias—. Ser
  Administrador es el cargo, no una lista de casillas. Al crearlo, la plataforma
  te lleva a *Permisos* con ese puesto escogido para que le ajustes lo que haga
  falta, módulo por módulo.
- **Renombrar** no cambia nada de lo que puede hacer.
- **Retirar** solo se puede cuando ya no lo ocupa nadie activo; deja de ofrecerse
  al dar de alta a alguien y se puede reactivar.
- **Borrar** solo aparece si nunca lo ocupó nadie. Si ya tuvo gente, se retira.

El de **Administrador** no se edita: puede todo por su cargo.

### Permisos: módulo, puesto y persona

En **Configuración → Permisos** se trabaja en tres pasos, de izquierda a derecha:

1. **Módulo.** Por ejemplo *Calidad*.
2. **Puesto.** La lista dice cuántas personas lo ocupan y cuántas acciones del
   módulo trae: *Operador · 7 persona(s) · 3 de 9*.
3. **Persona.** Empieza en **«Todo el puesto»**. Si se escoge a alguien, lo que se
   toque es solo para esa persona. Junto a cada nombre dice *con ajustes* si ya
   tiene algo distinto de su puesto.

Abajo aparecen **todas las acciones de ese módulo**, una por renglón. Se toca el
renglón para darlo o quitarlo, y al final **Guardar cambios**:

- Con **«Todo el puesto»**, el cambio le llega a **todas** las personas que lo
  ocupan. A quien se le dio o se le quitó algo aparte lo conserva: sus ajustes van
  encima del puesto.
- Con **una persona**, cambia solo ella. Cada renglón dice de dónde le viene:
  *Viene con su puesto*, *Se le dio aparte de su puesto* o *Se le quitó aunque su
  puesto lo trae*, y el fondo azul marca esos ajustes. Al pie aparece **Dejarle
  solo lo de su puesto** para borrarle todos sus ajustes.

El primero de la lista es entrar al módulo —lo que lo hace aparecer en el menú—;
los demás, lo que se puede hacer una vez dentro.

Algunas acciones dicen **«Se comparte con…»**: son las que dos módulos comparten de
verdad. Tránsito se captura y se firma con las mismas funciones de Checklists, y
las dos aprobaciones de Calidad aparecen también en Almacén: es el mismo
interruptor visto desde los dos lados — quitarlo en uno lo quita en el otro.

**Nada se aplica hasta tocar «Guardar cambios»**: abajo aparece una barra con
cuántos cambios llevas —y si son para todo el puesto o para una persona—, y los
renglones tocados quedan con borde ámbar. **Descartar** los deshace. Si cambias
de módulo, de puesto o de persona con cambios sin guardar, la plataforma pregunta
antes de tirarlos.

La validación mira cómo queda la persona **al final**, no cambio por cambio: así
puedes quitarle un permiso y darle otro en la misma tanda. Si algo es inválido, no
se guarda nada.

El Administrador aparece con todo marcado y sin nada que tocar: puede todo por su
cargo, no por asignación.

> Si entre los cambios están los tuyos, la plataforma avisa antes de guardar:
> cambiarte los permisos cierra tu propia sesión y tendrás que volver a entrar.

Dos cosas que la plataforma no deja hacer:

- **Dejar a alguien sin ningún módulo** —ni a una persona ni, al cambiar un
  puesto, a ninguna de las que lo ocupan—. Entraría a un menú vacío.
- **Darle a un puesto algo que es solo del Administrador.**
- **Dar Reportes, Comparativa o Configuración a quien no tiene clave.** Primero se
  le asigna uno en la pestaña Personas.

Cambiarle los permisos a alguien **le cierra la sesión al instante**, para que no
siga con los accesos viejos. Si te los cambias a ti mismo, te toca volver a entrar.

### Accesos que son de una persona, no de su puesto

La **Comparativa** la ve quien lleva Planeación Logística, que hoy es **Héctor
Célis** — no los cuatro Team Leaders. Como sería absurdo inventar un puesto por
cada excepción, existen los **accesos adicionales**: en la ficha de cada persona
(Configuración → ✎) hay casillas para otorgarle algo por encima de su puesto.

Héctor tiene marcada **Comparativa entre semanas**. Los otros Team Leaders no, y
si entran a esa dirección el servidor los rechaza. **El Administrador la ve
siempre**, igual que Reportes y Configuración: le vienen incluidas en su puesto,
no hace falta otorgárselas.

En la tabla de Personas, la columna **A qué tiene acceso** muestra lo que cada
quien puede ver de verdad. Las marcadas con **★** se otorgaron a esa persona en
particular; las demás vienen de su puesto.

Cuando alguien más tome Planeación Logística, se desmarca la casilla en la ficha de
Héctor y se marca en la de la persona nueva. **No hay que tocar código ni cambiar
puestos.** La columna *Accesos extra* de la tabla muestra de un vistazo quién
tiene qué.

Si el puesto elegido ya incluye ese acceso (un Administrador siempre ve todo), la
casilla aparece marcada y bloqueada: no tendría sentido "quitársela".

**Configuración no se puede otorgar así, a propósito.** Dar de alta gente es la
llave maestra y sigue atada al puesto de Administrador.

**Configuración es exclusiva del Administrador.** Es donde se dan de alta personas
y unidades, así que quien entra ahí puede darse a sí mismo cualquier permiso.

**Y siempre vuelve a pedir la clave**, aunque la tablet ya traiga una sesión
abierta. Los demás módulos, si ya te identificaste, te dejan pasar; Configuración
no. Que alguien haya dejado su sesión abierta no es prueba de quién está
entrando.

Por lo mismo, **al salir de Configuración se cierra la sesión**. Si no, el
Administrador dejaría la tablet con su sesión activa y el siguiente entraría a
Checklists como él sin capturar ninguna clave. Moverse entre las pestañas de
Configuración no la cierra: solo salir.

> Consecuencia práctica: ahí solo entra quien tenga el permiso de Configuración
> —hoy únicamente el Administrador—. Una clave válida de cualquier otra persona
> se rechaza con el aviso de que no le toca.

**Reportes lo ven los Team Leaders y el Administrador. La Comparativa, solo quien
la tenga otorgada** (hoy Héctor Célis) **y el Administrador.**

El bloqueo no es solo que el botón no aparezca: cada llamada al servidor vuelve a
verificar el permiso. Escribir la dirección a mano no sirve de nada.

**Toda persona activa necesita clave**, porque es con lo que entra: de 4 a 12
caracteres, **letras y números**, para poder usar claves con significado. En la
pantalla de acceso hay teclado numérico en pantalla *y* campo de texto: las
claves con letras se capturan tecleando. Mayúsculas y minúsculas dan igual, y
por eso mismo **dos personas no pueden tener la misma clave** — ni contando a
las que están de baja, que pueden reactivarse.

Los puestos que ven información de toda la operación (Team Leader y
Administrador) ya la exigían desde antes, y ahí no hay excepción posible: la
plataforma no deja crearlos sin clave.

### Editar a una persona

En **Configuración → Personas**, el ícono **✎** a la derecha de cada nombre abre su
ficha. Desde ahí se cambia todo:

- **Corregir el nombre** — errores de dedo, apellidos que faltaban.
- **Cambio de puesto** — un ascenso a Team Leader, o un regreso a Operador.
- **Accesos adicionales** — otorgar la Comparativa (o Reportes) a esa persona en
  particular, por encima de lo que trae su puesto.
- **Clave** — dejarla vacía no la toca. Escribir una la reemplaza. Si ya se entra
  por clave, **no se puede quitar**: sería dejar a esa persona fuera del sistema
  sin decírselo. Para que deje de entrar, se le da de baja. Tampoco se acepta una
  clave que ya sea de alguien más.
- **Baja** — desmarcar *Activo* cuando alguien deje la empresa.

**Dar de baja no borra a nadie.** Su clave deja de servir para entrar, pero sus
checklists y firmas siguen intactos en el historial. Un
checklist firmado en marzo debe seguir mostrando quién lo firmó aunque esa persona
ya no trabaje ahí. Si regresa, se vuelve a marcar *Activo* y sigue con su historial.
La ficha muestra cuántos llenados y firmas tiene cada quien.

Dos protecciones que verás si te topas con ellas:

- **No se puede quitar al último Administrador.** Ni degradarlo ni darlo de baja
  mientras sea el único activo — nadie podría volver a entrar a Configuración, ni
  siquiera para deshacerlo. Nombra a otro Administrador primero.
- **Cambiar el puesto de alguien cierra su sesión al instante.** Si acabas de
  degradar a un Team Leader, no se queda con la pestaña de Reportes abierta hasta
  que caduque su sesión: se le pide entrar de nuevo y ya con los permisos nuevos.
  Si te editas a ti mismo, te tocará volver a entrar.

### La segunda firma del montacargas

En papel, el checklist de montacargas llevaba dos firmas: "Firma Operador" y
"Firma del Coordinador". Como el puesto de coordinador no existe, esa segunda
firma se llama ahora **"Firma de autorización (Team Leader)"** y solo la puede
levantar un Team Leader o el Administrador.

Al operador ni siquiera se le muestra el recuadro: captura su parte, y el Team
Leader autoriza después desde su sesión. El checklist no cierra sin esa firma.

> Si alguien viene de una versión anterior con puestos `coordinador` o
> `lider_logistica`, la plataforma los reasigna sola al arrancar y avisa en la
> ventana negra: `lider_logistica` pasa a Team Leader, y `coordinador` pasa a
> **Operador** — a propósito, para no regalarle acceso a Reportes a nadie sin que
> tú lo decidas. Si alguno debe ser Team Leader, cámbialo en Configuración.

### Si necesitas mover un permiso

Todo está en un solo bloque al inicio de `server.js`, en `PERMISOS`. Por ejemplo,
para que los operadores también vean los reportes de Checklists, agrega
`mod_reportes: true` y `reportes: true` a `operador` y reinicia — uno abre el
módulo y el otro da ese reporte en particular. El menú de la app, los bloqueos
del servidor y la exigencia de clave se ajustan solos — no hay nada más que tocar.

### Dato pendiente

**NP300 no tiene presión de llantas.** En el archivo original el campo venía vacío,
así que en la app aparece como `Presión de llantas __ psi`. Ve a
**Configuración → Unidades** y captúrala cuando la tengas.

---

## Claves y accesos: el bloqueo a los cuatro intentos

**A los cuatro intentos fallidos el acceso se traba, y no se destraba solo con el
tiempo.** Lo libera el Administrador o Hector, y la liberación queda anotada con
el nombre de quien la hizo.

### Qué se traba

Depende de si se sabe de quién fue el intento:

| Cuando la pantalla… | Lo que se traba | Hasta cuándo |
|---|---|---|
| pide el **nombre** y luego la clave | **la persona**, y la sigue a cualquier tablet | hasta que alguien la libere |
| pide **solo la clave** (la clave es la identidad) | **la tablet** desde donde se teclearon | hasta que alguien la libere |

Con la clave sola, una clave equivocada no apunta a nadie: no hay a quién
bloquear, y trabar la tablet es lo único que corta el tanteo a ciegas. Hoy la
plataforma entra **por nombre + clave**, porque quedan personas activas sin clave
asignada: mientras sea así, lo que se bloquea es la persona. (Una persona sin
clave entra tocando su nombre, así que no tiene nada que fallar ni qué trabar:
una razón más para terminar de repartir claves.)

### Antes de bloquear, avisa

Cada intento fallido dice cuántos quedan — *«Clave incorrecta. Te quedan 2
intentos»* — y el último avisa en singular: *«Te queda 1 intento antes de que se
bloquee el acceso»*. El bloqueo que nadie vio venir es el que para el turno.

### Se libera en la misma pantalla

En la pantalla donde quedó trabada aparece un campo: **el Administrador o Hector
escriben su propia clave ahí mismo** y el acceso se abre al instante. No hay que
buscar una computadora ni esperar a que alguien llegue.

- La clave que se escribe ahí es **la de quien libera**, no la que se bloqueó.
- Una clave sin ese permiso no libera nada, y el intento **cuesta un minuto de
  espera**: ese campo no sirve para tantear claves.
- Quien tenga **su propia clave bloqueada no se libera a sí mismo**. Si pudiera,
  el bloqueo no serviría para él.

### La pantalla de Claves y accesos

*Configuración → Claves y accesos* para el Administrador, y en **`#/accesos`**
para quien solo tenga el permiso de liberar: **no cuelga de Configuración**, así
que Hector entra a liberar sin que se le abra el resto. También llega ahí desde
el aviso de Notificaciones.

Trae tres cosas: **quién está bloqueado ahora** (personas y tablets, con un botón
para liberar), **las claves del personal** (quién tiene clave, cuántos intentos
fallidos lleva) y **los últimos movimientos**.

**Bloquear a mano** es para cuando alguien se va o su clave anda rodando: deja de
entrar al instante, se le cierra la sesión si estaba dentro, y **pide el motivo**
—un bloqueo sin explicación es un misterio para quien lo encuentre después—.
Nadie puede bloquearse a sí mismo: no quedaría quién lo libere.

### La bitácora

Cada entrada al sistema, cada intento fallido, cada bloqueo y cada liberación
quedan escritos: cuándo, quién, desde qué tablet y quién liberó. Es el registro
que una auditoría pide cuando pregunta quién tocó el sistema, y **no se puede
reconstruir después**, así que se guarda aunque nadie lo mire. Se consulta en
*Reportes → Accesos y bloqueos*, con filtros por fecha, persona y qué pasó.

**Quién tiene el permiso.** `claves_liberar` no viene con ningún puesto; se le dio
a **Hector (Chief of Warehouse)** a la persona, no al puesto: el puesto describe
lo que hace un COW, y esto es un encargo de confianza para alguien en concreto. El
Administrador lo tiene siempre.

---

## Qué cambió respecto al papel

| Antes (papel) | Ahora |
|---|---|
| 3 formatos separados: ISUZU, NP300, PARTNER | **Un solo** "Inspección de Unidad". Lo que cambiaba entre ellos (presión de llantas, grado de aceite, los 3 ítems exclusivos del ISUZU) sale de los datos de cada unidad. Agregar una camioneta nueva ya no implica un formato nuevo. |
| "Con problema" se marcaba sin explicar | No deja cerrar el checklist si hay un ítem marcado como problema **sin observación escrita ni foto de evidencia**. |
| Los 27 ítems del montacargas en una lista corrida | Agrupados en 4 bloques para que se lean en tablet. Son los mismos ítems, en el mismo orden. |
| Firma con pluma | Firma con el dedo en pantalla, con nombre, fecha y hora. |
| Había que buscar entre hojas para saber qué falló | Pantalla **Reportes**: todo lo marcado como problema, junto y ordenado. |

Todo lo demás se transcribió literal: mismos ítems, mismas secciones, mismo orden.

---

---

## Checklists retirados

**Avisos Semanales está retirado.** No aparece en la tablet, no se puede abrir por
URL y la Comparativa ya no lo cuenta como pendiente. No se borró: sus 20 actividades
siguen transcritas, solo marcadas como inactivas.

Esto ya no requiere comandos: **Configuración → Checklists**. Cada renglón tiene
dos interruptores, *Exige foto* y *En uso*. Un toque los cambia.

Retirar un checklist **no borra lo ya capturado**: los llenados anteriores siguen
apareciendo en Reportes y en la exportación a Excel. Solo deja de pedirse.

---

## Cuándo se llena cada checklist

> **El Administrador los abre cualquier día.** Unidad y Montacargas se llenan
> solo los viernes, y para operadores y Team Leaders la regla sigue igual —la
> tarjeta atenuada y el servidor rechazando—. El Administrador puede todo y es
> quien prueba y corrige los checklists: esperar al viernes para probar un cambio
> de un martes era perder la semana. Su tarjeta dice «fuera de su día».
>
> **Ojo:** lo que el Administrador llene fuera del viernes cuenta para esa semana.
> La tarjeta de esa unidad deja de salir pendiente para todos hasta que se borre
> en **Configuración → Limpieza**. Al terminar de probar, bórralo.

> **Para probar como otro puesto** ya no hace falta suspender la regla del viernes
> a toda la operación: el **modo de pruebas** se mudó a Configuración y trabaja
> sobre una copia (ver *Modo de pruebas*). Dentro de la copia no hay reglas de
> día; fuera de ella, la regla del viernes sigue igual para todos.

| Checklist | Cuándo |
|---|---|
| Inspección de Unidad (ISUZU, NP300, PARTNER) | **Solo viernes** |
| Inspección de Carro Utilitario | **Solo viernes** |
| Inspección de Carro de Arrendamiento | **Solo viernes** |
| Inspección de Moto | **Solo viernes** |
| Inspección de Montacargas | **Solo viernes** |
| Inspección de Patín Hidráulico | Semanal |
| Insumos y Cajas | Semanal |
| Checklist Tránsito | Diario, uno por envío |

Los de viernes aparecen el resto de la semana como *disponible el viernes* y no
se pueden abrir. El servidor también lo rechaza — no basta con atenuar la
tarjeta: quien llegue con una dirección guardada recibe un *«solo se llena los
viernes»*.

---

## Salidas de unidad: el Formato de Asignación e Inspección Vehicular

> **Qué cambió (23-oct-2026).** Lo que se llamaba *Checklist Tránsito* ahora es
> el **Formato de Asignación e Inspección Vehicular**, transcrito del documento
> que trabajó Ronaldo. Antes servía solo para los envíos a CEDIS; ahora se llena
> **antes de que salga cualquier unidad de carga**, diga a lo que vaya. Y
> **Tránsito dejó de ser un módulo del menú**: lo que hace es sacar unidades, y
> las unidades viven en Logística.

Se llena **antes de la salida** y se cierra **cuando la unidad regresa**. Puede
haber varios el mismo día.

### Dónde vive

**Logística → Salidas de unidad**. Al entrar están las abiertas arriba —cada una
con su etiqueta: *Preparando*, *Salida por autorizar*, *Por corregir*, *Salida
autorizada*, *Cierre por aprobar*—, las concluidas del día abajo, y el botón
**+ Nueva salida de unidad**. Ahí mismo están los traspasos entre bodegas que le
tocan a Tránsito.

Quien solo tenía Tránsito sigue entrando: su módulo lo manda directo aquí.

### Al empezar: para qué sale la unidad

Lo primero es **¿Para qué sale la unidad?** Hasta contestarlo no aparece lo demás.
Son cinco:

| Tipo | Qué es |
|---|---|
| **Envío a CEDIS** | INKO sale a entregar a un CEDIS |
| **Envío de ventas directas** | sale material de una venta directa |
| **Custodia** | la unidad acompaña o resguarda algo |
| **Encargo** | sale a un mandado de la empresa |
| **Traspaso de material entre bodegas** | la unidad va por material de otra bodega |
| **Colecta** | viene un transportista a recoger: **no sale ninguna unidad nuestra** |

**La inspección de la unidad es la misma para los cinco primeros.** Lo único que
cambia entre ellos es declarar para qué sale. La colecta no la lleva, porque ahí
no sale ninguna unidad.

#### Una salida, varias cosas

Un viaje casi nunca hace una sola cosa: la unidad deja el envío en el CEDIS,
entrega dos pedidos de ventas directas y de regreso trae material de la otra
bodega. Antes eso eran tres formatos —la misma unidad inspeccionada tres veces,
tres autorizaciones, tres kilometrajes— o un solo formato que mentía sobre lo
que la unidad iba a hacer.

Debajo de *¿Para qué sale la unidad?* está **¿Algo más en la misma salida?**: se
marca con el dedo todo lo demás que va a hacer el viaje. **Cada cosa agrega sus
preguntas y sus datos al mismo formato** —lo del CEDIS y lo de ventas directas,
juntos— y lo principal no se puede marcar dos veces.

**También se agrega después.** Dentro del formato, arriba, está el panel **«Qué
va a hacer esta salida»**: ahí se marca o se desmarca mientras el formato siga
preparándose, y las preguntas aparecen o se van en el acto. Lo que ya se
contestó no se borra. Si lo nuevo trae un dato —un traspaso pide de qué bodega—,
se pregunta ahí mismo, en vez de contestar «falta la bodega» sin dónde
escribirla. Una vez enviado a autorizar ya no se toca: se autoriza eso y no otra
cosa. Una **colecta** no se junta con nada, porque no sale ninguna unidad.

(Lo pidió Ronaldo el 26-oct-2026.)

**El traspaso pide una cosa más: de qué bodega se trae el material.** Al
escogerla, el formato enseña las **solicitudes de traspaso que Almacén ya aprobó
y están esperando en esa bodega**, con cuántos productos y unidades trae cada
una y a qué bodega van. Desde ahí se abre el traspaso para subir la foto de la
carga y avisar que el material ya va en la unidad. No se duplica nada: el
traspaso sigue siendo un documento de Almacén, y el formato solo lo pone a la
mano de quien sale. Quien no tenga ese permiso no ve el panel.

Luego se captura:

- **Unidad**, de la lista de Logística. El kilometraje que se capture queda en su
  ficha.
- **Operador** — quien maneja. Es quien firma al salir.
- **Teléfono corporativo**, de una lista desplegable que dice equipo, número y
  compañía. Así queda dicho qué equipo se llevó quién.

La lista se edita en **Configuración → Unidades → Teléfonos corporativos**, y de
cada aparato se guarda: **alias**, **marca**, **modelo**, **número**,
**telefonía** (con qué compañía), **cuenta padre** (de qué cuenta cuelga la
línea), **IMEI o serie**, **notas**, la **imagen del equipo** y los **datos
extra** que haga falta. La telefonía y la cuenta padre se sugieren con las que
ya se escribieron, para no acabar con «Telcel», «TELCEL» y «telcel». Uno que ya
salió en un formato no se borra, se retira.

**El alias es como se le dice al equipo en el almacén** —«Reparto 1», «El de la
camioneta»—. Cuatro Samsung A15 no se distinguen entre sí; por su alias, sí. Por
eso **al escoger teléfono en el formato se lee el alias y el número**:
*Reparto 1 · 55 1111 2222*. Los que todavía no tienen alias siguen saliendo con
su marca, modelo y número, para que nada deje de servir mientras se les pone.
Dos equipos no pueden llamarse igual: sería volver al problema.

**Los datos extra** son lo que no cabe en las columnas que hay: número de
inventario, plan contratado, cuándo se renueva, con qué funda salió. Se agregan
por teléfono con **+ Dato** —cómo se llama el dato y qué dice— y se ven como
etiquetas en su renglón. Los nombres ya usados se ofrecen al capturar el
siguiente, para que «Plan» no acabe siendo también «plan» y «Plan contratado».
No hay que cambiarle la forma a la tabla cada vez que haga falta guardar algo
nuevo. (Lo pidió Ronaldo el 6-nov-2026.)
- **Número** de envío, orden, custodia, encargo o colecta (la etiqueta cambia
  sola). No se repite el mismo número el mismo día.
- **CEDIS o almacén destino**, en los envíos a CEDIS y en las custodias: se
  escoge el **número de envío de la ODT** y con él se llena solo. O **destino
  programado**, escrito a mano, en los demás.
- En un **traspaso**, de qué bodega se trae el material.

**Qué se entrega y en qué orden no se pregunta aquí:** eso es la *ruta de
entrega*, y **no se planea desde el formato**. Quien llena el formato está en el
patio revisando la unidad, no planeando el recorrido. La ruta se arma en
**Logística → Ruta para entrega**, y ahí mismo se dice **qué salida de unidad la
lleva**. El formato solo la enseña —las paradas y cómo van— cuando ya le tocó
una. Así una misma salida puede llevar varias órdenes de venta directa, una cita
del CEDIS y una pasada por paquetería.

### Qué se inspecciona

**Inspección de la unidad**, once puntos de *Bien / Problema* —y un problema
exige describirlo y fotografiarlo—: carrocería y pintura · cristales y espejos ·
luces · llantas y refacción · herramientas, gato, birlo y llaves de llantas ·
birlo cargado · niveles de líquidos y anticongelante · tarjeta de circulación a
bordo · duplicado de llaves · pantalla del celular · cargador y cable.

**Registro de salida:** kilometraje (con foto del tablero) · hora · **nivel de
combustible** (¼, ½, ¾ o lleno, como la aguja) · **fondo de caja chica** (monto
con foto) · evidencia fotográfica de los puntos críticos · observaciones o daños.

**Cierre al regresar:** lo mismo del otro lado —kilometraje, hora, nivel de
combustible, evidencia y nuevos percances—, para poder comparar cómo salió y cómo
volvió.

**No sale a medias:** si falta contestar algo, la plataforma no deja mandarlo a
autorizar, lo dice por su nombre —*«Falta el nivel del tanque en…»*— y lleva a la
pregunta que falta.

### Quién firma y quién autoriza

El formato recoge las dos firmas del papel: la de **Planeación Logística** (el
operador que sale) y la de **Tránsito** (quien autoriza).

**Sin firma no se manda a autorizar.** Quien lo llenó firma primero: lo que se
autoriza es lo que alguien declaró haber revisado, y eso tiene nombre y firma.

**Dónde se firma:** hasta abajo del formato, en el panel **«Firma del
operador»** —se firma con el dedo, en la misma pantalla, antes de tocar
«Enviar a autorización»—. Mientras falte, el panel lo dice con una etiqueta
ámbar: *Falta para mandarlo a autorizar*. (Antes el recuadro aparecía solo al
concluir el viaje: el envío pedía una firma que la pantalla no enseñaba.
Corregido el 26-oct-2026, a petición de Ronaldo.)

**Autorizar la salida va por persona, no por puesto** (lo pidió Ronaldo el
26-oct-2026). Ya no viene con ser Team Leader: se otorga en *Configuración →
Permisos → Tránsito → «Autorizar la salida»*, persona por persona. Para que
nadie se quedara sin poder trabajar de un día para otro, **quien lo tenía por su
puesto lo conserva a su nombre**; de ahí se quita o se da a quien corresponda.

Al regresar, el cierre se manda a aprobación y lo aprueba un Team Leader. Quien
llenó no se autoriza ni se aprueba a sí mismo.

### Editar sus preguntas

En *Configuración → Checklists* se editan como las de cualquier otro, y cada área
dice a qué aplica: a un tipo en particular o a **«Todas las salidas de unidad»**,
que es como está puesta la inspección. Así una pregunta nueva se escribe una vez
y vale para los cuatro.

### Qué se revisa en cada uno

| | Envío | Colecta |
|---|---|---|
| **Primera etapa** | Chequeo de citas (10 puntos) · Hojas de autorización de ingreso | Proveedor de transporte · Hora de arribo · Unidad adecuada para la carga · Placas · Nombre del chofer · Identificación del chofer (foto) · Hoja de autorización de colecta |
| **Se autoriza** | La salida | La carga |
| **Al final** | Hojas de recepción de entrega | Evidencia de carga recolectada |

Cada checklist muestra **solo lo suyo**: un envío no ve las preguntas de la colecta
y al revés. **Todo va obligatorio**: lo que se manda a revisar va completo —puntos
contestados, textos y hora capturados, documentos cargados—. Un «No» pide explicar
qué pasó, como en Checklists.

> **La sección «Ventas x fuera» se retiró de Tránsito.** Sus nueve ítems siguen
> transcritos y desactivados en la base: son la base del módulo **Ventas por
> fuera** cuando toque construirlo.

### El camino: dos revisiones

```
Tránsito llena la primera etapa ──► Enviar a autorización de salida / carga
                                            │
                     Team Leader o Administrador revisa (Notificaciones)
                          │                                  │
              Autorizar salida / carga            Regresar para corregir (con nota)
                          │                                  │
          Aviso a Tránsito: «Autorizado,          Aviso a Tránsito: se corrige
          falta completar el cierre»              y se vuelve a enviar
                          │
Tránsito carga la hoja de recepción o la evidencia, firma ──► Enviar a aprobación de cierre
                                            │
                     Team Leader o Administrador revisa (Notificaciones)
                          │                                  │
                   Aprobar cierre                 Regresar para corregir (se quita
                          │                        la firma: hay que volver a firmar)
                  Pasa a Reportes
```

- **Mientras espera una revisión, nadie lo modifica.** El Team Leader tiene que
  estar viendo exactamente lo que le mandaron; se corrige cuando lo regresa.
- **Autorizada la salida o la carga, la primera etapa queda congelada.** Es como
  estaba al salir o al cargar, y reescribirla sería falsearla.
- **Quien lo llenó no autoriza ni aprueba lo suyo.** Si un Team Leader llena uno, lo
  revisa otro Team Leader o el Administrador.
- **El Administrador puede todo:** autoriza o aprueba aunque no se lo hayan enviado
  (botones *Autorizar … directo* y *Aprobar cierre directo*) y aunque lo haya llenado él.
- **Solo lo aprobado entra a Reportes.** Lo que sigue en proceso está en la portada
  de Tránsito y en Notificaciones.

No son avisos en pantalla: el servidor lo verifica en cada llamada.

### Avisos en Notificaciones

| Aviso | A quién | Cuándo |
|---|---|---|
| **Salida de unidad esperando tu autorización** | Quien tenga *Autorizar la salida o la carga* (no a quien lo llenó) | Se envió a autorización. Dice todo lo que va a hacer el viaje, con qué unidad y quién la lleva, y **abre el formato de un toque** |
| **Cierre esperando tu aprobación** | Quien tenga *Aprobar el cierre* (no a quien lo llenó) | Se envió a aprobación de cierre |
| **Autorizado: falta completar el cierre** | **Todo Tránsito** (entrar y capturar en Tránsito) | Se autorizó la salida o la carga; dice qué documento falta |
| **Envío o colecta regresado para corregir** | **Todo Tránsito** | Un Team Leader lo regresó; muestra su nota |
| **Traspaso esperando que lo carguen** | Quien tenga *Avisar que un traspaso va cargado* | Almacén aprobó el traspaso |
| **Traspaso en camino por confirmar** | Quien tenga *Confirmar la llegada de un traspaso* | Tránsito lo cargó; rojo si lleva más de un día |

Los de autorización, cierre y autorizado se ponen en rojo si son de un día anterior.
Cada aviso desaparece solo en cuanto se atiende, y tocarlo abre el envío, la
colecta o el traspaso.

**El traspaso se abre aunque no se entre a Almacén.** Quien tiene uno de sus pasos
—aprobar, cargar o confirmar— abre el documento desde Tránsito o desde el aviso. En
esa pantalla cada botón pide su propio permiso: **Aprobar el traspaso**, **El
material ya va cargado** y **Llegó: confirmar** usan los tres permisos del traspaso;
**Regresar un paso** sigue pidiendo *Autorizar ajustes, devoluciones y salidas
fuera de la ODT*.

### Configuración → Tránsito

- **CEDIS.** Agregar, renombrar, y quitar o volver a poner en la lista. Nada se
  aplica hasta **Guardar cambios**, y se guarda todo o nada. **Quitar de la lista no
  borra**: lo ya capturado conserva su CEDIS. **Renombrar** cambia lo que se capture
  de ahí en adelante. No se permiten dos con el mismo nombre ni dejar la lista vacía.
  Junto a cada uno se ve cuántos envíos y colectas lo usan.
- **Editar preguntas de Tránsito** abre el editor, igual que el de las unidades:
  redacción, tipos, orden, preguntas y áreas nuevas, retiros. Cada área dice
  **Aplica a: Envío, Colecta o Todos**.
- Permiso: **Editar la lista de CEDIS de Tránsito** (solo Administrador).

### Permisos → Tránsito

| Permiso | Qué deja hacer |
|---|---|
| Entrar a Tránsito | Ver el módulo y recibir los avisos de Tránsito (con el de capturar) |
| Capturar envíos y colectas, y enviarlos a autorización | Llenar y mandar a revisar (compartido con Checklists) |
| Firmar como quien los llena | La firma antes de enviar a cierre (compartido con Checklists) |
| **Autorizar la salida de un envío o la carga de una colecta (o regresarlo)** | La primera revisión |
| **Aprobar el cierre de un envío o colecta (o regresarlo)** | La segunda revisión |
| Avisar que un traspaso va cargado | El paso de Tránsito en un traspaso |
| Consultar el reporte de Tránsito | Reportes → Tránsito |

Los dos permisos de revisión antes eran la *firma de supervisión* compartida con
Checklists; quien la tenía los conserva, y de ahí en adelante se reparten por
separado.

### Los documentos

Se aceptan **fotos y PDF**, varios archivos por renglón (normalmente una hoja por
entrega). El botón de documentos abre el selector de archivos para poder elegir un
PDF ya escaneado. Se guardan a mayor resolución que las fotos de evidencia (2200 px
contra 1600), para poder leer firmas y letra a mano. Cada documento dice cuándo se
carga —*Antes de salir / Antes de cargar* o *Al regresar / Después de cargar*— y se
marca **Pendiente** en rojo hasta que se carga.

### El reporte de Tránsito

**Reportes → Tránsito**, por rango de fechas (por omisión el mes en curso; atajos
*Hoy*, *Esta semana*, *Este mes* y *Mes pasado*). Solo entra lo que tiene el **cierre
aprobado**:

- **Cifras:** concluidos, envíos, colectas, promedio en ruta, veces que se
  regresaron a corregir y traspasos cargados.
- **Envíos y colectas:** número, tipo, fecha, CEDIS, quién llenó, quién autorizó y
  cuándo, quién aprobó el cierre, **tiempo en ruta** (de la salida o carga autorizada
  a que se envió a cierre), hojas cargadas y correcciones. En las colectas, además,
  **proveedor, placas, chofer y hora de arribo** (y un aviso si la unidad no era
  adecuada). **Ver** abre el checklist completo con documentos, firmas y el historial
  de revisiones.
- **Por CEDIS** y **por día**, separando envíos y colectas.
- **Traspasos que movió Tránsito:** los cargados en el periodo, quién los cargó, su
  foto, si ya se confirmaron y cuánto tardaron en camino.

Los datos del transporte se leen por una clave interna de cada pregunta, así que
siguen saliendo en el reporte aunque el Administrador cambie su redacción.

Permiso: **Reportes de Tránsito**. Quien solo tiene ese abre el detalle de un envío
o colecta, pero no el de otros checklists.


## El checklist no se cierra a medias

Lo pidió Ronaldo el **1-oct-2026**, y corrigió algo que estaba mal: antes, una
pregunta sin contestar **pasaba de largo** en todos los checklists menos los de
Tránsito. Un checklist podía cerrarse y aprobarse con la mitad sin revisar, y el
reporte lo contaba como bueno.

Ahora, al cerrar:

- **Si falta algo, no cierra.** Se señalan en rojo todas las preguntas que
  faltan, se dice cuántas son, y el botón **«Ir a la primera»** lleva a ella —y
  luego a la siguiente, y a la siguiente—.
- **Contestar una quita su marca**, así se ve avanzar.
- Vale para todo: preguntas sin contestar, el problema sin describir, la foto de
  evidencia, el monto del dinero, la fecha de un vencimiento obligatorio y la
  lectura del kilometraje.

---

## El kilometraje en el checklist

El checklist de unidad, de carro utilitario, de carro de arrendamiento y de moto
pide el **kilometraje al momento de la revisión**, con la **foto del odómetro**.
Es el mismo trato que el dinero de la unidad: un número que hay que poder
comprobar.

Al cerrar el checklist, ese kilometraje pasa a la ficha de la unidad en
Logística. De ahí salen el rendimiento de la gasolina y el aviso del próximo
servicio.

En *Configuración → Checklists* el tipo de respuesta se llama **«Lectura con
foto (kilometraje)»**, y se le puede poner a cualquier pregunta —por ejemplo al
horómetro de un montacargas—.

---

## Vigencias (afiliación ANTRA)

En **Inspección de Unidad → 6. Documentación y extras** hay un ítem distinto a los
demás: *«¿Unidad se encuentra afiliada a ANTRA todavía?»*. En vez de Bien/Problema
se captura **la fecha en que vence la afiliación**, y la plataforma calcula sola
cuánto le queda:

| Lo capturado | Lo que muestra |
|---|---|
| Fecha futura lejana | *Le quedan 110 días* (verde) |
| Dentro de 30 días o menos | *Le quedan 9 días* (ámbar) |
| Hoy | *Vence hoy* (rojo) |
| Fecha pasada | *Vencida hace 58 días* (rojo) |

El cálculo aparece **en cuanto se captura la fecha**, sin esperar a ningún
reporte, y el renglón se pinta según la urgencia. El pie de pantalla suma las
vigencias vencidas junto a los problemas.

### El reporte

En **Reportes** hay un panel **Vigencias** con la última fecha capturada de cada
unidad, ordenado por urgencia: primero lo vencido, luego lo próximo a vencer, y
al final lo que está holgado. También aparecen las unidades **sin capturar**,
que son justo las que hay que perseguir.

> **La vigencia vencida no impide cerrar el checklist.** Se marca en rojo y sale
> en el reporte, pero no bloquea: renovar una afiliación no depende de quien está
> haciendo la inspección. Si prefieres que sí bloquee, es un cambio pequeño.

Agregar otra vigencia —verificación, seguro, permisos— se hace desde el editor de
preguntas con el tipo *Fecha de vencimiento*; aparece sola en el mismo reporte.

## Evidencia fotográfica

Al marcar un ítem como **Problema** aparece el botón **📷 Agregar foto**. En la
tablet se abre la hoja del iPad con las tres: **Fototeca**, **Tomar foto** y
**Elegir archivo**. Antes solo abría la cámara, y no había manera de subir una
foto que ya estaba en el carrete —la que se tomó hace rato en otra parte de la
bodega, o la que mandó alguien más—. (Lo pidió Ronaldo el 26-oct-2026.)

### En la bodega el wifi se cae

Y cuando se cae, **nada se pierde**:

- **Una foto que no se pudo subir se queda a la vista**, marcada con ⏳ y
  *«N por subir»*. Se reintenta sola, cada vez más espaciado, y en cuanto vuelve
  la señal entra. También hay un **Reintentar ahora**. Mientras tanto se ve: no
  desaparece de la pantalla.
- **Una miniatura que no se pudo bajar no es una foto borrada.** La foto está
  guardada en el servidor; lo que falló fue traerla. Se reintenta sola y, si aun
  así no llega, se queda marcada **↻ tocar para verla**. Antes se quedaba en
  blanco y parecía que al subir una se habían borrado las demás.
- **La foto que se acaba de tomar ya no se vuelve a bajar:** se guarda en la
  tablet con el nombre que le dio el servidor. En la bodega eso es la diferencia
  entre verla y no verla.
- **Las consultas se reintentan solas.** Una pantalla que se queda a medias por
  un bache de wifi se vuelve a pedir, hasta dos veces. Lo que *escribe* —guardar,
  firmar, autorizar— nunca se repite solo: podría aplicarse dos veces.

**Dónde es obligatoria.** Solo en **Inspección de Unidad** y **Montacargas**, y solo
sobre ítems marcados como Problema. Ahí el checklist no se puede cerrar sin foto, y
el mensaje dice exactamente qué ítems la deben.

En **Tránsito** la foto es opcional. Ahí un "No" significa
*actividad pendiente*, no *desperfecto* — pedir una foto de un horario que aún no se
publica solo estorbaría. De todos modos se pueden adjuntar fotos si sirven.

Además, todos los checklists aceptan fotos en **Observaciones adicionales**, para
evidencia que no corresponde a un ítem en particular.

**Cómo cambiar qué checklist exige foto.** En **Configuración → Checklists**,
columna *Exige foto*. Un toque.

**Peso y almacenamiento.** Las fotos se reducen a 1600 px en la tablet *antes* de
subirse: una foto de cámara de 4 MB llega como ~150-400 KB. La subida es rápida
aun con wifi flojo. Los archivos van en `datos/fotos/`, no dentro de la base —
si estuvieran dentro, OneDrive resincronizaría la base completa con cada foto.

Calculando grueso: 3 unidades × 1 revisión semanal × 2 fotos ≈ **60 MB al año**.

Se pueden quitar fotos mientras el checklist siga abierto. Una vez cerrado, las
fotos quedan fijas junto con las firmas.

## Calidad: lo que entra, lo que se re-ingresa y lo que se da de baja

Viene del archivo `MUESTREO_GUIADO.xlsx`. Cubre la inspección de los rollos de
etiqueta que bajan del camión del proveedor.

**La unidad de captura es la remisión, no el renglón.** Llega un camión con la
remisión 4821 de Creaflex y trae tres modelos: se abre **una** recepción con esos
tres lotes adentro y una sola firma. En papel la remisión se volvía a escribir en
cada renglón.

### Cómo se llena

**1. Nueva recepción.** Se elige proveedor, se escribe el número de remisión y la
fecha de llegada. La fecha viene puesta con la de hoy.

> No deja capturar dos veces la misma remisión del mismo proveedor. En papel eso
> pasaba cuando alguien retomaba una hoja a medias.

**2. Se agrega un lote por cada modelo** que traía el camión, con su color de fondo.

**3. Se anota cuánto llegó** — cajas × rollos por caja, o el total de rollos si ya
se sabe. La tablet contesta sola **cuántos revisar**.

**4. Debajo aparece la especificación** de ese modelo: color de impresión, marca de
término, tipo de centro, GAP, etiquetas por rollo y las medidas de referencia. No se
escribe: se compara contra el producto que se tiene en la mano. Es la columna gris
del Excel.

**5. Se anota lo que se revisa** — diámetro medido y medida del centro — y el
**veredicto: Aprobado o Rechazado**.

**6. Se firma y se cierra.**

### Cuántos revisar

`raíz cuadrada del lote, redondeada hacia arriba`. Un lote de 500 rollos pide 23; uno
de 100 pide 10; uno de 2000 pide 45. Es la misma regla que traía el Excel.

**La diferencia es quién la calcula.** En el Excel era una fórmula en una celda, y una
fórmula se puede sobrescribir con un número escrito a mano sin que nadie se entere.
Aquí la cuenta la hace el servidor y queda congelada al cerrar la recepción.

### Cuando un lote sale rechazado

**No cierra sin observación escrita y sin foto del defecto.** Es el mismo criterio
que ya usan los checklists de unidades: un rechazo sin motivo ni evidencia no le
sirve a nadie tres semanas después, cuando haya que reclamarle al proveedor.

**Y necesita la firma de autorización de un Team Leader.** El recuadro para
levantarla aparece en cuanto se marca el primer Rechazado.

> Si todos los lotes salieron aprobados, esa segunda firma **no** se pide. Un camión
> que llegó bien no tiene por qué esperar a que haya un Team Leader disponible; uno
> con material defectuoso sí, porque ahí empieza una reclamación. Si prefieres
> exigirla siempre, es quitar la condición `hayRechazo(recepcion) &&` en la ruta de
> cierre, en `server.js`.

### La última aprobación es del Administrador

Nada de Calidad queda cerrado de verdad hasta que el Administrador lo aprueba. Todo
lo que lo espera vive en un solo lugar: **Calidad → Aprobaciones**.

**Una recepción cerrada no está terminada.** Cerrarla es trabajo de almacén y quiere
decir *«terminé de capturar»*; queda marcada como **Sin visto bueno** hasta que el
Administrador entra y la da por buena. No frena a nadie: el equipo puede seguir
capturando las que lleguen.

**Un lote rechazado pasa por tres momentos:**

| Momento | Qué falta | Quién |
|---|---|---|
| **Por proponer** | Nadie ha dicho qué se hace con el material | Un Team Leader |
| **Por aprobar** | Ya hay propuesta, falta la última palabra | El Administrador |
| **Cerrado** | Aprobado, con los dos nombres registrados | — |

**El Team Leader propone**, porque es quien está cerca del material y del proveedor.
Elige entre cuatro salidas y puede dejar una nota:

- Devuelto al proveedor
- Aceptado con concesión
- Reclamo / nota de crédito
- Reproceso o selección

**El Administrador aprueba, y al aprobar puede cambiar la salida.** Si el Team Leader
propuso *aceptado con concesión* y el Administrador prefiere *devuelto al proveedor*,
aprueba eso: lo suyo es lo que queda. La propuesta original **no se borra** — el lote
muestra las dos cosas y avisa que se aprobó algo distinto, para que se vea de dónde
vino el cambio de criterio.

También puede **devolver la propuesta** en vez de aprobarla, escribiendo por qué. El
lote vuelve a quedar esperando que alguien proponga otra cosa.

> **Quien propone no aprueba.** El Administrador no tiene el permiso de proponer, a
> propósito: si tuviera los dos podría proponer y aprobarse a sí mismo, y la cadena
> de dos personas dejaría de existir sin que se notara. La plataforma además lo
> rechaza en el servidor, por si algún día alguien reparte los permisos de otra forma.

### Reabrir lo ya cerrado

El Administrador puede deshacer cualquier cosa cerrada. Es lo que hace que la última
palabra sea de verdad suya y no solo un visto bueno de trámite:

- **Reabrir una recepción** la devuelve a captura para corregir un dato mal escrito.
  Antes, en papel, eso significaba hacer otra hoja del mismo camión.
- **Reabrir un lote cerrado** deshace su aprobación y lo deja otra vez esperando
  decisión, con la propuesta original intacta.

**Siempre pide un motivo escrito, y queda registrado** con el nombre y la fecha. Sin
eso, cerrar una recepción no significaría nada: cualquiera podría deshacerlo en
silencio. El historial de reaperturas se muestra en la propia recepción.

> Reabrir una recepción **no deshace** las decisiones ya aprobadas de sus lotes. Esas
> se tomaron entre dos personas y no se caen de rebote al corregir una fecha; si hay
> que deshacer una, se reabre ese lote en particular.

### El catálogo, en Configuración

La hoja MATERIALES del Excel es ahora **Configuración → Materiales**: los 28 modelos
con su especificación, los 6 proveedores y los 11 colores de fondo. Se corrige un
dato y se guarda al salir del campo.

**El modelo no se renombra**, a propósito: los muestreos ya capturados apuntan a ese
renglón y cambiarle el nombre reescribiría su historia. Para retirar un modelo se
desmarca *En uso* — deja de ofrecerse en la tablet y los muestreos viejos lo siguen
mostrando. Lo mismo con los proveedores y los colores.

> En el Excel esta hoja estaba protegida con contraseña de administrador, porque
> tocarla rompía las fórmulas de la hoja de muestreo. Aquí no hay fórmulas que
> romper.

### El re-ingreso de un retiro

Cuando el material de un retiro llega a la bodega, **Calidad levanta su re-ingreso**.
Es lo que hace entrar ese material al inventario, y por eso lo cuenta Calidad y no
quien lo bajó del camión.

1. Se escoge **a qué retiro pendiente de recibir** se le asigna lo que llegó. La
   pantalla dice cuánto falta de cada producto de ese retiro.
2. Se anota **cuántas cajas trae esta entrega**. Ese número es contra el que se
   coteja el detalle: si dice 6 cajas y se detallan 5, no deja enviarlo.
3. **Caja por caja:** la pantalla enseña una tarjeta por cada caja —*Caja 1*,
   *Caja 2*…— y en cada una se agregan **los productos que trae dentro y cuánto se
   verificó de cada uno**. Una caja puede traer uno o varios productos distintos:
   se siguen agregando a esa misma caja. Si llegó una caja más de las que se
   dijeron, **+ Llegó una caja más**.
4. Se **manda a aprobación**. Quien tenga el permiso lo aprueba y solo entonces el
   material entra al inventario. Quien lo recibió no lo aprueba.

- **Entra lo verificado, no lo que decía el retiro.** Si se pidieron 100 y se
  contaron 70 al abrir las cajas, entran 70.
- **Recibir de más o algo que no venía en el retiro no se bloquea** —pasa— pero hay
  que explicarlo en la caja: la plataforma lo pide antes de dejar enviarlo.
- Si se regresa a corregir un re-ingreso ya aprobado, lo que sumó sale del
  inventario hasta que se vuelva a aprobar.

### La salida de material por calidad

Material que **ya estaba guardado y se dañó** —se mojó, se golpeó, se le venció el
adhesivo— no se tira sin más. Calidad pide su salida:

1. **Primero, solo la bodega y la fecha.** Con eso se crea el documento.
2. Después se agregan los productos, y **en cada uno** se anota **cuánto sale, por
   qué sale y su foto**. No antes ni una sola vez para todo: no todos los rollos
   salen por lo mismo, y la foto de uno no sirve de evidencia del otro.
3. Sin el porqué y la foto de cada producto no se puede enviar. Dar de baja
   existencia no puede quedar en la palabra de una sola persona, que es la misma
   regla de un lote rechazado.
4. Quien tenga el permiso la **aprueba**, y ahí sale del inventario. En su aviso ve
   el motivo de cada producto: *Caja RM90 (3): se mojó · Caja RM88 (1): llegó
   golpeada*.

En Reportes va **aparte de las salidas de venta**, producto por producto con su
motivo y su foto: ese material no salió vendido, se perdió, y mezclarlo con lo que
se envió a los CEDIS escondería justo lo que hay que mirar.

### Quién entra a Calidad

| Puesto | Captura | Firma la autorización | Propone qué hacer | Aprueba y reabre | Reportes |
|---|:---:|:---:|:---:|:---:|:---:|
| Operador | — | — | — | — | — |
| **Team Leader** | **sí** | **sí** | **sí** | — | **sí** |
| **Administrador** | **sí** | **sí** | — | **sí** | **sí** |

**«Aprobación final» no se puede otorgar a nadie más.** No es una casilla que se
pueda marcar en la matriz de permisos: va atada al puesto de Administrador y la
plataforma rechaza cualquier intento de darla suelta. Otorgarla sería, justamente,
dejar de ser la última aprobación.

Los Team Leaders traen Calidad incluida porque alguien tiene que poder firmar la
autorización de un rechazo. **A un operador se le da desde Configuración → Permisos**:
se le marca *Calidad* y *Capturar muestreos* y con eso le aparece el módulo.

Los dos trabajos nuevos de Calidad tienen sus propios permisos, y quien solo tenga
uno de ellos entra a esa pantalla sin necesidad de todo Calidad:

| Permiso | Qué deja hacer | De dónde salió |
|---|---|---|
| *Re-ingresos de retiro: llenarlos* | Levantar la entrega que llegó, detallar sus cajas y enviarla a aprobación | Capturar muestreos |
| *Re-ingresos: aprobar* | Que ese material entre al inventario | Aprobar entradas, en Almacén |
| *Salidas por calidad: llenarlas* | Llenar la baja del material dañado —producto, motivo y foto— y enviarla a aprobación | Capturar muestreos |
| *Salidas por calidad: aprobar* | Que ese material salga del inventario | Aprobar salidas, en Almacén |

Las dos aprobaciones aparecen **también en Permisos → Almacén**, con la marca de
compartido: es un mismo interruptor visto desde los dos módulos que gobierna.

> Quien vea los **Reportes de Calidad** necesita clave, igual que con los de
> Checklists. Si vas a dar de alta a alguien de calidad que hoy no tiene clave,
> asígnale uno primero en la pestaña Personas.

### Reportes

Además del detalle lote por lote, saca el **índice de rechazo por proveedor** —
cuántos lotes le compraste, cuántos le rechazaste y qué porcentaje sale. Es la
pregunta que la hoja de papel no podía contestar sin volver a leer todo el archivero.

En el detalle, junto al diámetro que se midió aparece el de referencia del catálogo,
para ver de un vistazo qué tan lejos quedó.

**Se exporta a Excel** con el mismo botón de siempre. Eso sustituye al
*Ctrl + P → Guardar como PDF* del archivo viejo.

---

## Almacén: existencias, entradas, retiros, salidas y conteos

Sale del libro `GESTION_ALMACEN_INKO.xlsm`, que traía siete hojas calculándose
entre sí a fuerza de `SUMIF` sobre rangos fijos. Se transcribió completo —los 121
productos del catálogo, las 325 publicaciones de Mercado Libre y Amazon, las dos
bodegas y la existencia de arranque— y encima se le pusieron las reglas que en
Excel no se podían poner.

### La regla que sostiene todo el módulo

**La existencia de un producto en una bodega es la suma de sus movimientos, y
nada más.** No hay ninguna casilla de existencia que alguien pueda corregir a
mano. Para cambiar un número hay que registrar un movimiento, y todo movimiento
nace de un documento con folio, fecha y responsable.

De ahí salen las tres diferencias de fondo con el Excel:

- **Nadie escribe en el inventario.** La hoja INVENTARIO era una fórmula que
  cualquiera podía pisar con un número escrito encima; y sus rangos llegaban al
  renglón 2005, así que al movimiento 2000 habría empezado a perder capturas en
  silencio. Aquí se recalcula al momento de pedirlo y no tiene dónde romperse.
- **El descuadre deja rastro.** La carga semanal se pegaba encima del inventario
  y la diferencia desaparecía: no quedaba constancia de cuánto se había perdido
  ni por qué. Ahora un conteo produce un ajuste, con su explicación y su firma.
- **Cada movimiento sabe de dónde vino.** Se puede ir de una existencia rara al
  documento que la produjo, y de vuelta.

### La regla de las aprobaciones

**Ningún movimiento toca el inventario sin que otra persona con permiso lo
apruebe.** Todo documento sigue el mismo camino:

```
Capturar ──► Enviar a aprobación ──► Otra persona lo aprueba ──► mueve el inventario
                     │                        │
                     └──── Regresar para corregir (con nota) ◄───┘
```

- **Quien captura no aprueba lo suyo.** La plataforma lo impide. El Administrador sí
  puede: puede todo.
- **Mientras espera aprobación no se modifica.** Quien aprueba está viendo
  exactamente lo que le mandaron.
- **Pedir corrección**, con una nota, lo regresa a captura en cualquier momento
  después de enviarlo, **aunque ya se haya aplicado**. Si ya había movido el
  inventario, lo que movió se quita y vuelve a pasar por aprobación. La excepción:
  si quitarlo dejaría existencia negativa —porque ese material ya se usó—, no se
  permite y se corrige con un conteo.
- **Cada corrección queda registrada** —quién, cuándo, en qué etapa estaba y por
  qué— en el documento y en Reportes.
- A quien capturó le llega **«Documento regresado para corregir»** en
  Notificaciones.

### Las seis cosas que se hacen

| Documento | Qué es | Qué hace falta para que mueva el inventario |
|---|---|---|
| **Entrada** | Material que llega de un proveedor | Aprobación en Almacén **y** visto bueno de Calidad |
| **Retiro** | Lo que se pidió de Mercado Libre Full o Amazon FBA | Nada: el retiro no mueve inventario. Lo mueve su **re-ingreso**, que levanta Calidad al llegar el material |
| **Salida** | Envío de ventas por la ODT o por fuera de ella | Aprobación — siempre, aunque cuadre con la ODT |
| **Devolución** | Material que regresa por rechazo del CEDIS o del cliente | Motivo, foto y aprobación |
| **Conteo** | El conteo de una bodega, entera o por partidas | Aprobación del ajuste |
| **Baja por calidad** | Material que se dañó estando guardado | Motivo escrito, evidencia y aprobación. Se pide desde Calidad |

Los **traspasos** entre bodegas tienen su propia sección: no sacan material de la
empresa, lo cambian de lugar.

### La entrada: Almacén la aprueba, Calidad la revisa

1. Se captura y se **envía a aprobación**. Todavía no toca Calidad ni el inventario.
2. Otra persona con permiso la **aprueba**. En ese momento aparece en **Calidad como
   «pendiente de revisar»**, y a quien captura en Calidad le llega el aviso.
3. **Todo pasa por Calidad:**
   - Lo que tiene especificación (etiquetas, rollos) abre un **lote para muestreo**,
     como siempre.
   - Lo que no se muestrea (cajas, empaque, portarollos) aparece en **«Material sin
     muestreo»**: Calidad anota **cuánto llegó bien**. Si es menos de lo que decía
     la entrada, tiene que explicar qué pasó. **Solo lo que llegó bien suma.**
4. Calidad cierra la recepción y el Administrador da el **visto bueno**: la entrada
   suma sola al inventario. Lo rechazado no entra, salvo que se acepte con concesión.

**Si se regresa a corregir una entrada que ya estaba en Calidad o aplicada**, su
revisión de Calidad queda **anulada** —se conserva, pero ya no se trabaja ni se puede
reabrir— y al volver a aprobarse se abre una nueva.

### El retiro: se carga aquí, lo re-ingresa Calidad

Un retiro de plataforma dejó de ser una entrada más, y por eso **tiene su propio
apartado**: su camino no se parece en nada al de una entrada de proveedor.

```
Almacén carga lo que se pidió ──► Pendiente de recibir
                                        │
              Calidad levanta un re-ingreso por cada entrega que llega
                                        │
                     Otra persona lo aprueba ──► entra al inventario
                                        │
                       Cuando llegó todo, el retiro se cierra solo
```

- **Cargar el retiro no mueve nada.** Es el aviso de que viene material: qué se
  pidió, de qué plataforma y a qué bodega va a llegar. No necesita aprobación,
  porque no hay nada que aprobar todavía.
- **Un retiro llega por partes**, y casi siempre así llega. Cada entrega es un
  re-ingreso aparte, y el retiro va diciendo cuánto falta de cada producto.
- **Lo que entra es lo que Calidad verificó**, caja por caja, no lo que decía el
  retiro. Si se pidieron 100 y llegaron 70, entran 70 y el retiro sigue abierto.
- **Cuando ya llegó todo, el retiro se cierra solo.** Si algo ya no va a llegar,
  quien tenga el permiso lo cierra a mano y **escribe por qué**: queda registrado.
- Reabrir un retiro se puede mientras no haya un re-ingreso a medias. Si ya entró
  material, lo que se corrige es el re-ingreso, no el retiro.

A Calidad le llega **«Retiro pendiente de recibir»** en Notificaciones, y se pone
en rojo si lleva más de una semana esperando: o llegó y nadie lo registró, o la
plataforma no lo mandó.

### La salida: siempre con aprobación

**Hay dos tipos de salida, y no hay un tercero:** envío de ventas **por la ODT** de
la semana y envío de ventas **por fuera** de ella. Todo lo que sale, sale vendido.
El «otro motivo» que existía antes era el cajón donde terminaba lo que nadie quería
explicar, y ya no se puede escoger; lo capturado con él se conserva tal cual.

- **La venta directa sale de su orden de armado.** Al escoger *Envío de ventas
  por fuera* ya no se escribe a quién va: se escoge la orden de **Entregas x
  Fuera** de la que sale, y el cliente y los productos se toman de ella. Si lo que
  sale no coincide con lo que se vendió —un producto de menos, uno que no venía—,
  quien aprueba lo ve marcado y en la orden queda la diferencia.
- **El CEDIS se escoge de una lista, no se escribe.** Un envío por la ODT va a un
  CEDIS, y los CEDIS son los que el Administrador tiene en *Configuración →
  Tránsito*: la misma lista que usa Tránsito, porque hablan de los mismos lugares.
  Escribirlo a mano era como acabábamos con «Tepotzotlan», «Tepotzotlán» y
  «TEPOTZO» contando por separado. Lo mismo en una devolución de CEDIS.
- **Toda salida se aprueba**, vaya o no dentro de la ODT. Antes la que cuadraba con la
  ODT salía en el momento; ahora no hay excepción.
- **Lo que se sale de la ODT se le enseña a quien aprueba**, con la razón: *«se sacan
  400 y la ODT solo tiene 50 pendientes»*. En Notificaciones llega en rojo.
- **La existencia se revisa dos veces:** al enviarla y al aprobarla, porque entre una y
  otra pudo salir material de la misma bodega.
- **Lo ya surtido se descuenta** de lo que pide la ODT.
- Los **traspasos** entre bodegas tienen su propio camino (ver *Traspasos*).

### La ODT ya no se pega encima de la anterior

Se carga el código de publicación y cuántos pedidos trae; las unidades de material
las multiplica el servidor contra el catálogo de publicaciones. En el Excel era un
`INDEX/MATCH` que se rompía al insertar filas, y lo que no empataba se quedaba como
un «⚠ Código no encontrado» en una celda que nadie leía. Aquí los renglones que no
se pueden traducir a material **se reportan arriba de la pantalla**.

La evaluación —la hoja EVALUACION ODT— dice, producto por producto, si el material
alcanza en la bodega de producción, si hay que traerlo de la otra o si hay que
comprarlo. Cada ODT queda guardada con su semana, así que se puede ver qué se pidió
hace tres semanas y cuánto de eso se surtió.

### El conteo produce un ajuste, no un borrón

1. Alguien con permiso **manda a contar**: escoge la bodega y **qué partidas** —la
   bodega entera o un puñado de productos—. A todos los que pueden contar les
   llega **«Conteo por contar»**.
2. **Quien tenga el permiso de contar** lo llena —pueden ser varios; cada renglón
   guarda quién lo contó— y lo **envía a aprobación**.
3. **Otra persona aprueba el ajuste.** No puede aprobarlo quien lo envió ni quien
   contó alguno de sus renglones. Solo ahí se corrige el inventario.
4. Quien tenga el permiso puede **pedir reconteo**, con nota, aunque el ajuste ya se
   haya aprobado: el conteo se reabre, el ajuste sale del inventario, y **los
   productos que traían diferencia quedan marcados «Recontar»**. Le llega a quien
   cuenta como reconteo.

### Contar por partidas

Contar 121 productos se lleva un turno completo, y muchas veces lo que se quiere
revisar son diez. Al mandar a contar se escogen las partidas de una lista, con
buscador y filtro por tipo de material; sin escoger ninguna se cuenta la bodega
entera, como siempre.

- **Lo que no se escogió no aparece en la hoja.** Quien cuenta no tiene que
  adivinar si lo dejó pendiente o si no le tocaba.
- **Un producto no puede estar en dos conteos abiertos de la misma bodega.** En la
  lista aparece marcado «ya se está contando» y no se deja escoger: dos personas
  contando lo mismo producen dos ajustes que se pisan.
- **Se puede contar varias veces en la misma semana**, cada vez otras partidas. Antes
  había un solo conteo por bodega y semana.

### Cuando algo descuadra: cajas, piezas y foto

Un número de más o de menos no se acepta a secas. **Quien cuenta tiene que decir
cómo llegó a ese número:** cuántas cajas hay y de cuántas piezas cada una —*9 cajas
de 50 y 6 cajas de 43*—, y **la suma tiene que dar exactamente lo contado**. Si no
da, lo que hay es una estimación, no un conteo, y la plataforma no deja enviarlo.

- Se anota en la ventana que abre el botón **Detallar**, junto al renglón. La suma
  se ve al momento mientras se teclea.
- **Y una foto del material contado**, en ese mismo renglón. Una por producto
  descuadrado: es la evidencia de ese conteo en concreto.
- Todo esto sale en **Reportes → Almacén → Conteos y ajustes**, en *Cómo se contó lo
  que descuadró*: el detalle, si cuadra, la foto y la explicación, producto por
  producto. Los conteos anteriores a esta regla aparecen ahí sin detalle.
- Lo contado en 0 no pide detalle —no hay cajas que contar— pero sí la explicación
  de siempre.

Además:

- **El teórico se congela al enviar el conteo.** Sin eso, un movimiento capturado
  después movería la diferencia y nadie sabría contra qué número se contó. Al pedir
  reconteo se descongela.
- **Un descuadre grande exige explicación escrita.** Grande es más del 2% del teórico.
- **Un producto que cuadró no genera movimiento.** Solo se corrige lo que descuadró.

### Quién puede hacer qué

Cada documento tiene sus permisos, en **Configuración → Permisos → Almacén**:

| Documento | Capturar | Aprobar | Corregir |
|---|---|---|---|
| Entradas de proveedor | Capturar y enviar a aprobación | Aprobar (pasa a Calidad) o cancelar | Pedir corrección, aunque ya esté aplicada |
| Retiros | Cargar y dejar pendiente de recibir | Cerrar, reabrir o cancelar | — (se corrige el re-ingreso) |
| Re-ingresos de retiro | *Se piden desde Calidad* | Aprobar (suma al inventario) o cancelar | Regresar a Calidad, aunque ya esté aplicado |
| Salidas | Capturar y enviar a aprobación | Aprobar (mueve el inventario) o cancelar | Pedir corrección, aunque ya esté aplicada |
| Bajas por calidad | *Se piden desde Calidad* | Aprobar (mueve el inventario) | Regresar a Calidad |
| Devoluciones | Capturar y enviar a aprobación | Aprobar (mueve el inventario) o cancelar | Pedir corrección, aunque ya esté aplicada |
| Conteos | *Mandar a contar* y *Contar, llenar y enviar* | Aprobar el ajuste o cancelar | Pedir reconteo, aunque ya esté aprobado |
| Traspasos | Capturar uno a mano | Aprobar · Confirmar la llegada | Regresar un paso |

Antes eran dos permisos (*Capturar* y *Autorizar*). Quien capturaba conserva los de
capturar y contar; quien autorizaba conserva los de aprobar, corregir y reconteo. De
ahí en adelante se reparten uno por uno. La evidencia (fotos) la sube y la quita quien
tiene el permiso de capturar ese documento.

**Los permisos nuevos de esta ronda no le quitan nada a nadie:** *Cargar retiros*
salió de *Capturar entradas*, y *Cerrar retiros* y *Aprobar re-ingresos* salieron de
*Aprobar entradas*, que es donde vivía la aprobación que movía el inventario de un
retiro. Quien los tenía los conserva.

### Avisos en Notificaciones

| Aviso | A quién |
|---|---|
| Entrada / Salida / Devolución esperando tu aprobación | Quien tenga el permiso de aprobarla (no a quien la capturó) |
| Re-ingreso de retiro esperando tu aprobación | Quien tenga el permiso de aprobar re-ingresos (no a quien lo recibió) |
| Salida por calidad esperando tu aprobación | Quien tenga el permiso de aprobarlas (no a quien la pidió) |
| Ajuste de conteo esperando tu aprobación | Quien tenga el permiso de aprobar (no a quien contó o envió, salvo que tenga el de aprobar sus propios conteos) |
| Conteo por contar (y reconteo) | Quien tenga el permiso de contar |
| Documento regresado para corregir | Quien tenga el permiso de capturar ese documento |
| Traspaso esperando tu aprobación | Quien tenga el permiso de aprobar traspasos |
| **Calidad:** Entrada pendiente de revisar | Quien captura en Calidad |
| **Calidad:** Retiro pendiente de recibir | Quien pide re-ingresos |

La devolución trae **el motivo del rechazo en el propio aviso**, y al abrirla
aparece arriba, destacado, en **«Por qué lo devolvieron»**: quien aprueba decide con
eso a la vista. Antes el motivo solo se veía mientras la devolución seguía en
captura.

### El reporte de Almacén

**Reportes → Almacén**, por rango de fechas y **agrupado por día, semana o mes** (por
día, máximo dos meses). Atajos: *Últimas 4 semanas*, *Este mes*, *Últimos 3 meses*,
*Este año*. Una pestaña por pregunta:

- **Resumen:** unidades de entradas, retiros, salidas, devoluciones y traspasos;
  ajustes que subieron y bajaron; correcciones; exactitud de los conteos; promedio
  para cerrar un retiro y promedio esperando a la plataforma; re-ingresos y cajas
  recibidas; unidades dadas de baja por calidad; cuántos descuadres traen su
  detalle de cajas; y los movimientos periodo por periodo.
- **Material que sale:** cuántas piezas salen de cada material en cada periodo, de más
  a menos, con filtro por tipo y búsqueda, y **en qué se cuenta cada uno** —rollos,
  cajas o piezas—.
- **Cajas de empaque:** todas las cajas del catálogo, cuántas salen por periodo,
  cuántas entraron y cuántas hay hoy.
- **Entradas, salidas y devoluciones:** cada documento con su estado, unidades, quién
  capturó, quién aprobó y cuántas correcciones tuvo. Las salidas fuera de la ODT van
  marcadas.
- **Retiros y re-ingresos:** cuánto tarda en cerrarse un retiro por plataforma —en
  días, que es como tardan— y en qué tramo se detiene: esperando a la plataforma o
  esperando la aprobación del re-ingreso. Cuánto se pidió contra cuánto llegó de
  verdad. Y cada re-ingreso con sus cajas, sus unidades y quién lo aprobó.
- **Bajas por calidad:** el material que se dio de baja por daño, con el motivo que
  escribió Calidad y si quedó la evidencia. Va aparte de las salidas de venta porque
  no salió vendido: se perdió.
- **Conteos y ajustes:** exactitud, unidades de descuadre y reconteos de cada conteo;
  **cómo se contó lo que descuadró** —el detalle de cajas, si cuadra y si hay foto—;
  y cada ajuste de inventario con su explicación.
- **Correcciones:** cada vez que se regresó un documento o se pidió reconteo, con su
  nota y en qué etapa estaba.
- **Hay que reponer:** lo que está bajo su mínimo, con descarga del inventario en CSV.

Solo cuentan los movimientos ya aprobados; la carga inicial no cuenta como movimiento.

**Cada cosa se dice en su unidad.** Los tiempos de cierre salen en minutos, horas o
días según lo que duren —un retiro que tardó dos semanas no se entiende escrito en
20 160 minutos—, y las cantidades dicen si son rollos, cajas o piezas, que es como
se cuenta cada familia de producto en el almacén.

### Producción especial

Un rollo que se le pide al proveedor **con algo distinto** —el fondo de otro
color, una impresión, una medida que no es la de siempre— y que llega a almacén
como cualquier material: se da de alta y se mueve igual que todos.

Lo único que cambia es **dónde vive**. Mezclarlo con el catálogo de todos los
días ensucia el inventario, los conteos y la lista de reposición: son productos
que no se venden de diario y que a veces se hacen una sola vez. Por eso tienen
su **partida** propia.

Son el mismo producto con tres datos más:

| Dato | Para qué |
|---|---|
| **Producción especial** | lo saca del catálogo de siempre y lo manda a su partida |
| **Partida** | bajo qué nombre se agrupa: «80x70 GRACIAS», «Cliente X» |
| **Descripción del rollo** | qué tiene de especial: fondo, impresión, medida |

Sigue siendo lo que era —un Rollo Térmico, una Etiqueta— así que **Calidad lo
muestrea contra su mismo modelo** y el inventario lo cuenta en las mismas
unidades. Tiene entradas, salidas, traspasos, conteos y reportes como cualquier
otro producto; el día que llega del proveedor se le captura su entrada y queda
cargado en existencia.

**Dónde se administra:** *Configuración → Materiales → Producción especial*.
Ahí se da de alta (el SKU se genera solo), se le escribe su descripción, se
suben y bajan los renglones dentro de su partida, y se retira o se borra —borrar
solo si nunca se usó; lo que ya tiene movimientos se retira para no perder su
historia—.

**Para pasar uno que ya existía:** se abre con *Editar* y se marca «Es
producción especial», diciendo a qué partida va. No se pierde nada: es el mismo
producto, con sus mismos movimientos, agrupado en otro lado. Así se movieron los
cuatro **80x70 «GRACIAS»**, que estaban entre los rollos de todos los días.
Desmarcarlo lo regresa al catálogo.

**En el inventario** aparecen con su partida y su descripción debajo del nombre,
y el filtro de tipo trae *Toda la producción especial* y cada partida por
separado, para verlas solas o para no verlas.

### El consolidado de un producto

En **Inventario → Existencias**, tocar cualquier producto abre su consolidado. Es la
pantalla a la que se va cuando un número no cuadra, y contesta tres cosas:

- **Cuánto hay y dónde:** existencia por bodega, total, situación contra el mínimo, y
  con cuánto empezó el periodo.
- **Qué movimientos tuvo:** cada tipo —entrada, re-ingreso, salida, devolución,
  traspaso, ajuste por conteo, carga inicial— con cuántas veces y cuántas unidades.
  Un traspaso aparece con efecto cero: cambia de bodega, no cambia el total.
- **Renglón por renglón:** cada movimiento con su fecha, su cantidad, de qué bodega a
  cuál, quién lo hizo y **un botón al documento que lo produjo**. De la existencia
  rara al papel que la explica, y de vuelta.

El **periodo se escoge arriba**, con fechas o con los atajos de siempre, y queda en
la dirección: el enlace se puede compartir ya filtrado.

### Cargar la existencia inicial (Almacén → Existencia inicial)

Desde el 18-sep-2026 la existencia de arranque la carga el Administrador (o quien
tenga *Cargar la existencia inicial*) desde **Almacén → Existencia inicial**:

1. **Descargar plantilla**: un CSV que abre en Excel con todos los productos (SKU,
   producto, modelo, tipo) y **una columna por bodega** con lo que hay hoy. Se llena
   y se guarda. También sirve cualquier Excel propio con una columna *SKU*,
   *Producto* o *Modelo* y una columna por bodega (con su clave o su nombre).
2. **Subir el archivo** (.xlsx o .csv) y **revisar**: cuántos productos, cuántas
   unidades por bodega, los renglones que no están en el catálogo (no se cargan),
   cantidades que no son número y existencias negativas (se cargan tal cual).
3. **Aplicar**, con la fecha de la existencia. Nada toca el inventario hasta aquí.

Si ya había una carga inicial, aplicar **la reemplaza completa** —hay que marcar
la casilla para confirmarlo—: dos cargas iniciales duplicarían la existencia. Lo
que se haya capturado después (entradas, salidas…) se queda encima.

> **Ya no se resiembra sola.** Antes, si el inventario quedaba sin ningún
> movimiento (por ejemplo, al borrar la carga en Limpieza), la plataforma volvía
> a sembrar sola la existencia de Pulpos de julio al siguiente arranque. Ahora eso
> solo pasa en una instalación nueva.

### La existencia de arranque (historia)

El módulo arranca con la existencia del reporte de Pulpos **al 24 de julio de
2026**, que es la que traía la hoja CARGA SEMANAL: **662 026 unidades**, el mismo
total que daba el DASHBOARD del Excel. Se sembró como movimientos de ajuste con la
referencia `CARGA INICIAL` visible, no como un número escrito a mano, para que el
libro mayor cuadre desde el primer renglón.

**Lo primero que conviene hacer es un conteo de cada bodega.** Ese número tiene ya
más de un mes y trae cuatro productos en negativo que venían así del propio reporte
de Pulpos:

| Producto | Bodega | Existencia |
|---|---|---|
| Rollo Térmico 80x70 (Blanco) | San Luis | −17 204 |
| Etiqueta Circular 51mm (Lila) | San Luis | −50 |
| Etiqueta Térmica 51x25 (Plástica) | San Luis | −44 |
| Rollo Térmico 80x70 (Rosa) | San Luis | −7 |

Se cargaron tal cual, sin redondearlos a cero: es un dato del que hay que
enterarse. El primer conteo los corrige y deja constancia de cuánto se movió el
número.

Dos renglones de la carga no se pudieron sembrar porque no están en el catálogo
—`ENVÍO`, que no es un producto, y `Etiqueta Circular 51mm (Amarillo)`, que sí lo
es pero le falta el alta—. El Excel también los marcaba con «⚠ No está en catálogo».

### Una base de pruebas aparte

`INKO_DATOS` apunta a otra carpeta de datos. Sirve para levantar una copia del
sistema —para enseñarlo, para ensayar— sin tocar la operación de verdad:

```
set INKO_DATOS=C:\ruta\a\datos-de-prueba
node server.js
```

Sin esa variable todo sigue igual que siempre, en `datos/`.

---

---

## Producción: la ODT de la semana

La orden de trabajo vive aquí, no en Almacén. Es lo que producción va a armar;
Almacén solo surte contra ella y mueve los traspasos que de ella salen.

### El camino: se carga, se reparte, se publica

```
Quien la carga sube el Excel ──► Reparte cada partida por envío ──► La publica
                                                                        │
                    Toda producción la ve, nadie la cambia; cada quien anota lo que arma
                                                                        │
          Si a una partida no le alcanza: se pide una modificación ──► otra persona la aprueba
```

- **Mientras se prepara, solo la ve quien la carga.** Producción no ve números
  que todavía pueden cambiar.
- **Publicada, la ve todo producción y nadie la cambia.** Ni con otro Excel: ya
  hay gente armando contra ella. Si todavía nadie ha anotado nada, quien la carga
  la puede regresar a preparación.
- Lo único que la mueve es una **modificación aprobada**.

### El reparto por envío

El Excel trae las citas de entrega —día, CEDIS, folio— pero **no dice cuánto de
cada partida va en cada una**. Eso lo pone quien carga la ODT, en la pestaña
**Reparto**: una tabla por cuenta, un renglón por partida y una columna por cada
envío de esa cuenta. El total de cada renglón tiene que dar lo que pide la partida;
hasta que todas cuadran, no se puede publicar.

**Lo evidente se reparte solo:** si una cuenta tiene un solo envío en la semana,
todo lo de esa cuenta va ahí sin que nadie lo teclee.

Contra este reparto se mide el avance por envío y por día.

### Cada quien anota lo que arma

En **Partidas por envío** está la ODT completa, envío por envío, con lo que pide
cada partida, lo que ya se armó y lo que falta. Quien arma toca **Anoté armado** y
dice cuántas: queda **su nombre y la hora**. De ahí salen el avance y las métricas.

- No se puede anotar más de lo que falta de esa partida en ese envío.
- Lo que uno anotó por error se quita **el mismo día**, desde *Lo que anotaste hoy*.
  Después, solo quien aprueba modificaciones.

### Pedir una modificación

Si a una partida no le alcanza el material, desde su renglón se toca **Pedir
cambio**: cuánto debe quedar en cada envío y **por qué**. Va a aprobación:

- **Nunca por debajo de lo ya armado** en ese envío: eso ya existe.
- **Una a la vez por partida.** Mientras una espera, la partida lo dice.
- **Otra persona la aprueba**; quien la pidió no. Al aprobarse, la ODT cambia sola
  —el reparto y el total de la partida— y a quien la pidió le llega el aviso de
  que ya se resolvió. Si se rechaza, se dice por qué.

Todas quedan en la pestaña **Modificaciones**, con quién pidió, quién resolvió y
cómo.

### El avance

La pestaña **Avance** es para quien tenga el permiso de verlo:

| Vista | Qué dice |
|---|---|
| **La semana** | Cuánto se ha armado de todo lo que hay que armar |
| **Por día** | Lo que tiene que estar listo cada día —lo de los envíos con cita ese día— contra lo armado |
| **Por envío** | Cada envío con su avance: *Listo*, *En tiempo* o *Atrasado* si su día ya llegó y falta |
| **Por persona** | Cuánto armó cada quien y a qué horas |

Los envíos atrasados le llegan en Notificaciones a quien sigue el avance.

### Quién puede hacer qué en Producción

| Permiso | Qué deja hacer |
|---|---|
| *Entrar a Producción y ver la ODT publicada* | Ver la ODT completa, sin cambiarla |
| *Cargar la ODT, repartirla por envío y publicarla* | Subir el Excel, repartir y publicar |
| *Anotar lo que armé* | Registrar lo armado |
| *Pedir una modificación a una partida* | Pedir el cambio, con su porqué |
| *Aprobar o rechazar una modificación* | Resolver lo pedido |
| *Ver el avance* | La pestaña de avance y el aviso de envíos atrasados |
| *Pedir traspasos desde la ODT* | Lo que ya existía |

Quien capturaba en Producción conserva anotar, pedir cambios y ver el avance; quien
cargaba la ODT conserva aprobar modificaciones. De ahí en adelante se reparten
aparte.

### El reporte de Producción

**Reportes → Producción**, por rango de fechas:

- **Por persona:** piezas armadas, días trabajados, promedio por día, **piezas por
  hora** —aproximado: del primer al último registro de cada día— y lo de cada día.
- **Cada ODT:** piezas, armadas, avance y cuántas modificaciones tuvo.
- **Cumplimiento por envío:** cuándo quedó completo cada envío contra el día de su
  cita: *A tiempo*, *Tarde* o *Atrasado* si todavía no se completa.
- **Modificaciones:** cada una con su cambio, su porqué y quién la resolvió.

### Cargarla: el archivo de Excel

**Producción → ODT de la semana → Cargar la ODT desde Excel.** Se escoge el
archivo tal como llega (`.xlsx` o `.xlsm`) y de ahí sale todo. No se captura
nada a mano: pegar 102 renglones es exactamente donde se cuela un dígito de más.

**La semana no se pregunta.** Sale del periodo que trae el archivo — «Jueves 27
Agosto a Jueves 03 Septiembre 2026» es la semana 35 de 2026. Escribirla aparte
permitía cargar la ODT del 27 de agosto sobre la semana equivocada.

#### Qué lee del archivo

| Del archivo | Qué se hace con eso |
|---|---|
| El periodo, en letra | La semana ISO de la ODT |
| Las citas: «Viernes 28 Ago #73880087 CEDIS: DANHOS» | Fecha, folio de cita y CEDIS, como datos |
| El nombre de cada cuenta | De qué cuenta de Mercado Libre viene cada renglón |
| Código y Cantidad x Armar | Los renglones de la ODT |
| Unidades x Publicación y Total Rollos | Se usan para comprobar, no para confiar |

El archivo trae **dos bloques lado a lado**, uno por cuenta (INKO y TERMIKO). No
se leen columnas fijas: se busca dónde dice «Código» y de ahí se arma cada
bloque. Si la semana que viene trae tres cuentas, o alguien mueve una columna,
sigue leyéndose igual.

#### Lo que revisa antes de guardar

Dos revisiones distintas, y las dos se reportan:

- **El archivo cuadra consigo mismo.** Si un renglón dice 50 rollos pero
  `cantidad × unidades` da otra cosa, se dice cuál y cuánto. El Excel trae la
  multiplicación hecha; se comprueba en vez de confiar, porque de ahí sale
  material pedido de más o de menos.
- **El catálogo sabe traducir cada código.** Los que no, se nombran uno por uno.
  Esos renglones se guardan igual —la ODT los pidió— pero no entran en la
  evaluación de material hasta que se den de alta.

#### Si ya había ODT de esa semana

No la pisa en silencio: avisa y ofrece **reemplazarla**, que borra sus renglones,
sus citas y su reparto y pone los del archivo nuevo. **Una ODT ya publicada o cerrada
no se reemplaza**: se cambia con modificaciones aprobadas.

#### Las citas de entrega

Quedan como datos —día, fecha, CEDIS, folio y cuenta— ordenadas por fecha, que es
como se surten. Las que venían resaltadas en el archivo se marcan con ★.

> **Las cantidades por cita no vienen en el archivo.** Por eso quien carga la ODT
> las reparte en la plataforma antes de publicarla (ver *El reparto por envío*). La
> evaluación de material sigue siendo de la semana completa.

#### El lector de Excel

Está en `xlsx.js` y no usa dependencias: un `.xlsx` es un ZIP con XML adentro, y
`zlib` —que Node ya trae— alcanza para descomprimirlo. Son unas decenas de
renglones y evitan meterle a la plataforma su primera dependencia externa.

`odt-excel.js` es el que entiende el formato de la ODT de INKO; `xlsx.js` solo
sabe de hojas y celdas y sirve para cualquier otro Excel que haga falta leer
después.


### Cargarla

Las **unidades de material no se capturan**: las calcula la plataforma contra el
catálogo de publicaciones. «35 pedidos de PUCU24753» se vuelve «700 rollos» solo.
Si un código no está en el catálogo, se dice cuál y no se inventa nada.

### ¿Alcanza el material?

La evaluación compara lo que pide la ODT contra lo que hay **en la bodega de
armado**, que en INKO es San Luis (B1). Cada producto cae en una de tres:

| | |
|---|---|
| **Alcanza** | Hay suficiente en B1. No hay nada que hacer. |
| **Traspasar** | Falta en B1 pero sí hay en otra bodega. Se pide un traspaso. |
| **Comprar** | No alcanza sumando todas las bodegas. Hay que comprarlo. |

La columna **Desde** dice de qué bodega traerlo y cuánto. Se toma primero de la
que más tenga, para no dejar dos bodegas a medias cuando una sola alcanzaba.

**La bodega de armado es un dato del catálogo, no una pregunta.** Está marcada en
`almacen_bodegas.arma_odt` y hoy es B1. Preguntarla en cada ODT solo abría la
puerta a que un día se contestara mal y la evaluación saliera contra la bodega
equivocada. Si algún día se arma en otra, se cambia la bandera y toda la
evaluación se muda con ella.

### Pedir el traspaso

El botón **Pedir traspaso** convierte el faltante en documentos de verdad: uno por
bodega de origen, porque cada uno es un viaje distinto que se aplica por separado.

Nacen **en borrador**. Que la ODT diga que falta material no mueve nada por sí
solo — alguien de Almacén tiene que confirmar que el viaje se hizo. Pedirlo dos
veces no lo duplica: lo que ya está pedido en un traspaso vivo no se vuelve a
pedir.

---

## Ventas directas: las órdenes de armado y su cobro

> **Se llamaban «Entregas x Fuera»** (2-oct-2026). El nombre decía de dónde NO
> salían —por fuera de la ODT— en vez de lo que son: una venta directa a un
> cliente. Cambió el nombre en toda la plataforma y **los folios pasaron de
> `VXF-` a `VD-`**, también los ya emitidos, como lo pidió Ronaldo. Por dentro
> las tablas siguen llamándose `vxf_*`: renombrarlas no cambiaría nada para
> quien usa la plataforma y sí pondría en riesgo lo capturado.

### El cobro: pagada o por cobrar

Al levantar la orden se dice **cómo se cobra**:

- **Ya está pagada** — la orden termina cuando sale, como siempre.
- **Se cobra al entregar** — se captura **cuánto se le va a cobrar al cliente**,
  y la orden **no se cierra hasta que el dinero regresó y alguien lo confirmó**.

El camino de una venta por cobrar tiene dos pasos más, y son de dos personas
distintas:

| Paso | Quién | Qué hace |
|---|---|---|
| **Dinero cobrado** | Quien entrega | Al regresar anota **cuánto le dieron**, **cómo le pagaron** y sube la **foto del efectivo o del comprobante**. |
| **Cobro confirmado** | Un Team Leader | Revisa que el dinero llegó completo y lo confirma. Si no cuadra, lo **regresa con una nota** a quien entregó. |

Tres reglas que hacen que el dinero no se pierda en el camino:

- **Sin evidencia no se anota.** La foto del efectivo o del comprobante es
  obligatoria, igual que la de un lote rechazado en Calidad.
- **Si trae menos de lo que se iba a cobrar, hay que escribir por qué.** Es el
  renglón que alguien va a tener que explicar a fin de mes.
- **Quien entregó no confirma su propio dinero.** Es la misma regla de dos
  personas que ya rige las entradas, las salidas y los conteos.

Mientras falte alguno de los dos pasos, **cerrar la orden avisa qué falta** y no
la cierra. Los dos aparecen en Notificaciones: *«Venta por cobrar: falta anotar
el dinero»* para quien entrega, y *«Dinero cobrado esperando tu confirmación»*
para el encargado. El reporte de Ventas directas trae cuánto se puso a cobrar,
cuánto se cobró y cuántas órdenes siguen sin confirmar.

El permiso se llama **«Entregar y anotar el dinero cobrado»** y nace en quien ya
lleva material a la calle —quien carga los traspasos—. Se cambia persona por
persona en Configuración.

### Devolución de ventas directas

Antes, una devolución la capturaba Almacén y al aprobarla entraba al inventario.
Para lo que regresa de un cliente eso no basta: **nadie había visto en qué estado
volvió**. Desde el 2-oct-2026 vive en **Calidad → Devolución de ventas
directas**, y el camino es:

| Paso | Quién | Qué pasa |
|---|---|---|
| **1. Se levanta** | **Calidad** | Escoge de qué venta regresa, a qué bodega llegó y **escribe por qué lo regresan**. La plataforma propone los productos de esa venta. |
| **2. Se revisa** | **Calidad** | De cada producto: cuánto regresó y **cuánto de eso llegó bien**. Lo que no llegó bien necesita decir qué tiene. Con su foto. |
| **3. Se pide la entrada** | **Calidad** | El mismo botón que cierra la revisión la pide: quien revisó es quien sabe cuánto va a entrar. |
| **4. Se aprueba** | **Almacén** | Y aquí, y solo aquí, el inventario se mueve. |

**Al inventario entra solo lo que Calidad dio por bueno.** Lo dañado se queda
fuera —por eso pasó por Calidad— y el movimiento lo deja anotado: *«2 no entró»*.
Si Calidad no da nada por bueno, no hay entrada que pedir y lo dice.

Los dos lados avisan en Notificaciones: a Calidad *«Devolución de venta directa
por revisar»*, y a Almacén la devolución esperando aprobación, con cuántas
piezas buenas trae y quién la revisó.

Antes la orden de armado de una venta directa llegaba por fuera del sistema.
Ahora se levanta aquí mismo, desde el puesto **Ventas directas**, y cada paso le
llega en Notificaciones a quien le toca.

```
Quien vende la levanta ──► Almacén la arma ──► Quien vende carga la guía o la nota ──► El encargado la cierra
```

### Qué trae la orden

| Al levantarla | Al terminar de armar |
|---|---|
| Quién la solicita (queda solo, es quien entró) | Cuántas cajas se usaron |
| Fecha de la solicitud | El modelo de cada caja |
| Cliente al que se entrega | Lo que pesa cada caja |
| Si va **con guía de paquetería** o **con nota de remisión** | |
| Cada producto vendido y su cantidad | |

### Paso por paso

1. **Quien vende** levanta la orden, agrega lo vendido y la **manda a armar**. Le
   llega a quien arma: *Orden de venta directa por armar*.
2. **Quien arma** anota **una línea por caja**: modelo de caja (del catálogo de
   cajas) y peso. Sin cajas, o con una caja sin modelo o sin peso, no se da por
   armada. Al darla por armada, a quien la levantó le llega: *Tu orden ya está
   armada*, con cuántas cajas y cuánto pesan —lo que necesita para hacer la guía—.
3. **Quien vende** carga **la guía o la nota de remisión** a la misma orden —foto o
   PDF— y la **manda al encargado**. Sin el documento no avanza.
4. **El encargado** la revisa y la **cierra como terminada**. Si algo está mal, la
   **regresa un paso** con una nota, y le llega a quien lo tenía.

Quien vende solo ve **sus propias órdenes**. Quien arma y el encargado las ven
todas.

### La cartera de clientes

Al levantar una orden, el cliente **se escoge de la cartera**: se escriben unas
letras y aparece la lista. Si el que se escribe no está, abajo dice **«Cliente
nuevo: se agregará a la cartera»** y al guardar queda dado de alta —*por revisar*—.
No importan mayúsculas ni espacios de más: «suntory» es SUNTORY.

**Ventas directas → Cartera de clientes** (permiso *Cartera de clientes*, que
trae quien cierra las órdenes):

- **Cargar desde Excel:** el archivo de clientes que se exporta de la plataforma de
  ventas (columnas *Nombre*, *Apellido*, *Razón Social*…; se buscan por su
  encabezado). Nombre y apellido se juntan. **Solo agrega**: lo que ya estaba no
  se toca, así que se puede volver a cargar el archivo completo cuando crezca. Al
  terminar dice cuántos agregó, cuántos ya estaban y cuántos venían repetidos.
- **Uno a mano:** nombre y, si se tiene, razón social.
- **Por revisar:** los que quien vende dio de alta desde una orden. Le llegan en
  Notificaciones al encargado. **Está bien** los da por buenos; **Editar** corrige
  el nombre (y con él el de sus órdenes), la razón social, lo retira de la cartera,
  o lo **une con otro** que ya existía: sus órdenes pasan a ese y el repetido
  desaparece.
- Filtro *Por revisar · Activos · Retirados · Todos* y buscador.

La orden guarda el nombre y además a qué cliente apunta. En **Limpieza** aparecen
los clientes dados de alta desde una orden que ya no tienen ninguna (lo que se
capturó probando); la cartera cargada desde Excel o a mano no se borra ahí.

### Contra lo que salió de Almacén

La orden no mueve el inventario: lo mueve la **salida de venta directa** de
Almacén, que ahora **sale de su orden** (ver la sección de Almacén). En la orden se
ve lo que se vendió contra lo que ya salió aprobado, producto por producto, y si no
coincide se marca. Al encargado le llega en rojo la orden por cerrar cuando no
coincide.

### Quién puede hacer qué

| Permiso | Qué deja hacer | Quién lo trae |
|---|---|---|
| *Levantar órdenes de armado y cargarles la guía o nota de remisión* | Pasos 1 y 3 | El puesto Ventas directas y los Team Leaders |
| *Armar: anotar las cajas, su modelo y su peso* | Paso 2 | Quien cerraba entregas (Team Leaders) |
| *Cerrar una orden como terminada, o regresarla* | Paso 4 | Team Leaders |

### El reporte

**Reportes → Ventas directas**, por rango de fechas: cada orden con el tiempo de
cada paso —armar, hacer la guía, cerrar y de punta a punta—, sus cajas y su peso;
las cajas por modelo; las órdenes por cliente; y **las diferencias contra lo que
salió de Almacén**, incluidas las órdenes armadas que todavía no tienen salida.

> **Si quien vende trabaja fuera de la oficina**, la plataforma hoy solo se abre
> desde la red de la oficina. Para que entre desde afuera hay que darle a la
> plataforma una dirección en internet; eso es un cambio de seguridad de la
> computadora y se decide aparte.

---

## Logística: las unidades, su gasolina, sus papeles y su desempeño

Lo pidió Ronaldo el **1-oct-2026**. Hasta entonces una unidad era solo su
checklist del viernes: no había dónde anotar una carga de gasolina, ni dónde
guardar la tarjeta de circulación, ni manera de saber cuánto rinde o cuánto
cuesta cada kilómetro. **Logística es la unidad completa.**

> **Nace cerrado.** Al lanzar el módulo no se tocaron los puestos: hoy solo el
> Administrador entra. Los permisos ya existen en *Configuración → Permisos →
> Logística* y se reparten cuando se decida quién anota la gasolina y quién
> carga los papeles. Es la misma regla de Incidencias.

### Los tipos de unidad

Antes había dos (vehículo y montacargas). Ahora son seis, y cada uno trae **su
propio checklist** —a un patín no se le revisa el aceite y a una moto no se le
pregunta por la caja de herramientas de una camioneta—:

| Tipo | Su checklist | Kilometraje | Combustible |
|---|---|---|---|
| **Camioneta de reparto** | Inspección de Unidad | sí | sí |
| **Carro utilitario** | Inspección de Carro Utilitario | sí | sí |
| **Carro de arrendamiento** | Inspección de Carro de Arrendamiento | sí | sí |
| **Moto** | Inspección de Moto | sí | sí |
| **Montacargas** | Inspección de Montacargas | no | sí |
| **Patín hidráulico** | Inspección de Patín Hidráulico | no | no |

Los tipos se editan en **Configuración → Unidades**, abajo de la lista: se
pueden agregar (un remolque, por ejemplo) y se dice si llevan kilometraje y si
cargan combustible. De eso depende lo que la plataforma pregunta: a un patín no
le pide kilometraje porque no tiene odómetro.

**Las unidades se dan de alta en Configuración → Unidades**, cada una con su
tipo, su clave corta y su foto. En cuanto se agrega una, su checklist aparece
solo en la portada de Checklists.

El checklist de un tipo nuevo se arma en **Configuración → Checklists**, o se
pide y se transcribe como se hizo con los de papel.

### La portada es un índice

Al entrar a Logística **no se ve la flota entera**: se ven las cifras del módulo
—unidades en uso, papeles vencidos y por vencer, servicios que ya tocan, gasolina
del mes— y a dónde ir. Es la misma regla de Almacén: quien entra a anotar una
carga no viene a mirar doce fichas.

Las unidades están en **Logística → Unidades**, con **filtro por tipo** y
**búsqueda** por nombre o clave. Ahí sí se vienen a ver.

### La ficha de cada unidad

**Logística → Unidades → la unidad.** Arriba, lo que hay que saber de un vistazo:
kilometraje, rendimiento, papeles vencidos y si le toca servicio. Abajo, cuatro
pestañas:

| Pestaña | Qué tiene |
|---|---|
| **Papeles** | Tarjeta, póliza, verificación, ACME, ANTRA, fumigación: cuándo vence cada uno, cómo va y si el dato salió de su documento cargado o del checklist. Debajo, los archivos con su botón de *Ver*. |
| **Gasolina** | Cada carga con litros, costo, precio por litro, kilometraje, kilómetros recorridos, rendimiento y su ticket. |
| **Servicios** | Lo que se le ha hecho, con taller y costo, y el próximo servicio programado. |
| **Checklists** | Sus últimas inspecciones, con cuántos problemas trajo cada una y el enlace para abrirla. |

### Los checklists viven aquí, y solo aquí

**Checklists dejó de ser un módulo del menú** (2-oct-2026, decisión de Ronaldo:
*«no quiero que se vea en dos lados»*). Las inspecciones son de las unidades, y
las unidades viven en Logística. Verlas en dos lugares era tener dos puertas a lo
mismo, y tarde o temprano dos maneras de contar lo mismo.

**Logística → Checklists de las unidades**: las mismas tarjetas y la misma hoja
de siempre, agrupadas por tipo de unidad, con la cuenta de cuántas van sin
empezar y cuántas en proceso. Al cerrar una, el camino regresa aquí.

**A quien solo llena checklists no se le pidió nada nuevo.** Si tiene *Llenar
checklists* pero no entra a todo Logística, el módulo le aparece igual y le abre
**directo en sus checklists**: no ve la gasolina, ni los papeles de la flota, ni
el desempeño. Por eso mover el módulo no cambió el día de nadie ni hubo que
tocar los puestos.

Las direcciones viejas (`#/checklists`) siguen vivas y llevan aquí: hay tablets
con la pantalla abierta y avisos que apuntan ahí.

### La gasolina y el rendimiento

**Todo lo de gasolina vive en una sola pantalla:** *Logística → Cargas de
gasolina*. Ahí se anota una carga nueva y ahí están todas las que ya se
anotaron, con **filtro por unidad**. Antes el botón de anotar colgaba de la
portada y la lista estaba en otro lado: dos puertas a lo mismo.

La tabla dice de cada carga: fecha y folio, unidad, litros, lo pagado y el
precio por litro, kilometraje, rendimiento, **gasolinera y ubicación**, cómo se
pagó, quién la anotó y su **ticket**, que se abre desde ahí. Arriba, el total de
litros y lo gastado de lo que se esté viendo.

Al anotar una carga se captura: unidad, fecha, **kilometraje del tablero**,
litros, lo que se pagó, si **se llenó el tanque**, gasolinera, **ubicación**
—cuál de todas: «Pemex» hay en cada esquina, y rastrear un consumo raro necesita
saber en cuál se cargó—, cómo se pagó y la **foto del ticket** (se puede subir
después).

**El rendimiento no se captura: se calcula.** Son los kilómetros entre esta
carga y la anterior, divididos entre los litros de esta. De ahí salen también el
**costo por kilómetro** y el precio por litro.

Dos reglas que hacen que el número sirva:

- **Solo cuenta entre dos cargas de tanque lleno.** Con media carga no se sabe
  cuánto quedaba en el tanque, y el número no significaría nada. Por eso se
  pregunta; una carga parcial se guarda igual, marcada como *parcial*, y no
  entra en el promedio.
- **Un kilometraje menor al último conocido se detiene y pide confirmar.** Casi
  siempre es un dedazo, y ensucia el rendimiento de dos cargas a la vez.

**La carga exige el kilometraje** en las unidades que lo llevan: sin él no hay
rendimiento que calcular, y es el dato que más fácil se pierde.

### Los servicios

**También viven todos en una pantalla:** *Logística → Servicios y
mantenimientos*, con **filtro por unidad** —que es como se pregunta en el piso:
«¿a la ISUZU qué le toca?»— y partida en dos: **Programados** arriba, con su
botón de *Ya se hizo*, y **Lo que ya se hizo** abajo, con su factura. Arriba, lo
hecho, lo programado y lo gastado de lo que se esté viendo.

Un servicio se anota como **ya hecho** —con fecha, kilometraje, taller, costo,
qué se le hizo y su factura— o como **programado**, con la fecha o el
kilometraje en que toca. Un servicio programado se marca después como hecho sin
perder que estaba previsto.

**La plataforma avisa en Notificaciones** cuando al próximo servicio le faltan
**500 km o menos**, o **7 días o menos**. Los kilómetros que faltan se calculan
contra el último kilometraje conocido de la unidad, venga del checklist o de una
carga de gasolina.

### El kilometraje: una sola línea de tiempo

El kilometraje entra por tres puertas —el checklist al cerrarlo, una carga de
gasolina, un servicio— y las tres escriben en la misma lista. Así el
rendimiento, el próximo servicio y la ficha de la unidad hablan siempre del
mismo número, y no hay dos kilometrajes distintos según dónde se mire.

### Desempeño

**Logística → Desempeño** (permiso *Reportes de Logística*, también desde el
módulo de Reportes). Se escoge el periodo y se compara entre unidades:

- Cargas, litros, gasto de gasolina y precio por litro;
- kilómetros recorridos, **rendimiento** y **costo por kilómetro**;
- servicios del periodo y cuánto costaron;
- cómo andan sus papeles;
- y el gasto de gasolina mes por mes.

### Las listas que se escogen

En **Configuración → Unidades → Listas de Logística** se editan las gasolineras,
las formas de pago, los tipos de servicio, los talleres y los tipos de documento
de unidad. Son listas para que nadie las escriba a mano cada vez y acaben tres
maneras de nombrar la misma gasolinera.

---

## Bahía digital: los papeles de las unidades y del personal

Un solo lugar para los papeles, con su vencimiento y su archivo. Dos mitades:
**las unidades** (tarjeta de circulación, póliza, verificación, afiliaciones,
contrato de arrendamiento, factura) y **el personal** (INE, CURP, RFC,
comprobante de domicilio, acta, licencia de conducir, alta en el IMSS, contrato,
examen médico, cursos).

Son **los mismos papeles de las unidades** que ya se cargan en la ficha de
Logística: no hay dos copias ni dos lugares donde buscarlos. La Bahía los junta
todos para poder ver de un golpe qué falta y qué vence.

### Quién ve qué, y quién puede qué

Cada acción se otorga aparte: ver no es cargar, y cargar no es corregir.

| Permiso | Qué deja hacer |
|---|---|
| **Entrar** (`mod_bahia`) | ver y cargar **sus propios** papeles, y llenar **su propia ficha** |
| `bahia_unidades_ver` | ver los papeles de todas las unidades |
| `bahia_unidades_cargar` | cargarle un papel a una unidad |
| `bahia_unidades_editar` | corregir los datos de un papel de unidad (tipo, vencimiento, notas) |
| `bahia_personal_ver` | ver los papeles de todo el personal |
| `bahia_personal_cargar` | cargarle un papel a alguien |
| `bahia_personal_editar` | corregir un papel de alguien y **su ficha** |
| `bahia_emergencia` | ver la **ficha de emergencia de todos**, sin ver sus papeles |
| `bahia_retirar` | retirar un papel, dentro de lo que ya pueda ver |

El módulo **nace cerrado**: solo el Administrador, y de ahí se reparte. Los
papeles del personal son **datos personales** —el INE, el domicilio, el
contrato—, así que ese permiso **exige tener clave**, como los reportes. Quien
solo tiene «Entrar» ve una pantalla con sus papeles y nada más: ni los de los
demás, ni los de las unidades.

### La ficha de emergencia

Debajo de los papeles de cada persona hay una ficha con lo que alguien tiene que
poder leer en treinta segundos si pasa algo: **tipo de sangre**, alergias o
padecimientos, **a quién hablarle** (dos contactos con su parentesco y su
teléfono), **la clínica que le toca** y su número de seguridad social. Va en
campos y no dentro de un PDF porque en una urgencia nadie va a abrir un archivo a
buscarlos. Se guarda con **un solo botón**.

Cada quien llena la suya —es la mejor manera de que esté al día— y quien tenga
`bahia_personal_editar` puede llenar la de cualquiera. La ficha se marca **«le
falta lo básico»** mientras no tenga tipo de sangre y un contacto con teléfono:
una ficha a medias no se descubre el día que hace falta.

`bahia_emergencia` existe aparte por una razón: de poco sirve un tipo de sangre
que solo puede consultar quien también puede leer el contrato de la gente. Con
ese permiso un Team Leader ve las fichas de todos **sin ver un solo papel**. El
reporte trae la hoja completa, que es la que conviene tener impresa.

Quien ya cargaba papeles de unidades en Logística **conserva ese acceso** en la
Bahía: es el mismo papel.

### Lo que falta y lo que vence

De cada unidad y de cada persona la pantalla dice **qué papeles no tiene
cargados** —comparando contra la lista de tipos— y cuántos están **vencidos o por
vencer**. No es un regaño: no todos los papeles aplican a todos. Es lo que
alguien necesita para saber qué pedir.

El aviso llega en Notificaciones por dos caminos: a quien lleva el personal le
avisa de **cualquier** papel que se vence, y a cada quien le avisa de **el suyo**
—*«Tu licencia de conducir, le quedan 8 días»*—. Los papeles de las unidades ya
avisaban desde Logística y siguen igual.

### Retirar, no borrar

Un papel se **retira**: deja de aparecer, pero el archivo se queda. El papel que
estaba vigente el año pasado sigue siendo la prueba de que lo estaba, y eso es
justo lo que pide una auditoría. Borrarlo de verdad solo se puede desde
*Limpieza*, y ahí está **resguardado seis años** (ver *Resguardo de auditoría*).

### La lista de tipos

*Configuración → Unidades → Listas* tiene las dos listas: **Documentos de
unidad** y **Documentos del personal (Bahía digital)**. Cada empresa pide los
suyos; agregar uno es un renglón más, sin tocar código.

### El reporte

*Reportes → Bahía digital*: todos los papeles de las dos mitades en una tabla,
primero lo vencido, con filtros por **unidades o personal** y por **vencidos o
sin cargar**. Dice también quién cargó cada uno y cuándo.

---

## Ruta para entrega

Una salida no lleva una sola cosa a un solo lugar: la unidad va primero al
CEDIS, luego deja dos pedidos a clientes y de regreso pasa a paquetería. **Eso
es una ruta**, y es lo que faltaba: la plataforma sabía qué se arma y qué sale,
pero no en qué orden se iba a entregar ni qué día.

**Logística → Ruta para entrega.** Se escoge el día —hoy, mañana o el que sea—
y se arma el recorrido.

### De qué se arma

Abajo está **lo que ya está listo para subir a la ruta**:

- Las **órdenes de venta directa** ya armadas. Al subir una, la plataforma ya
  sabe si va a **paquetería** (lleva guía) o a **entrega directa al cliente**
  (lleva nota de remisión), y la parada se nombra sola: *«VD-2026-0003 ·
  Abarrotes La Violeta»*.
- Las **citas de la ODT** cercanas, con su CEDIS.
- Y lo que no sea ninguna de las dos se agrega **a mano**: a dónde va, con qué
  detalle (dirección, horario, con quién).

Una orden que ya está en una ruta **deja de ofrecerse**: no se puede subir dos
veces.

### Se arma antes

**Una orden se arma hoy y puede irse mañana o en tres días.** En la orden de
venta directa se pone **«Sale del almacén»**, y con esa fecha la orden aparece
sola entre lo que se puede subir a la ruta de ese día —ni antes, estorbando, ni
después, olvidada—. Una orden sin fecha se ofrece siempre, justamente para que
no se quede olvidada.

En Notificaciones aparece lo que **sale hoy y todavía no está en ninguna ruta**.

### El recorrido

Las paradas se **suben y se bajan** para dejarlas en el orden en que se van a
hacer. Cada una se marca **Entregada** o **No se entregó** —y si no se entregó,
hay que escribir por qué—. Queda anotado quién la marcó y cuándo.

**Una ruta no se cierra con paradas sin marcar.** Primero se dice qué pasó con
cada una.

### El trazo: A, B, C

Arriba de la tabla, la plataforma **dibuja el recorrido** conforme se arma: el
almacén y luego las paradas con la letra con la que se dicen en el patio —*«de la
B te sigues a la C»*—. Cada punto trae su color según qué es (CEDIS, cliente,
paquetería), su dirección, y cómo va: lo entregado se apaga, lo que no se
entregó se marca en rojo. **Se redibuja solo** cada vez que se sube, se mueve o
se marca una parada. En la tabla las paradas llevan la misma letra, para que lo
que se ve arriba y lo que se marca abajo sean lo mismo.

Ese trazo lo dibuja la plataforma con sus propios medios, así que **se ve igual
sin internet**, que es la regla de la casa.

### El mapa de verdad

El mapa con calles, tráfico y navegación de voz **no se copia a medias**: con
«Ver el recorrido en el mapa» se abre en la aplicación de mapas del teléfono, con
el **almacén como punto de partida** y las paradas como escalas en el orden
planeado. Cada parada tiene también su propio 📍 para abrirla sola.

Eso sí necesita internet en el teléfono —es el mapa de Google, no la
plataforma—. Sin internet el trazo, las direcciones y el orden siguen ahí; lo
único que no abre es el mapa. El enlace carga hasta **diez puntos**; con más
paradas la pantalla lo dice y las demás se abren una por una.

### Las direcciones se escriben una vez

| Dónde se escribe | Para qué sirve |
|---|---|
| **Ficha del cliente** (Ventas directas → Cartera) | La traen solas todas sus paradas, también las que ya estaban planeadas. |
| **CEDIS** (Configuración → Tránsito) | Igual, para cada envío o cita a ese CEDIS. |
| **La parada**, con el botón «Dirección» | Solo esa vez: *«hoy entrega en la otra sucursal»*. Se marca **solo hoy** y no toca la ficha. Vaciarla devuelve la de la ficha. |
| **Configuración → Logística** | La dirección del **almacén**: de dónde arranca el recorrido. |

Una parada sin dirección se ve así —*sin dirección*, en ámbar— y la pantalla dice
cuántas faltan. Nadie tiene que adivinar por qué el mapa salió corto.

### La ruta y la salida de la unidad

**La ruta se planea aquí, no dentro del formato.** Quien llena el Formato de
Asignación e Inspección Vehicular está en el patio revisando la unidad; planear
el recorrido es otro trabajo, y a veces se hace el día anterior.

En cada ruta hay dos listas desplegables: **Unidad** y **Salida de unidad**. La
segunda enseña los formatos de salida de ese día —con su número, su unidad y su
operador— y al escoger uno, esa salida lleva esa ruta.

Desde el formato se ve el recorrido completo —las paradas, con su letra y su
dirección, y cómo va cada una— **pero solo para leerlo**: ahí no se planea ni se
engancha nada. Si la salida todavía no tiene ruta, el panel no aparece.
(Lo pidió Ronaldo el 26-oct-2026.)

---

## Traspasos: material que cambia de bodega

En Almacén, con su propia puerta. Un traspaso **resta en la bodega de origen y
suma en la de destino**, en un solo renglón del libro mayor: el material cambia de
lugar, no de cantidad. El total del inventario no se mueve.

**Salió de Salidas a propósito.** Antes era un motivo más de la pantalla de
salidas, junto a «ODT» y «ventas directas». Pero una salida saca material de la
empresa y un traspaso no; se surte contra cosas distintas y casi siempre nace de
la ODT. Tenerlo en los dos lugares eran dos puertas para lo mismo.

### El camino de un traspaso

Un traspaso no se aplica de un botonazo. Entre que producción descubre que falta
material y que el inventario cambia, hay gente y hay un camión:

| Paso | Quién | Qué pasa |
|---|---|---|
| **Solicitado** | Producción, desde la ODT | Nace completo, con los productos y las cantidades que faltan en la bodega de armado. |
| **Aprobado** | Team Leader de Almacén | Revisa que haya material y da el sí. Pasa a Tránsito. |
| **Cargado** | Tránsito | Avisa que el material ya va en el camión, **con foto de la carga**. |
| **Confirmado** | Team Leader, al llegar | Confirma la recepción. **Hasta aquí** se mueve el inventario. |

Cada paso deja quién y cuándo. La pantalla del traspaso enseña el camino completo
siempre —lo andado y lo que falta— porque quien abre un traspaso normalmente lo
abre para saber por qué no ha llegado.

#### Quién pide no aprueba

Es la misma regla que Calidad aplica al cierre de un rechazo: una decisión con
consecuencia se reparte entre dos. Si Héctor pidió el traspaso, Héctor no puede
aprobarlo.

#### La foto no es un adorno

Sin foto, Tránsito no puede avisar que va cargado. Es lo único que queda de que el
material efectivamente subió al camión: sin ella, «cargado» es la palabra de una
sola persona sobre material que todavía no llega a ningún lado.

Es la única excepción de permisos del módulo: la foto de un traspaso la sube quien
tenga **Tránsito**, no quien capture movimientos de almacén, porque ese paso es
suyo. Aparece en **Tránsito**, en «Traspasos entre bodegas», junto a los envíos.

#### El inventario se mueve al final

Ni al aprobar ni al cargar. Solo cuando alguien firma que el material llegó.

> **La contra, dicha de frente:** mientras el traspaso va en camino, esas unidades
> se siguen viendo disponibles en la bodega de origen, y otra ODT podría contarlas.
> El documento lo avisa —«va en camino desde tal día»— pero la existencia no lo
> refleja. Se hizo así a propósito: aplicarlo al salir dejaría material sumado en
> una bodega donde todavía no hay nada, que es el error más caro de los dos.

#### Si algo sale mal en el camino

**Regresar un paso** devuelve el traspaso al escalón anterior, anotando por qué
—el motivo es obligatorio— y queda en las notas. Un traspaso ya confirmado no se
«desaplica»: eso movió inventario y se corrige con un conteo, no borrando el paso.

#### Un traspaso no surte la ODT

Mueve material entre bodegas; no lo entrega. Aunque el traspaso venga de una ODT y
quede amarrado a ella, **no cuenta como material ya surtido**: lo que la ODT espera
sigue pendiente hasta que salga de verdad.


---

## Incidencias: la hoja del personal

Es la hoja de papel que ya se usaba, tal cual: **los nombres de todos los
operadores y Team Leaders**, y al lado de cada quien la situación y la fecha en
que fue. Se pinta completa —también quien no tiene nada anotado— porque así es la
hoja, y porque un nombre limpio también es información.

El Administrador no sale en la hoja: a él no se le levanta una incidencia, él
las autoriza.

**No viene con ningún puesto.** Desde el 18-sep-2026 Incidencias no aparece en el
menú de nadie salvo el Administrador, hasta que él se la dé a alguien en
*Configuración → Permisos → Incidencias*. Son permisos aparte:

| Permiso | Qué deja hacer |
|---|---|
| *Entrar a Incidencias y ver las propias* | Que el módulo aparezca en su menú |
| *Levantar una incidencia a alguien* | Llenarla |
| *Ver la hoja completa del personal* | Ver las de todos, no solo las suyas |
| *Autorizar o rechazar* | Solo el Administrador |

### Quién hace qué

| Paso | Quién | Qué pasa |
|---|---|---|
| **Levantar** | Quien tenga «Levantar» | Queda *por autorizar*. Todavía no cuenta. |
| **Autorizar** | Solo el Administrador | A partir de aquí cuenta para el corte del mes. |
| **Levantar y que quede firme** | Administrador | Nace autorizada. No la modifica nadie, ni él mismo. |

Quien levanta **no puede autorizar**, ni la que él levantó ni ninguna otra. Es
el único permiso del módulo atado al puesto de Administrador, igual que la
aprobación final de Calidad.

### Lo que el papel no podía hacer

- **Queda quién anotó.** En la hoja solo quedaba la letra. Aquí se guarda quién
  levantó, quién autorizó y la fecha de cada cosa.
- **La autorización deja rastro.** Antes era una conversación aparte; ahora es un
  paso del documento, y sin ese paso la incidencia no cuenta.
- **Rechazar exige decir por qué.** Quien la levantó tiene que saber qué pasó con
  ella, y queda escrito.
- **Un Team Leader puede corregir la suya** mientras esté por autorizar — una
  fecha mal puesta, una redacción a medias—. Pero solo la suya, y solo antes de
  que se autorice. Una vez autorizada, el renglón queda como quedó.

### El corte del mes

**Solo cuentan las autorizadas.** Lo que espera autorización, lo rechazado y lo
retirado se ve en la pantalla pero no suma — porque es lo que va a afectar el
bono, y ahí no puede colarse algo que nadie aprobó.

El botón **Descargar el corte del mes** entrega un CSV con una línea por persona:
cuántas incidencias autorizadas trae y el detalle de cada una. Se abre en Excel
con los acentos derechos.

### Cada quien ve lo suyo

Quien tiene acceso pero no la hoja completa ve **solo las suyas**. Ver la hoja
completa es un permiso aparte. A quién darle cada cosa lo decide el Administrador
persona por persona o por puesto.

### Y llega a Notificaciones

Una incidencia esperando autorización aparece en la bandeja del Administrador,
con el nombre de a quién se le levantó y quién la anotó. Es el único paso que
depende de él, así que no se queda esperando a que alguien se acuerde.


## Notificaciones: lo que está esperando tu aprobación

Cuando Calidad necesita una aprobación del Administrador, aparece aquí. La
bandeja contesta una sola pregunta: **¿qué está detenido esperando una decisión
mía?**

### No es una bandeja de mensajes

No hay avisos que guardar ni que marcar como leídos. La pantalla pregunta al
momento por el estado real de la operación, así que:

- **Nunca queda un aviso de algo ya resuelto.** En cuanto apruebas la recepción,
  el renglón desaparece solo. No hay que acordarse de tacharlo.
- **Nunca falta el aviso de algo pendiente.** No depende de que alguien se
  acordara de mandarlo: si está esperando, se ve.

Una libreta de avisos aparte se desincroniza de la operación al segundo día. Esto
no puede, porque no guarda nada.

### Cada quien ve lo suyo

Cada tipo de pendiente declara **qué permiso hace falta para atenderlo**, y solo
lo ve quien lo tiene. Los dos pendientes de Calidad piden `calidad_aprobar`, que es
exclusivo del Administrador: un Team Leader que no apruebe nada más entra y ve la
bandeja vacía, porque nada está esperando por él.

**Cada grupo dice para quién es**, al pie: «le aparece a quien tenga *Aprobar
salidas*». Y los que son de una persona en concreto —lo que te regresaron a
corregir, no lo que cualquiera con el permiso puede atender— van marcados **«Solo
para ti»**.

Lo que hoy manda Calidad:

| Pendiente | Qué significa |
|---|---|
| **Recepción sin visto bueno** | Almacén terminó de capturarla y el muestreo ya está firmado. Falta la aprobación final. |
| **Rechazo esperando tu decisión** | Un Team Leader ya propuso qué hacer con el material rechazado. La última palabra es del Administrador, que puede cambiar la salida. |
| **Entrada pendiente de revisar** | Almacén aprobó una entrada: hay que muestrearla y cerrarla. |
| **Retiro pendiente de recibir** | Llegó —o va a llegar— material de un retiro: se le levanta su re-ingreso. |
| **Papel de una unidad vencido o por vencer** | La tarjeta, la póliza, la verificación, la afiliación o la fumigación de una unidad. Vencidas en rojo: con eso no debería salir a la calle. |
| **Servicio de una unidad que ya toca** | A un servicio programado le faltan 500 km o menos, o 7 días o menos. |

Lo que manda Tránsito —autorización de salida o carga, aprobación de cierre,
autorizado, regresado para corregir, y los dos de traspasos— está en la sección de
Tránsito, *Avisos en Notificaciones*. Lo de Almacén, en la suya.

Lo que trae un lote rechazado se marca en rojo: no es lo mismo dar el visto bueno
a un camión que llegó bien que a uno con material defectuoso, donde empieza una
reclamación.

### Ordenada por módulo y por tipo de tarea

Con quince cosas en la bandeja, una sola lista obliga a leerla entera para saber
qué toca. Así que se agrupa en dos niveles:

Arriba de todo, **dos pestañas: «Por atender» y «Atendidas»**, cada una con su
número. Debajo:

1. **Por módulo** —Almacén, Calidad, Tránsito, Checklists, Incidencias—, con los
   botones para quedarse en uno solo.
2. Dentro de cada módulo, cada grupo lleva **una palabra** de qué toca hacer:
   **Aprobar**, **Llenar** (o corregir), **Revisar** o **Vigilar**. Cada pendiente
   es un renglón: qué es, un detalle corto y desde cuándo espera; lo urgente
   lleva punto rojo.

No es lo mismo tener quince cosas por aprobar —media hora sentado— que quince por
capturar, que es un recorrido por el almacén.

### El camino de regreso a la bandeja

Atender un pendiente saca de Notificaciones: se resuelve en el módulo, no aquí. Dos
cosas evitan perder el hilo:

- **Mientras estés fuera atendiendo, la barra de arriba muestra «← Avisos (12)»**,
  con lo que quedaba pendiente. Un toque y vuelves a la lista para seguir con el
  siguiente. Desaparece al regresar.
- **La pestaña «Atendidas»**, arriba junto a «Por atender», muestra lo que tú
  resolviste en la última semana, mes o tres meses: lo que aprobaste, los
  documentos que regresaste a corregir, los retiros y recepciones que cerraste.
  Cada renglón abre el documento otra vez.

**Lo atendido se acomoda igual que lo pendiente:** por módulo, con la palabra en
pasado —*Aprobado*, *Hecho*, *Revisado*—.

Tampoco esto guarda nada: es la misma operación preguntada al revés, buscando tu
nombre en la columna de quien aprobó o cerró. Por eso no puede decir que atendiste
algo que no atendiste.

### Avisa desde el menú

La tarjeta de Notificaciones en la portada trae la cuenta —**«2 por aprobar»**, en
rojo— para no tener que entrar a mirar si hay algo. Es el único módulo del menú
que lleva contador, porque avisar es justo lo que hace.

### Avisa aquí, se resuelve allá

Tocar un pendiente lleva a **Calidad → Aprobaciones**, que es donde estaba y donde
sigue estando el botón de aprobar. Notificaciones no aprueba nada: si el mismo
botón viviera en dos pantallas habría dos puertas para la misma cosa, y esa es
justo la confusión que el sistema evita en todos lados.

### Agregar un pendiente de otro módulo

Es **un renglón** en la lista `PENDIENTES`, al inicio de la sección de
Notificaciones en `server.js`: de qué módulo es, qué permiso pide, cómo se llama,
dónde se resuelve y una consulta que devuelve lo que está esperando. La pantalla
no se toca, igual que agregar un módulo es un renglón en `MODULOS`.

Almacén manda aquí sus aprobaciones —entradas, salidas, devoluciones, re-ingresos,
bajas por calidad, ajustes de conteo y traspasos—, los conteos por contar y los
documentos regresados para corregir; Calidad, las entradas pendientes de revisar y
los retiros pendientes de recibir. El detalle está en la sección de Almacén,
*Avisos en Notificaciones*.

Cada renglón de `PENDIENTES` declara además **de qué tipo de tarea es** —aprobar,
capturar, revisar o vigilar—, que es lo que agrupa la bandeja, y si es **personal**
(de alguien en concreto y no de todo el que tenga el permiso). Lo ya atendido vive
en la lista `ATENDIDOS`, al lado, con la misma forma.

---

---

---

## Al construir algo, entra en los tres catálogos

Cada vez que el sistema aprende a hacer algo nuevo, ese algo se da de alta en
**tres lugares, en el mismo cambio que lo crea**. No después, no «cuando esté
listo»: en el mismo cambio.

| Catálogo | Dónde | Qué pasa si se olvida |
|---|---|---|
| `CATALOGO_PERMISOS` | `server.js` | El Administrador no puede repartir quién lo hace, y la acción termina otorgada de más «porque si no, no funciona» |
| `REPORTES` | `server.js` | El módulo produce información que nadie puede consultar; se queda encerrada en su pantalla |
| `TIPOS_LIMPIABLES` | `server.js` | Lo capturado al probar no se puede tirar, y la base se llena de basura de pruebas |

Los tres son listas: agregar algo es **un renglón**, no una pantalla. Esa es la
razón de que estén hechos así.

### Por qué los tres, siempre

Es lo que pidió Ronaldo, y la razón operativa es la misma en los tres casos:
**lo que no está en el catálogo, no existe para quien administra el sistema**.
Puede existir en el código y funcionar perfecto, pero él no lo puede repartir, ni
consultar, ni limpiar — y entonces el sistema deja de ser suyo.

### La lista de hoy

| Módulo | Permisos | Reporte | Limpieza |
|---|---|---|---|
| Checklists | ✓ | ✓ | ✓ llenados |
| Producción | ✓ | *por construir* | ✓ ODT |
| Calidad | ✓ | ✓ | ✓ recepciones |
| Tránsito | ✓ | ✓ | ✓ llenados y traspasos |
| Almacén | ✓ | ✓ | ✓ entradas, salidas, traspasos, devoluciones, conteos |
| Notificaciones | ✓ | no aplica: no produce datos propios | no aplica |
| Incidencias | ✓ | ✓ | ✓ incidencias |
| Envíos Ventas directas | ✓ | *por construir* | *por construir* |
| Configuración | ✓ | no aplica | — |


## Que no se sienta lenta

Tres cosas, todas del 26-oct-2026, porque en una tablet medio segundo sin señal
de vida se siente como que no funcionó —y la gente vuelve a tocar el botón—.

**La pantalla viaja comprimida.** El código de la aplicación pesa 700 KB y se
mandaba entero en cada carga. Ahora va comprimido (unos 170 KB) y con una
*huella*: si la tablet ya tiene esa misma versión, el servidor contesta «no
cambió» en unos bytes y el navegador usa la suya. Se conserva la obligación de
preguntar siempre, así que **ninguna tablet se queda con una versión vieja**; lo
que se ahorra es el envío, no la pregunta.

**Hay una cinta arriba** que se enciende mientras la plataforma habla con el
servidor. Es delgada, no tapa nada y no se puede tocar: solo dice que sí está
pasando algo.

**La pantalla ya no se va al principio.** Antes, al guardar, se vaciaba todo y
se ponía «Cargando…»: eso encoge la página, la manda arriba y cierra el teclado,
y en la tablet había que volver a bajar, volver a abrir el bloque y volver a
sacar el teclado para corregir el renglón de al lado. Ahora se queda lo que hay
—la cinta avisa—, y cuando el contenido nuevo está listo **se vuelve a donde se
estaba**. Si de verdad se cambió de pantalla, entonces sí se empieza desde
arriba. En Configuración, además, **los bloques que estaban abiertos siguen
abiertos**.

Y una clave equivocada ya no repinta la pantalla de acceso: solo cambia el
aviso, así que **el teclado no se cierra** y se puede volver a intentar en el
mismo lugar.

---

## Configuración: el resumen a la vista, el detalle a un toque

Cada pestaña pintaba de golpe todo lo que tenía: las dieciséis personas con sus
accesos, los veinte grupos de Limpieza con cada documento, la bitácora entera.
Para encontrar algo había que recorrer la pantalla, y lo que de verdad importa
—cuántos hay, qué está pendiente— quedaba enterrado.

Ahora **lo que se ve es el resumen y el detalle se pide**:

- Las **listas de más de seis renglones** nacen plegadas, detrás de un botón que
  dice cuántos hay: *«Ver la lista · 16 renglones»*.
- Los **formularios de alta** nacen plegados: *«+ Agregar una persona»*.
- Las **explicaciones largas** se guardan detrás de *«Cómo funciona esto»*. La
  primera línea, la que hace falta para no equivocarse, se queda afuera.
- Las **listas de catálogo** (gasolineras, talleres, tipos de documento) se ven
  como una fila de botones con su cuenta, y cada una se abre aparte.
- En **Limpieza**, los grupos sin nada que borrar no ocupan un panel cada uno:
  se nombran en un renglón al final.
- En **Personas**, la columna de accesos dice cuántos tiene cada quien y enseña
  solo los que se le dieron a esa persona en particular (★). Los que vienen con
  el puesto se ven completos en *Permisos*, que es donde se reparten.

Esto **no está escrito dentro de cada pestaña**: se aplica sobre lo que cada una
pinta. Una pestaña nueva nace igual de ordenada sin que nadie se acuerde de
hacerlo, y las que se repintan solas al guardar se vuelven a plegar.

---

## Los permisos son la lista de lo que el sistema sabe hacer

**Configuración → Permisos.** Cada acción que la plataforma puede ejecutar tiene
su renglón ahí, agrupada por módulo, y el Administrador decide persona por
persona quién puede hacer cada una.

### El Administrador puede TODO

No se le reparte permiso por permiso: los tiene por el cargo. Su renglón en la
matriz aparece completo y **sin casillas que tocar** —dejarlas apagadas diría que
no puede algo que sí puede, y encenderlas haría creer que se le puede quitar—.

Tampoco le aplica la regla de las dos personas: **puede aprobar y confirmar lo
que él mismo capturó o solicitó**. Es la última palabra del sistema; esperar a un
tercero para lo suyo dejaría documentos detenidos sin nadie por encima que los
destrabe. Para todos los demás la regla sigue en pie.

La ventaja de fondo: cada acción nueva que se agregue al sistema le queda
disponible desde el primer día, sin que nadie tenga que acordarse de otorgársela
—que era la manera más fácil de que él mismo se quedara fuera de su propio
sistema—.

### La regla al agregar algo nuevo

**Toda acción nueva entra en `CATALOGO_PERMISOS` en el mismo cambio que la
crea.** Un renglón con su clave, su etiqueta en palabras de la operación y el
módulo al que pertenece. Si no está ahí, el Administrador no puede repartirla, y
lo que no se puede repartir termina otorgado de más «porque si no, no funciona».

### Partir un permiso no le quita ni le da poder a nadie

Cuando una acción que vivía dentro de un permiso más grande pasa a tener el suyo,
quien podía hacerla tiene que seguir pudiendo. Si no, el sistema amanece con
gente que ayer aprobaba traspasos y hoy no, sin que nadie lo haya decidido.

Para eso está `PERMISOS_DERIVADOS` en `server.js`: cada permiso nuevo dice de
cuál salió, y hereda de él —tanto en el puesto como en los ajustes ya repartidos
a mano—. Si el Administrador le había **quitado** el padre a alguien, el hijo
nace quitado también: nadie recupera por la puerta de atrás algo que ya se le
había ido. A partir de ahí son independientes.

Lo que se partió hasta hoy:

| Acción nueva | Salió de | Módulo |
|---|---|---|
| Cargar la ODT desde el Excel | Capturar en Producción | Producción |
| Pedir traspasos desde la ODT | Capturar en Producción | Producción |
| Aprobar un traspaso solicitado | Autorizar en Almacén | Almacén |
| Confirmar la llegada de un traspaso | Autorizar en Almacén | Almacén |
| Avisar que un traspaso va cargado | Entrar a Tránsito | Tránsito |
| Borrar documentos de prueba | Entrar a Configuración | Configuración |

El caso de Tránsito era el más suelto: **avisar que un traspaso va cargado
bastaba con poder entrar al módulo**. Ahora es un permiso aparte, y quien no lo
tenga ni siquiera ve la lista de traspasos ahí.


## Modo de pruebas: probar como cualquier puesto sin tocar la operación

Está en **Configuración → Modo de pruebas** (permiso *Modo de pruebas*, solo del
Administrador).

**Al prenderlo** la plataforma saca una **copia completa de la base** en
`datos/pruebas/`. Desde ahí, **Entrar como…** deja escoger un puesto —entra como
la primera persona que lo ocupa— o a una persona en particular. Si el puesto no
tiene a nadie, se crea dentro de la copia una persona «Prueba · Puesto».

Mientras pruebas:

- **Ves exactamente lo que ve esa persona**: su menú, sus botones, sus avisos. Una
  **cinta ámbar arriba** lo recuerda todo el tiempo, con **Cambiar** (entrar como
  otro) y **Salir de la prueba**.
- **No hay reglas de día**: los checklists de viernes se abren cualquier día, y lo
  anotado como armado en Producción se puede quitar aunque no sea del día.
- **Nada cuenta.** Todo lo que captures cae en la copia: el inventario, los
  reportes y los avisos de la operación real no se enteran. Las fotos también
  van a la carpeta de la copia; borrar algo probando nunca borra una foto real.
- **La gente que trabaja de verdad no se entera**: su sesión sigue en la base
  real. La regla del viernes sigue igual para ellos.

**La copia es una foto del momento en que se sacó.** Lo que se capture de verdad
después no aparece en ella; **Actualizar la copia** saca una nueva (y tira lo que
se había probado).

**Al apagarlo se tira la copia completa**, con todo lo capturado. No hace falta
ir a Limpieza. Quien estuviera probando regresa solo a su sesión real, y su
pantalla se da cuenta sola.

Mientras siga prendido, al Administrador le sale en Notificaciones
(*Configuración · Vigilar*). Si la plataforma se reinicia con el modo prendido, la
copia sigue ahí y se pone al día sola con la versión nueva.

> **Cómo funciona por dentro.** `db` en el servidor no es una base sino un
> intermediario: cada petición de una sesión «en prueba» corre dentro de un
> contexto (`AsyncLocalStorage`) que apunta a la copia, y todo el sistema le habla
> a esa base sin saberlo. Ninguna regla ni pantalla necesita conocer el modo de
> pruebas; lo que administra el propio modo (`/api/pruebas`) va siempre sobre la
> real. Cada respuesta lleva la cabecera `X-Inko-Prueba`.
>
> **Una sentencia nunca se prepara al arrancar.** Un `db.prepare(...)` guardado en
> una constante de arriba del archivo queda atado a la base REAL para siempre: se
> preparó cuando todavía no había contexto. Pasó con los movimientos de inventario
> (23-sep-2026): probando se escribían —y al cancelar un documento, se borraban—
> en el libro mayor de verdad. Para eso está `sentencia(...)` en `db.js`: pregunta
> por su base cada vez que se usa. Toda sentencia que viva fuera de una función va
> con `sentencia(...)`, nunca con `db.prepare(...)`.

---

## Resguardo de auditoría: seis años

Todo lo que se **cierra** en la plataforma se guarda **seis años**. Son dos cosas
distintas, y conviene no confundirlas:

### El candado

Un documento cerrado —uno que movió inventario, un checklist cerrado, una
recepción aprobada, una venta terminada, una incidencia autorizada, un papel
cargado, la bitácora de accesos— **no se puede borrar desde Limpieza** hasta que
cumpla seis años. La pantalla no esconde el renglón: dice *«Resguardado para
auditorías hasta el 2032-09-18»*, para que se entienda que no es una falla.

Limpieza existe para tirar lo que se capturó probando; sin candado, un día de
limpieza se lleva la prueba de algo que hay que poder demostrar. **Lo que no está
cerrado sí se borra**: un borrador, algo cancelado, un documento a medias. Y en
una **copia de pruebas el candado no aplica**, porque ahí nada es real.

### Resguardar no es congelar

El candado impide **borrar**, nunca **corregir**. Un documento cerrado se puede
reabrir, arreglar y volver a cerrar; lo que no se puede es hacer como que nunca
existió. Cada camino de regreso ya existía o se agregó:

| Documento | Cómo se reabre | Quién |
|---|---|---|
| Entrada, retiro, salida, traspaso, devolución, conteo, re-ingreso | **Pedir corrección**: vuelve a captura y lo que había sumado sale del inventario | quien tenga el permiso de corregir de ese documento |
| Recepción de Calidad | **Reabrir**, con motivo | `calidad_aprobar` |
| Lote ya cerrado | **Reabrir** ese lote | `calidad_aprobar` |
| Checklist todavía por aprobar | **Pedir corrección**, con nota | `checklists_aprobar` |
| **Checklist ya aprobado** | **Reabrir para corregir**, con motivo | `reabrir_cerrados` |
| Venta directa en proceso | **Regresar un paso**, con nota | `ventas_fuera_autorizar` |
| **Venta directa terminada** | **Reabrir para corregir**, con motivo | `reabrir_cerrados` |
| ODT | Pedir modificación | `produccion_modificacion_pedir` |

Los dos renglones en negrita son los que faltaban: un checklist aprobado y una
venta terminada no tenían camino de vuelta. Ahora sí, con **el motivo
obligatorio**. Al reabrir un checklist se le quitan las firmas —firmaron otra
versión— y tiene que volver a firmarse y aprobarse.

`reabrir_cerrados` no viene con ningún puesto. El Administrador lo tiene siempre
y se le puede dar a quien haga falta.

**Lo reabierto sigue resguardado.** Un documento que estuvo cerrado alguna vez no
se puede borrar aunque ahora esté otra vez en captura; si no, reabrir sería la
puerta de atrás para tirar algo guardado: se reabre y se borra. La pantalla de
Resguardo lista **cada reapertura y cada corrección del año** con su motivo y
quién la hizo, y el paquete la lleva en `reaperturas-y-correcciones.csv`. Eso es
lo que convierte un cambio tardío en algo explicable en vez de sospechoso.

### El paquete: del año o de un periodo

*Configuración → Resguardo* (o *Reportes → Resguardo de auditoría*) muestra, año
por año, **qué hay guardado**, de qué tipo, y **hasta cuándo** hay que guardarlo.
De ahí se **arma el paquete**: una carpeta que se le entrega al auditor sin tener
que darle acceso al sistema.

**El paquete no tiene que ser de un año entero.** El selector *«Qué empacar»*
ofrece, de cada año:

| Periodo | Cómo se llama su carpeta |
|---|---|
| El año completo | `2026` |
| Un mes | `2026-03` (Marzo 2026) |
| Un bimestre | `2026-B2` (Marzo a Abril) |
| Un cuatrimestre | `2026-C1` (Enero a Abril) |
| Un semestre | `2026-S2` (Julio a Diciembre) |

Solo aparecen los periodos **que tienen algo que empacar**, cada uno con cuántos
documentos trae, y los que ya se armaron lo dicen. Cada paquete vive en su propia
carpeta, así que **pueden coexistir** el del año y el de cada mes sin pisarse —y
sin duplicar nada: son copias—. Volver a armar uno rehace su carpeta desde cero.

El `LEEME.txt` de cada carpeta dice de qué periodo es y con qué rango de fechas
exacto se armó.

El paquete trae:

| Archivo | Qué |
|---|---|
| un `.csv` por tipo de documento | la lista de todo lo cerrado de ese año |
| `reaperturas-y-correcciones.csv` | qué se reabrió o se regresó a corregir, cuándo, por qué y quién |
| `movimientos-de-inventario.csv` | cada movimiento: fecha, producto, cantidad, de qué bodega a cuál, de qué documento salió y quién lo capturó |
| `fotos/` y `fotos.csv` | la evidencia que se subió desde la tablet, y de qué documento es cada imagen |
| `LEEME.txt` | qué es, quién lo armó, cuándo y hasta cuándo hay que guardarlo |

Los `.csv` se abren en Excel en columnas de una vez. Las carpetas viven en
`datos/resguardos/`, una por periodo armado, y la pantalla dice la ruta exacta
para encontrarlas en el explorador. **Las fotos se copian, no se mueven:** el sistema sigue
necesitando las suyas.

El paquete es una **copia**: borrarlo no borra nada del sistema, y se puede volver
a armar cuando se quiera (volver a armarlo rehace la carpeta desde cero). Por eso
los paquetes armados aparecen en *Limpieza*, como lo único de ahí que se puede
tirar sin consecuencias.

**Notificaciones** avisa de los **años cerrados sin su paquete** —no urgente, pero
ahí está—. Y el paquete **se arma sobre la operación de verdad**: desde una copia
de pruebas se puede mirar, no armar.

---

## Limpieza: tirar lo que se capturó para probar

> **Una falla que dejó rastro** (2-oct-2026). Al limpiar un documento se borraba
> su foto del disco pero **no el renglón** que la nombraba. Como las fotos se
> guardan por tipo + número de documento, el siguiente documento que estrenaba
> ese número **heredaba las fotos del borrado**: salía una imagen rota y, peor,
> la plataforma daba por cumplida una evidencia que nadie había subido. Lo
> encontró una prueba de la devolución por Calidad. Ya se borra el renglón junto
> con el archivo, y al arrancar se limpian las que quedaron sueltas.

**Configuración → Limpieza**, solo del Administrador. Mientras el sistema está en
construcción hace falta poder borrar las pruebas para ver el efecto de cada cosa
nueva sobre datos limpios. No es una papelera de la operación: es una herramienta
de obra.

### Qué se borra y qué no

Se borran **documentos** — lo que alguien capturó:

| Módulo | Qué |
|---|---|
| Checklists y Tránsito | Checklists llenados, con respuestas, firmas y fotos |
| Calidad | Recepciones, con lotes, firmas y fotos · Re-ingresos de retiro · Salidas por calidad |
| Almacén | Entradas de proveedor · Retiros (con sus re-ingresos) · Salidas · Traspasos · Devoluciones · Conteos |
| Producción | ODT cargadas, con su reparto, lo anotado como armado y sus modificaciones |
| Ventas directas | Órdenes de armado, con sus cajas y sus guías o notas |
| Logística | Cargas de gasolina (con su ticket y su lectura de kilometraje) · Servicios y mantenimientos · Papeles de las unidades |
| Bahía digital | Papeles del personal, con su archivo |
| Configuración | Bitácora de accesos · Paquetes de resguardo armados |

**No se toca la configuración**: personas, permisos, unidades, plantillas de
checklist, materiales, productos, publicaciones ni bodegas. Eso no es una prueba,
es el sistema; se administra en su propia pestaña y no aparece aquí ni por error.

### El inventario se corrige solo

Borrar un documento borra también sus movimientos. Como la existencia es la suma
de los movimientos, el número vuelve por sí mismo a lo que era — no hay que
capturar ningún ajuste que compense, ni existe un «deshacer» que pueda quedar a
medias.

### Lo que no se borra a ciegas

Dos casos se detienen y dicen por qué, en vez de arrastrar cosas por delante:

- **Una recepción que abrió una entrada de almacén** no se borra sola: la entrada
  quedaría apuntando a un muestreo que ya no existe. Se borra la entrada, y la
  recepción se va con ella.
- **Una ODT con salidas o traspasos colgando** tampoco: esos documentos quedarían
  huérfanos. Primero se borran ellos.

El botón de borrar en bloque hace lo que puede y **reporta lo que quedó y por
qué**. Un «se borraron 8 de 10» sin explicación no le sirve a nadie.

### La carga inicial va aparte

El inventario de arranque que se trajo del Excel —151 movimientos, la existencia
de Pulpos al 24-jul-2026— se lista en un bloque marcado en rojo. **No es una
prueba**: es el punto de partida de todo lo demás, y borrarlo deja el inventario
en ceros. Se puede hacer, pero está separado para que no se toque de pasada.

### Confirmar en dos toques

Cada botón de borrar pide un segundo toque: cambia a **«¿Seguro? Toca otra vez»** y
se pone rojo, y si no se confirma en cinco segundos vuelve solo a su estado. Un
diálogo del navegador se acepta por reflejo; que el botón cambie obliga a leer qué
se va a borrar.

**Esto no se deshace.** Si quieres una red antes de una limpieza grande:

```
node respaldar.js
```


## Uso diario

**El equipo:** toca su nombre → elige el checklist → contesta → firma → *Cerrar y enviar*.

- Se guarda solo, respuesta por respuesta. Si la tablet se apaga a media captura,
  no se pierde nada: al volver a entrar continúa donde quedó.
- Un checklist cerrado ya no se puede editar. Se puede consultar desde Reportes.
- Un checklist por unidad por periodo: los semanales se reinician cada lunes, el de
  Tránsito cada día. El de Montacargas solo se habilita los viernes.

**El Team Leader:** módulo **Reportes → Checklists**.

- *Problemas detectados* — todo lo que salió mal, con quién lo reportó, cuándo y las
  **fotos de evidencia**. Toca una miniatura para verla completa.
- *Historial* — cada llenado, su estado y cuántos problemas trae. Botón "Ver" para
  abrir el checklist completo tal como se llenó, con firmas.
- *Descargar todo en Excel (CSV)* — se abre directo en Excel, con acentos correctos.

### Comparativa entre semanas

Módulo **Reportes → Comparativa entre semanas**. Se eligen las semanas a comparar
tocando sus etiquetas
(de 2 a 12; por omisión las 4 más recientes). Todo se recalcula al instante:

- **Resumen** — problemas, checklists cerrados y fotos, con la diferencia entre la
  primera y la última semana elegida. Verde es mejoría, rojo es deterioro.
- **Tendencia** — barras de problemas por semana, para ver de un vistazo si sube o baja.
- **Problemas por checklist y unidad** — qué unidad está dando lata y si va a mejor.
- **Problemas recurrentes** — *lo más útil de la pantalla*: ítems que volvieron a
  fallar en varias de las semanas comparadas. Si el extintor del ISUZU aparece 3×,
  no es mala suerte: nadie lo ha atendido.
- **Insumos · cierre de semana** — el cierre de cada material semana a semana, para
  ver el consumo real y anticipar pedidos.
- **Checklists semanales sin hacer** — los que nunca se abrieron esa semana.

Dos detalles de cómo lee los datos:

- Los checklists **diarios** (Tránsito) se agrupan en su semana ISO, para que se
  puedan comparar contra los semanales.
- Cuando falta el dato de una semana, la diferencia muestra un guion, no un cero.
  Un checklist que nadie llenó no es "cero problemas" y no debe verse como mejoría.

---

## Puntos de retorno del código

La carpeta `plataforma` es un repositorio Git. Cada vez que quieras dejar un
punto al que poder volver:

```bash
git add -A && git commit -m "describe aquí qué cambió"
```

Ver el historial, y volver a un punto anterior si algo se rompe:

```bash
git log --oneline
```

```bash
git checkout .
```

El último comando descarta los cambios no guardados y devuelve el código al
último punto. **No toca los datos** — la carpeta `datos` está fuera del
historial a propósito: un control de versiones es para el código, no para
información real del equipo con sus nombres y claves.

## Respaldos

Toda la información vive en la carpeta **`datos`**: las respuestas y firmas en
`checklists.db`, las fotos en `datos/fotos/`. Respalda la carpeta completa —
la base y las fotos van juntas o el reporte queda con evidencia rota.
Para restaurar, reemplázala (con la plataforma apagada).

Para dejar una copia fechada en `respaldos/`, con la plataforma encendida o
apagada (la copia sale consistente aunque alguien esté capturando):

```bash
node respaldar.js
```

La carpeta está dentro de OneDrive, así que ya se respalda sola — pero OneDrive
sincroniza el archivo completo cada vez que cambia. Si con el tiempo se hace lento,
mueve la carpeta `plataforma` fuera de OneDrive y programa una copia diaria de `datos`.

---

## Notas técnicas

- Node.js y nada más: sin `npm install`, sin `node_modules`, sin compilar. Usa el
  servidor HTTP y el SQLite que ya vienen dentro de Node.
- Base de datos SQLite en `datos/checklists.db`.
- Los checklists no están escritos en el código: viven en la base de datos
  (`plantillas` → `secciones` → `items`). `seed.js` solo hace la carga inicial y es
  idempotente — no duplica nada si se vuelve a correr.
- **Calidad tiene tablas propias** (`materiales`, `catalogo_calidad`, `recepciones`,
  `lotes`) en vez de reusar las de checklists. Un checklist es una lista de preguntas
  iguales para todos; un muestreo es un renglón de datos con aritmética propia.
  Forzarlo dentro de `items`/`respuestas` habría hecho ilegibles las dos cosas.
  Lo que sí comparte: usuarios, permisos, la carpeta de fotos y el lienzo de firma.
- **La seguridad actual asume red local.** Las claves se guardan en texto plano y las
  sesiones viven en memoria. Es adecuado para una tablet que no sale del almacén.
  Si algún día quieres que se use desde fuera (celular del operador en ruta), hay
  que ponerla en un servidor con HTTPS y cambiar las claves por contraseñas cifradas.
  Avísame y lo hago.

### Estructura

```
plataforma/
  Iniciar plataforma.bat   ← doble clic aquí
  server.js                ← servidor, API, MODULOS y PERMISOS
  db.js                    ← estructura de la base de datos
  fechas.js                ← semanas ISO (agrupar y comparar)
  seed.js                  ← los checklists y el catálogo de materiales, transcritos
  public/
    index.html             ← reposo, barra y contenedor
    app.js                 ← navegación y todas las pantallas
    marca.css              ← Brand Book: colores, tipografías, forma
    estilos.css            ← componentes de la interfaz
    marca/                 ← logotipo en sus dos versiones autorizadas
    fuentes/               ← aquí van los .woff2 corporativos
  datos/checklists.db      ← respuestas, firmas, muestreos y observaciones
  datos/fotos/             ← las fotos de evidencia (checklists y Calidad)
```

### Cómo se agrega un módulo nuevo

1. Un renglón en `MODULOS` (arriba de `server.js`) con su clave, nombre, ícono y
   el permiso que exige.
2. Si lleva pantalla propia, una entrada en `RUTAS` y su vista en `app.js`.
3. Si guarda información, sus tablas en `db.js`.

Mientras no esté listo, se deja `disponible: false` y aparece en el menú como
*Próximamente*, para que el equipo vea a dónde va el sistema.

# Sistema Digital INKO

Plataforma en tablet para la operación del almacén. Hoy incluye el módulo de
**Checklists**; está construida para ir sumando módulos (Inventario, Ventas por
fuera, Calidad, ODT) sin rehacer nada. No requiere instalar nada más que Node.js.

---

## Cómo se usa en la tablet

**1. Pantalla de reposo.** La tablet descansa mostrando el logotipo sobre Azul
INKO. Es el estado normal cuando nadie la está usando.

**2. Un toque** en cualquier parte la despierta y pregunta **¿quién eres?**

**3. Se elige la persona.** Quien tenga PIN lo captura en un **teclado en
pantalla** — más fiable que el del sistema cuando se trae guante puesto — o lo
escribe, si lleva letras. Quien no tenga PIN entra tocando su nombre.

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

Lo único público es la lista de nombres — es la puerta, y la tablet vive dentro
del almacén. Desde ahí todo exige identidad, y el servidor vuelve a verificar el
permiso en cada llamada.

**Configuración vuelve a pedir el PIN** si la persona lleva más de 3 minutos
dentro del sistema. Recién identificado entra directo; si la tablet lleva rato
encendida y pudo cambiar de manos, se confirma otra vez.

---

## Módulos

| Módulo | Estado | Quién entra |
|---|---|---|
| **Checklists** | Funcionando | Todo el equipo |
| Inventario | Próximamente | — |
| Ventas por fuera | Próximamente | — |
| Calidad | Próximamente | — |
| ODT de la semana | Próximamente | — |
| **Configuración** | Funcionando | Solo Administrador |

**Agregar un módulo es un renglón** en la lista `MODULOS`, al inicio de
`server.js`. Aparece solo en el menú, con su ícono y su control de acceso. Poner
`disponible: false` lo muestra como *Próximamente* sin dejar entrar.

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

> Todos los equipos deben estar en la **misma red wifi**. Si la computadora cambia
> de red, la dirección `192.168...` cambia; vuelve a leerla en la ventana negra.

---

## Acceso desde otros equipos

Funciona igual desde tablet, laptop o computadora de escritorio: es la misma
dirección en el navegador. La interfaz se adapta sola —en pantalla grande usa el
ancho disponible y los botones se ajustan al mouse— y **el regreso automático al
reposo solo ocurre en dispositivos táctiles**, para no interrumpir a alguien que
lleva rato leyendo un reporte en su computadora.

### Si otro equipo no abre la dirección

Casi siempre es el **Firewall de Windows**, no la plataforma. En esta computadora
hay dos reglas que **bloquean Node.js** en redes públicas, y el wifi está
clasificado como pública — así que ningún otro equipo puede entrar.

Para arreglarlo, abre **PowerShell como administrador** (clic derecho en Inicio →
*Terminal (Administrador)*) y corre estos dos comandos:

```powershell
Remove-NetFirewallRule -DisplayName "Node.js JavaScript Runtime" -ErrorAction SilentlyContinue
```

```powershell
New-NetFirewallRule -DisplayName "Sistema Digital INKO" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any -RemoteAddress LocalSubnet
```

El primero quita el bloqueo —se creó solo cuando alguien respondió "Cancelar" al
aviso de Windows—. El segundo abre **únicamente el puerto 3000 y solo para equipos
de tu propia red** (`LocalSubnet`), que es lo mínimo necesario: no expone nada a
internet.

No los corrí por ti a propósito. El firewall es una defensa del equipo y esa
decisión debe tomarla una persona, no quedar dentro de un script.

**Si aun así no entra**, el sospechoso es la **VPN de McAfee** que está activa en
esta computadora: cuando enruta el tráfico puede tapar la red local. Pruébalo
desconectándola un momento.

---

## Primer uso

Entra con **Administrador** y su PIN. Luego ve a **Configuración** y:

1. **Cambia el PIN del administrador** o crea tu propio usuario admin.
   (En una instalación nueva el PIN inicial es `1234`; cámbialo de inmediato.)
2. **Da de alta a tu equipo.** Cada persona con su perfil (ver tabla abajo).
3. **Revisa las unidades.** Vienen cargadas ISUZU, NP300, PARTNER y un montacargas
   genérico (`MC-01`). Ajusta o agrega las que falten.

---

## Perfiles y accesos

Existen tres perfiles, ni uno más:

| Perfil | Llena checklists | Firma como operador | Autoriza salida y cierra Tránsito | Reportes | Comparativa | Configuración |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Operador | sí | sí | — | — | — | — |
| **Team Leader** | sí | sí | **sí** | **sí** | — | — |
| **Administrador** | sí | sí | **sí** | **sí** | **sí** | **sí** |

El mismo permiso cubre tres cosas: la firma de autorización del montacargas, la
autorización de salida de Tránsito y el cierre de su proceso.

### Configuración, por secciones

| Pestaña | Qué tiene |
|---|---|
| **Personas** | Nombre, perfil, PIN, estado (alta/baja) e historial de cada quien |
| **Permisos** | Matriz persona × permiso: se otorga y se quita con un toque |
| **Unidades** | Camionetas y montacargas, con sus parámetros |
| **Checklists** | Qué formatos existen y cuáles están en circulación |

### La matriz de permisos

En **Configuración → Permisos** hay una tabla con todas las personas y todos los
permisos, agrupados en **Módulos** (qué aparece en su menú) y **Dentro de
Checklists** (llenar, autorizar salidas, Reportes, Comparativa).

Cada casilla es el permiso real de esa persona. Se marca y se desmarca
libremente. Cuando el valor difiere de lo que trae su perfil, la casilla queda
con **fondo azul**: es un ajuste manual. El botón **Restablecer** de esa fila
devuelve a la persona a lo que su perfil determine.

Dos cosas que la plataforma no deja hacer:

- **Dejar a alguien sin ningún módulo.** Entraría a un menú vacío.
- **Dar Reportes, Comparativa o Configuración a quien no tiene PIN.** Primero se
  le asigna uno en la pestaña Personas.

Cambiarle los permisos a alguien **le cierra la sesión al instante**, para que no
siga con los accesos viejos. Si te los cambias a ti mismo, te toca volver a entrar.

### Accesos que son de un puesto, no de un perfil

La **Comparativa** la ve quien lleva Planeación Logística, que hoy es **Héctor
Célis** — no los cuatro Team Leaders. Como sería absurdo inventar un perfil por
cada excepción, existen los **accesos adicionales**: en la ficha de cada persona
(Configuración → ✎) hay casillas para otorgarle algo por encima de su perfil.

Héctor tiene marcada **Comparativa entre semanas**. Los otros Team Leaders no, y
si entran a esa dirección el servidor los rechaza. **El Administrador la ve
siempre**, igual que Reportes y Configuración: le vienen incluidas en su perfil,
no hace falta otorgárselas.

En la tabla de Personas, la columna **A qué tiene acceso** muestra lo que cada
quien puede ver de verdad. Las marcadas con **★** se otorgaron a esa persona en
particular; las demás vienen de su perfil.

Cuando alguien más tome Planeación Logística, se desmarca la casilla en la ficha de
Héctor y se marca en la de la persona nueva. **No hay que tocar código ni cambiar
perfiles.** La columna *Accesos extra* de la tabla muestra de un vistazo quién
tiene qué.

Si el perfil elegido ya incluye ese acceso (un Administrador siempre ve todo), la
casilla aparece marcada y bloqueada: no tendría sentido "quitársela".

**Configuración no se puede otorgar así, a propósito.** Dar de alta gente es la
llave maestra y sigue atada al perfil de Administrador.

**Configuración es exclusiva del Administrador.** Es donde se dan de alta personas
y unidades, así que quien entra ahí puede darse a sí mismo cualquier permiso.

**Y siempre vuelve a pedir el PIN**, aunque la tablet ya traiga una sesión abierta.
Los demás módulos, si ya te identificaste, te dejan pasar; Configuración no. Que
alguien haya dejado su sesión abierta no es prueba de quién está entrando.

Por lo mismo, **al salir de Configuración se cierra la sesión**. Si no, el
Administrador dejaría la tablet con su sesión activa y el siguiente entraría a
Checklists como él sin capturar ningún PIN. Moverse entre las pestañas de
Configuración no la cierra: solo salir.

> Consecuencia práctica: en esa sección solo aparecen personas **con PIN
> asignado**. Sin un secreto que comprobar no hay forma de verificar identidad,
> así que alguien sin PIN simplemente no puede entrar ahí.

**Reportes lo ven los Team Leaders y el Administrador. La Comparativa, solo quien
la tenga otorgada** (hoy Héctor Célis) **y el Administrador.**

El bloqueo no es solo que el botón no aparezca: cada llamada al servidor vuelve a
verificar el permiso. Escribir la dirección a mano no sirve de nada.

**Estos dos perfiles exigen PIN** de 4 a 12 caracteres — la plataforma no deja
crearlos sin él. Se admiten **letras y números**, para poder usar claves con
significado. En la pantalla de acceso hay teclado numérico en pantalla *y* campo
de texto: los PIN con letras se capturan tecleando. Ven información de toda la operación y la tablet del almacén es compartida.
Para operadores el PIN es opcional; sin PIN se entra tocando el nombre, que en una
tablet compartida es más rápido.

### Editar a una persona

En **Configuración → Personas**, el ícono **✎** a la derecha de cada nombre abre su
ficha. Desde ahí se cambia todo:

- **Corregir el nombre** — errores de dedo, apellidos que faltaban.
- **Cambio de perfil** — un ascenso a Team Leader, o un regreso a Operador.
- **Accesos adicionales** — otorgar la Comparativa (o Reportes) a esa persona en
  particular, por encima de lo que trae su perfil.
- **PIN** — dejarlo vacío no lo toca. Escribir uno lo reemplaza. Quien ve Reportes,
  Comparativa o Configuración no puede quedarse sin PIN, venga del perfil o de un
  acceso otorgado.
- **Baja** — desmarcar *Activo* cuando alguien deje la empresa.

**Dar de baja no borra a nadie.** La persona desaparece de la pantalla de ingreso y
no puede entrar, pero sus checklists y firmas siguen intactos en el historial. Un
checklist firmado en marzo debe seguir mostrando quién lo firmó aunque esa persona
ya no trabaje ahí. Si regresa, se vuelve a marcar *Activo* y sigue con su historial.
La ficha muestra cuántos llenados y firmas tiene cada quien.

Dos protecciones que verás si te topas con ellas:

- **No se puede quitar al último Administrador.** Ni degradarlo ni darlo de baja
  mientras sea el único activo — nadie podría volver a entrar a Configuración, ni
  siquiera para deshacerlo. Nombra a otro Administrador primero.
- **Cambiar el perfil de alguien cierra su sesión al instante.** Si acabas de
  degradar a un Team Leader, no se queda con la pestaña de Reportes abierta hasta
  que caduque su sesión: se le pide entrar de nuevo y ya con los permisos nuevos.
  Si te editas a ti mismo, te tocará volver a entrar.

### La segunda firma del montacargas

En papel, el checklist de montacargas llevaba dos firmas: "Firma Operador" y
"Firma del Coordinador". Como el perfil de coordinador no existe, esa segunda
firma se llama ahora **"Firma de autorización (Team Leader)"** y solo la puede
levantar un Team Leader o el Administrador.

Al operador ni siquiera se le muestra el recuadro: captura su parte, y el Team
Leader autoriza después desde su sesión. El checklist no cierra sin esa firma.

> Si alguien viene de una versión anterior con perfiles `coordinador` o
> `lider_logistica`, la plataforma los reasigna sola al arrancar y avisa en la
> ventana negra: `lider_logistica` pasa a Team Leader, y `coordinador` pasa a
> **Operador** — a propósito, para no regalarle acceso a Reportes a nadie sin que
> tú lo decidas. Si alguno debe ser Team Leader, cámbialo en Configuración.

### Si necesitas mover un permiso

Todo está en un solo bloque al inicio de `server.js`, en `PERMISOS`. Por ejemplo,
para que los operadores también vean Reportes, agrega `reportes: true` a `operador`
y reinicia. El menú de la app, los bloqueos del servidor y la exigencia de PIN se
ajustan solos — no hay nada más que tocar.

### Dato pendiente

**NP300 no tiene presión de llantas.** En el archivo original el campo venía vacío,
así que en la app aparece como `Presión de llantas __ psi`. Ve a
**Configuración → Unidades** y captúrala cuando la tengas.

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

| Checklist | Cuándo |
|---|---|
| Inspección de Unidad (ISUZU, NP300, PARTNER) | **Solo viernes** |
| Inspección de Montacargas | **Solo viernes** |
| Insumos y Cajas | Semanal |
| Checklist Tránsito | Diario, uno por envío |

Los de viernes aparecen el resto de la semana como *disponible el viernes* y no
se pueden abrir. El servidor también lo verifica, no solo la pantalla.

---

## Tránsito: un checklist por envío, en dos etapas

Tránsito cubre **entregas directas en CEDIS**. Ya no es un registro diario: es
**uno por envío**, y se llena en dos momentos. Puede haber varios el mismo día.

### Dónde viven los envíos

En la portada de Checklists, Tránsito ocupa **una sola tarjeta**, con la cuenta de
cuántos envíos hay abiertos. Si hay alguno, arriba de la lista aparece además un
**aviso** — *«Hay 2 envíos en proceso»* — que lleva directo a ellos de un toque.

El detalle vive en la **pantalla propia de Tránsito**: los abiertos arriba, los ya
concluidos del día abajo para consulta, y el botón **+ Nuevo envío**. Así la
portada no se llena de tarjetas cuando hay varias entregas en el día.

### 1. Antes de salir

Se toca **`+ Nuevo envío`** y lo primero que pide son los datos de cabecera,
antes de cualquier inspección:

- **Número de envío** — identifica el checklist. No se pueden repetir dos con el
  mismo número el mismo día.
- **Lugar de entrega**

Luego se llena la inspección previa y se cargan las **hojas de autorización de
ingreso**.

**La salida la autoriza un Team Leader o el Administrador, no quien lo llenó.**
El operador prepara el envío; cuando está completo, el pie de pantalla le dice
*«La salida la autoriza un Team Leader»* y ahí termina su parte. El mando entra,
revisa y toca **Autorizar salida**. Queda registrado quién autorizó.

> **La unidad ya puede salir, pero el proceso NO está concluido.** El checklist
> queda en estado **En ruta** y aparece en la lista con la hora de salida y la
> leyenda *"falta la hoja de recepción"*.

### 2. Al regresar

Se abre el envío desde la lista. La inspección previa se ve marcada **Registrada
al salir** y ya no se puede modificar: es el estado en que la unidad salió, y
reescribirlo sería falsear el registro. El operador carga la **hoja de recepción**
y firma.

**El cierre también lo hace un Team Leader o el Administrador.** Queda registrado
quién cerró, igual que quién autorizó la salida.

### Lo que la plataforma no deja hacer

| Intento | Qué pasa |
|---|---|
| Autorizar la salida sin las hojas de autorización | Se rechaza y dice cuál falta |
| Cerrar el proceso sin haber autorizado la salida | *"Primero autoriza la salida"* |
| Cargar la hoja de recepción antes de salir | *"Ese documento se carga al regresar"* |
| Cambiar la inspección previa ya en ruta | *"La salida ya fue autorizada"* |
| Cambiar la hoja de autorización ya en ruta | Se rechaza |
| Repetir un número de envío el mismo día | Se rechaza |
| Cerrar sin la hoja de recepción o sin firma | Se rechaza y dice qué falta |
| Un operador autoriza la salida | **403** — solo Team Leader o Administrador |
| Un operador cierra el proceso | **403** — solo Team Leader o Administrador |

No son solo avisos en pantalla: el servidor lo verifica en cada llamada.

### Los documentos

| Etapa | Documento |
|---|---|
| **Antes de salir** | Hojas de autorización de ingreso |
| **Al regresar** | Hojas de recepción de entrega |

En cada uno se pueden cargar varios archivos: normalmente una hoja por punto de
entrega.

> **La sección «Ventas x fuera» se retiró de Tránsito.** Sus nueve ítems siguen
> transcritos y desactivados en la base: son la base del módulo **Ventas por
> fuera** cuando toque construirlo. Nada se perdió.

Cada uno se marca **Pendiente** en rojo hasta que se carga, y el pie de pantalla
habla solo de la etapa en curso.

Se aceptan **fotos y PDF**: da igual fotografiar la hoja con la tablet o adjuntar
el escaneo de la multifuncional. A diferencia de las fotos de evidencia —que
abren la cámara directamente— el botón de documentos abre el selector de
archivos, para poder elegir un PDF ya guardado. Se pueden cargar varios archivos
en el mismo renglón: las hojas de recepción suelen ser una por entrega.

Los documentos se guardan a mayor resolución que las fotos de evidencia (2200 px
contra 1600), porque en una hoja de recepción hay que poder leer la firma y lo
escrito a mano. Los PDF se guardan tal cual y se abren en una pestaña nueva.


## Evidencia fotográfica

Al marcar un ítem como **Problema** aparece el botón **📷 Tomar foto**. En la tablet
abre la cámara directamente (no el explorador de archivos), así que la foto siempre
es del momento de la inspección.

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

## Uso diario

**El equipo:** toca su nombre → elige el checklist → contesta → firma → *Cerrar y enviar*.

- Se guarda solo, respuesta por respuesta. Si la tablet se apaga a media captura,
  no se pierde nada: al volver a entrar continúa donde quedó.
- Un checklist cerrado ya no se puede editar. Se puede consultar desde Reportes.
- Un checklist por unidad por periodo: los semanales se reinician cada lunes, el de
  Tránsito cada día. El de Montacargas solo se habilita los viernes.

**El Team Leader:** pestaña **Reportes**.

- *Problemas detectados* — todo lo que salió mal, con quién lo reportó, cuándo y las
  **fotos de evidencia**. Toca una miniatura para verla completa.
- *Historial* — cada llenado, su estado y cuántos problemas trae. Botón "Ver" para
  abrir el checklist completo tal como se llenó, con firmas.
- *Descargar todo en Excel (CSV)* — se abre directo en Excel, con acentos correctos.

### Comparativa entre semanas

Pestaña **Comparativa**. Se eligen las semanas a comparar tocando sus etiquetas
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

## Respaldos

Toda la información vive en la carpeta **`datos`**: las respuestas y firmas en
`checklists.db`, las fotos en `datos/fotos/`. Respalda la carpeta completa —
la base y las fotos van juntas o el reporte queda con evidencia rota.
Para restaurar, reemplázala (con la plataforma apagada).

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
- **La seguridad actual asume red local.** Los PIN se guardan en texto plano y las
  sesiones viven en memoria. Es adecuado para una tablet que no sale del almacén.
  Si algún día quieres que se use desde fuera (celular del operador en ruta), hay
  que ponerla en un servidor con HTTPS y cambiar los PIN por contraseñas cifradas.
  Avísame y lo hago.

### Estructura

```
plataforma/
  Iniciar plataforma.bat   ← doble clic aquí
  server.js                ← servidor, API, MODULOS y PERMISOS
  db.js                    ← estructura de la base de datos
  fechas.js                ← semanas ISO (agrupar y comparar)
  seed.js                  ← los checklists transcritos del papel
  public/
    index.html             ← reposo, barra y contenedor
    app.js                 ← navegación y todas las pantallas
    marca.css              ← Brand Book: colores, tipografías, forma
    estilos.css            ← componentes de la interfaz
    marca/                 ← logotipo en sus dos versiones autorizadas
    fuentes/               ← aquí van los .woff2 corporativos
  datos/checklists.db      ← respuestas, firmas y observaciones
  datos/fotos/             ← las fotos de evidencia
```

### Cómo se agrega un módulo nuevo

1. Un renglón en `MODULOS` (arriba de `server.js`) con su clave, nombre, ícono y
   el permiso que exige.
2. Si lleva pantalla propia, una entrada en `RUTAS` y su vista en `app.js`.
3. Si guarda información, sus tablas en `db.js`.

Mientras no esté listo, se deja `disponible: false` y aparece en el menú como
*Próximamente*, para que el equipo vea a dónde va el sistema.

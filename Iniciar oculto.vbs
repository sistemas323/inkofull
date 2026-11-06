' ============================================================================
'  SISTEMA DIGITAL INKO — arranque sin ventana
'
'  Hace lo mismo que «Iniciar plataforma.bat» —incluido volver a levantarla sola
'  si se cae—, pero sin dejar una ventana negra abierta. Eso importa: la ventana
'  se cerraba sin querer —al apagar la pantalla, al cerrar cosas al final del
'  día— y con ella se iba la plataforma, aunque la computadora siguiera
'  encendida. Desde el iPad eso se ve igual que si se hubiera descompuesto.
'
'  Llama al .bat en vez de a node directamente, a propósito: el .bat trae el
'  ciclo que la vuelve a levantar a los 5 segundos. Si aquí se llamara a node,
'  cualquier caída —o una actualización— la dejaría apagada hasta que alguien
'  fuera a prenderla.
'
'  Todo lo que escriba el servidor queda en datos\servidor.log, igual que antes.
'  Para detenerla: Administrador de tareas → node.exe → Finalizar tarea.
' ============================================================================

Dim sh, carpeta
Set sh = CreateObject("WScript.Shell")

' La carpeta de este archivo, sea cual sea la ruta: así sigue sirviendo si la
' plataforma se mueve a otra computadora o cambia de lugar.
carpeta = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
sh.CurrentDirectory = carpeta

' INKO_OCULTO le avisa al .bat que no hay nadie viendo: así, si la plataforma ya
' estaba abierta, no se queda esperando un «presione una tecla» que nadie puede
' ver ni contestar.
' 0 = sin ventana. False = no esperar a que termine.
sh.Run "cmd /c set INKO_OCULTO=1 && """ & carpeta & "\Iniciar plataforma.bat""", 0, False

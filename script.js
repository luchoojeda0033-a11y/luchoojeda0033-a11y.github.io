const gradosLista = ["6.1", "6.2", "6.3", "7.1", "8.1", "8.2", "9.1", "9.2", "10.1", "10.2", "11.1", "11.2", "11.3"];
let gradoActual = "6.1";
const CLAVE_AUTENTICACION = 'asistenciaAuth';
const CLAVE_RESPALDO_AUTOMATICO = 'asistenciaRespaldoAutomatico';
const CLAVES_DATOS = ['asistenciaGrados', 'historialGrados', 'archivosGrados'];
const BASE_DATOS_RESPALDOS = 'asistencia-colegio-archivos';
let handleRespaldoExcel = null;
let colaEscrituraExcel = Promise.resolve();
let temporizadorRespaldoExcel = null;
let configuracionRecuperacionDesdeSesion = false;

function leerJSONLocal(clave, alternativa = null) {
    try {
        const valor = localStorage.getItem(clave);
        return valor ? JSON.parse(valor) : alternativa;
    } catch {
        return alternativa;
    }
}

const respaldoAutomaticoInicial = leerJSONLocal(CLAVE_RESPALDO_AUTOMATICO);

// 4. CALENDARIO: Inicializar la fecha con el día de hoy
const inputFecha = document.getElementById('fecha-asistencia');
let hoyISO = new Date().toISOString().split('T')[0];
inputFecha.value = hoyISO;
let fechaSeleccionadaTexto = obtenerFechaTexto(hoyISO);

function obtenerFechaTexto(fechaString) {
    const partes = fechaString.split('-');
    const fechaObj = new Date(partes[0], partes[1] - 1, partes[2]);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return fechaObj.toLocaleDateString('es-ES', options);
}

function cambiarFechaManual() {
    fechaSeleccionadaTexto = obtenerFechaTexto(inputFecha.value);
    document.getElementById('whatsapp-panel').style.display = 'none';
    renderizarTabla();
    renderizarHistorial();
}

let baseDatosGrados = leerJSONLocal('asistenciaGrados', respaldoAutomaticoInicial?.baseDatosGrados) || {
    "6.1": [], "6.2": [], "6.3": [],
    "7.1": [], "8.1": [], "8.2": [],
    "9.1": [], "9.2": [], "10.1": [], "10.2": [],
    "11.1": [], "11.2": [], "11.3": []
};

let historialGrados = leerJSONLocal('historialGrados', respaldoAutomaticoInicial?.historialGrados) || {};
let archivosGrados = leerJSONLocal('archivosGrados', respaldoAutomaticoInicial?.archivosGrados) || {};

function bytesABase64(bytes) {
    return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
}

function base64ABytes(valor) {
    return Uint8Array.from(atob(valor), caracter => caracter.charCodeAt(0));
}

async function derivarHashPIN(pin, sal) {
    const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sal, iterations: 200000, hash: 'SHA-256' }, clave, 256);
    return new Uint8Array(bits);
}

function normalizarRespuestaRecuperacion(respuesta) {
    return respuesta.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase();
}

function mostrarConfiguracionRecuperacion(desdeSesion = false) {
    configuracionRecuperacionDesdeSesion = desdeSesion;
    document.getElementById('app-content').hidden = true;
    document.getElementById('login-screen').hidden = true;
    document.getElementById('recovery-setup-screen').hidden = false;
    document.getElementById('recovery-setup-form').reset();
    document.getElementById('recovery-setup-error').textContent = '';
}

function iniciarCambioRecuperacion() {
    mostrarConfiguracionRecuperacion(true);
}

function cancelarConfiguracionRecuperacion() {
    document.getElementById('recovery-setup-screen').hidden = true;
    if (configuracionRecuperacionDesdeSesion) {
        document.getElementById('app-content').hidden = false;
    } else {
        document.getElementById('login-screen').hidden = false;
    }
}

async function guardarPreguntaRecuperacion(event) {
    event.preventDefault();
    const acceso = leerJSONLocal(CLAVE_AUTENTICACION);
    const pregunta = document.getElementById('recovery-question-input').value.trim();
    const respuesta = normalizarRespuestaRecuperacion(document.getElementById('recovery-answer-setup').value);
    const confirmarRespuesta = normalizarRespuestaRecuperacion(document.getElementById('recovery-answer-confirm').value);
    try {
        if (pregunta.length < 6) throw new Error('Escribe una pregunta de al menos 6 caracteres.');
        if (respuesta.length < 8) throw new Error('La respuesta debe tener al menos 8 caracteres.');
        if (respuesta !== confirmarRespuesta) throw new Error('Las respuestas no coinciden.');

        const sal = crypto.getRandomValues(new Uint8Array(16));
        const hash = await derivarHashPIN(respuesta, sal);
        acceso.recuperacion = { pregunta, sal: bytesABase64(sal), hash: bytesABase64(hash) };
        localStorage.setItem(CLAVE_AUTENTICACION, JSON.stringify(acceso));
        document.getElementById('recovery-setup-screen').hidden = true;
        document.getElementById('recovery-setup-form').reset();
        document.getElementById('app-content').hidden = false;
        configuracionRecuperacionDesdeSesion = false;
    } catch (error) {
        document.getElementById('recovery-setup-error').textContent = error.message || 'No se pudo guardar la recuperación.';
    }
}

function actualizarPantallaAcceso() {
    const configurado = Boolean(leerJSONLocal(CLAVE_AUTENTICACION));
    document.getElementById('login-title').textContent = configurado ? 'Acceso del coordinador' : 'Configurar acceso';
    document.getElementById('login-description').textContent = configurado
        ? 'Ingresa tu PIN para abrir el sistema de asistencia.'
        : 'Crea un PIN numérico de 6 a 12 dígitos para este equipo.';
    document.getElementById('confirm-pin-group').hidden = configurado;
    document.getElementById('confirmar-pin').required = !configurado;
    document.getElementById('login-submit').textContent = configurado ? 'Ingresar' : 'Crear PIN';
    document.getElementById('login-error').textContent = '';
    document.getElementById('forgot-pin-button').hidden = !configurado;
    document.getElementById('login-form').hidden = false;
    document.getElementById('recovery-form').hidden = true;
    document.getElementById('recovery-error').textContent = '';
}

async function gestionarAcceso(event) {
    event.preventDefault();
    const pin = document.getElementById('login-pin').value;
    const confirmarPin = document.getElementById('confirmar-pin').value;
    let acceso = leerJSONLocal(CLAVE_AUTENTICACION);
    const mensajeError = document.getElementById('login-error');

    try {
        if (!acceso) {
            if (!/^\d{6,12}$/.test(pin)) {
                throw new Error('El PIN debe tener entre 6 y 12 dígitos.');
            }
            if (pin !== confirmarPin) {
                throw new Error('Los PIN no coinciden.');
            }

            const sal = crypto.getRandomValues(new Uint8Array(16));
            const hash = await derivarHashPIN(pin, sal);
            acceso = { sal: bytesABase64(sal), hash: bytesABase64(hash) };
            localStorage.setItem(CLAVE_AUTENTICACION, JSON.stringify(acceso));
        } else {
            const hashIngresado = await derivarHashPIN(pin, base64ABytes(acceso.sal));
            const hashGuardado = base64ABytes(acceso.hash);
            const coincide = hashIngresado.length === hashGuardado.length && hashIngresado.every((byte, indice) => byte === hashGuardado[indice]);
            if (!coincide) {
                throw new Error('PIN incorrecto. Intenta de nuevo.');
            }
        }

        if (!acceso.recuperacion?.sal || !acceso.recuperacion?.hash || !acceso.recuperacion?.pregunta) {
            mostrarConfiguracionRecuperacion();
            return;
        }

        document.getElementById('login-screen').hidden = true;
        document.getElementById('app-content').hidden = false;
        document.getElementById('login-form').reset();
    } catch (error) {
        mensajeError.textContent = error.message || 'No se pudo validar el PIN en este navegador.';
    }
}

function mostrarRecuperacionPIN() {
    const acceso = leerJSONLocal(CLAVE_AUTENTICACION);
    if (!acceso?.recuperacion?.pregunta) {
        document.getElementById('login-error').textContent = 'Inicia sesión con tu PIN para configurar la recuperación.';
        return;
    }
    document.getElementById('login-form').hidden = true;
    document.getElementById('recovery-form').hidden = false;
    document.getElementById('recovery-question-prompt').textContent = acceso.recuperacion.pregunta;
    document.getElementById('recovery-error').textContent = '';
    document.getElementById('recovery-answer-input').focus();
}

function volverAIngreso() {
    actualizarPantallaAcceso();
    document.getElementById('login-pin').focus();
}

async function restablecerPINOlvidado(event) {
    event.preventDefault();
    const acceso = leerJSONLocal(CLAVE_AUTENTICACION);
    const respuestaIngresada = normalizarRespuestaRecuperacion(document.getElementById('recovery-answer-input').value);
    const nuevoPin = document.getElementById('new-recovery-pin').value;
    const confirmarPin = document.getElementById('confirm-recovery-pin').value;
    const mensajeError = document.getElementById('recovery-error');

    try {
        if (!acceso?.recuperacion?.sal || !acceso?.recuperacion?.hash) throw new Error('No hay una recuperación configurada. Inicia sesión con el PIN para configurarla.');
        if (!/^\d{6,12}$/.test(nuevoPin)) throw new Error('El nuevo PIN debe tener entre 6 y 12 dígitos.');
        if (nuevoPin !== confirmarPin) throw new Error('Los PIN no coinciden.');

        const salRecuperacion = base64ABytes(acceso.recuperacion.sal);
        const hashIngresado = await derivarHashPIN(respuestaIngresada, salRecuperacion);
        const hashGuardado = base64ABytes(acceso.recuperacion.hash);
        const coincide = hashIngresado.length === hashGuardado.length && hashIngresado.every((byte, indice) => byte === hashGuardado[indice]);
        if (!coincide) throw new Error('Respuesta secreta incorrecta.');

        const salNuevoPin = crypto.getRandomValues(new Uint8Array(16));
        const hashNuevoPin = await derivarHashPIN(nuevoPin, salNuevoPin);
        acceso.sal = bytesABase64(salNuevoPin);
        acceso.hash = bytesABase64(hashNuevoPin);
        localStorage.setItem(CLAVE_AUTENTICACION, JSON.stringify(acceso));
        document.getElementById('recovery-form').reset();
        actualizarPantallaAcceso();
        document.getElementById('login-error').textContent = 'PIN actualizado. Ingresa con tu PIN nuevo.';
    } catch (error) {
        mensajeError.textContent = error.message || 'No se pudo restablecer el PIN.';
    }
}

function bloquearAplicacion() {
    document.getElementById('app-content').hidden = true;
    document.getElementById('login-screen').hidden = false;
    document.getElementById('login-form').reset();
    actualizarPantallaAcceso();
    document.getElementById('login-pin').focus();
}

function validarDatosRespaldo(datos) {
    return datos && typeof datos === 'object' &&
        datos.baseDatosGrados && typeof datos.baseDatosGrados === 'object' &&
        gradosLista.every(grado => Array.isArray(datos.baseDatosGrados[grado])) &&
        datos.historialGrados && typeof datos.historialGrados === 'object' &&
        datos.archivosGrados && typeof datos.archivosGrados === 'object';
}

function crearDatosRespaldo() {
    return {
        baseDatosGrados,
        historialGrados,
        archivosGrados
    };
}

function abrirBaseDatosRespaldos() {
    return new Promise((resolve, reject) => {
        const solicitud = indexedDB.open(BASE_DATOS_RESPALDOS, 1);
        solicitud.onupgradeneeded = () => solicitud.result.createObjectStore('archivos');
        solicitud.onsuccess = () => resolve(solicitud.result);
        solicitud.onerror = () => reject(solicitud.error);
    });
}

async function guardarHandleExcel(handle) {
    const db = await abrirBaseDatosRespaldos();
    await new Promise((resolve, reject) => {
        const transaccion = db.transaction('archivos', 'readwrite');
        transaccion.objectStore('archivos').put(handle, 'respaldoExcel');
        transaccion.oncomplete = resolve;
        transaccion.onerror = () => reject(transaccion.error);
    });
    db.close();
}

async function leerHandleExcel() {
    const db = await abrirBaseDatosRespaldos();
    const handle = await new Promise((resolve, reject) => {
        const solicitud = db.transaction('archivos', 'readonly').objectStore('archivos').get('respaldoExcel');
        solicitud.onsuccess = () => resolve(solicitud.result || null);
        solicitud.onerror = () => reject(solicitud.error);
    });
    db.close();
    return handle;
}

function actualizarEstadoRespaldoExcel(mensaje) {
    document.getElementById('estado-respaldo-excel').textContent = mensaje;
}

function crearLibroRespaldoExcel() {
    const libro = XLSX.utils.book_new();
    const filasRestauracion = [['Formato', 'Tipo', 'Grado', 'Datos JSON'], ['asistencia-colegio-excel-v1', '', '', '']];

    gradosLista.forEach(grado => {
        const estudiantes = baseDatosGrados[grado] || [];
        const lista = XLSX.utils.aoa_to_sheet([
            ['ID', 'Nombre', 'Teléfono', 'Estado', 'Faltas', 'Justificación'],
            ...estudiantes.map(estudiante => [estudiante.id, estudiante.nombre, estudiante.telefono, estudiante.estado, estudiante.faltas || 0, estudiante.justificacion || ''])
        ]);
        XLSX.utils.book_append_sheet(libro, lista, `Lista ${grado}`);

        const historial = historialGrados[grado] || [];
        const hojaHistorial = XLSX.utils.aoa_to_sheet([
            ['Fecha', 'Ausentes', 'Detalles y justificaciones'],
            ...historial.map(registro => [
                registro.fecha || '',
                Array.isArray(registro.ausentes) ? registro.ausentes.join('; ') : '',
                JSON.stringify(registro.detalles || [])
            ])
        ]);
        XLSX.utils.book_append_sheet(libro, hojaHistorial, `Historial ${grado}`);

        estudiantes.forEach(estudiante => filasRestauracion.push(['', 'estudiante', grado, JSON.stringify(estudiante)]));
        historial.forEach(registro => filasRestauracion.push(['', 'historial', grado, JSON.stringify(registro)]));
        filasRestauracion.push(['', 'archivo', grado, JSON.stringify(archivosGrados[grado] || '')]);
    });

    const hojaArchivos = XLSX.utils.aoa_to_sheet([
        ['Grado', 'Archivo CSV cargado'],
        ...gradosLista.map(grado => [grado, archivosGrados[grado] || ''])
    ]);
    XLSX.utils.book_append_sheet(libro, hojaArchivos, 'Archivos CSV');

    const hojaRestauracion = XLSX.utils.aoa_to_sheet(filasRestauracion);
    XLSX.utils.book_append_sheet(libro, hojaRestauracion, 'Datos internos');
    libro.Workbook = {
        Sheets: libro.SheetNames.map(nombre => ({ name: nombre, Hidden: nombre === 'Datos internos' ? 1 : 0 }))
    };
    return libro;
}

async function escribirRespaldoExcel(handle = handleRespaldoExcel) {
    if (!handle) return false;

    const permiso = await handle.queryPermission({ mode: 'readwrite' });
    if (permiso !== 'granted') {
        actualizarEstadoRespaldoExcel(`Excel seleccionado: ${handle.name}. Autoriza el acceso para continuar con el guardado automático.`);
        return false;
    }

    const datosExcel = XLSX.write(crearLibroRespaldoExcel(), { bookType: 'xlsx', type: 'array' });
    const archivo = await handle.createWritable();
    await archivo.write(datosExcel);
    await archivo.close();
    actualizarEstadoRespaldoExcel(`Respaldo Excel actualizado: ${handle.name}`);
    return true;
}

function programarRespaldoExcel() {
    if (!handleRespaldoExcel) return;
    clearTimeout(temporizadorRespaldoExcel);
    temporizadorRespaldoExcel = setTimeout(() => {
        colaEscrituraExcel = colaEscrituraExcel
            .then(() => escribirRespaldoExcel())
            .catch(error => actualizarEstadoRespaldoExcel(`No se pudo actualizar el Excel: ${error.message}`));
    }, 500);
}

async function configurarRespaldoExcel() {
    if (!window.showSaveFilePicker || !window.XLSX) {
        actualizarEstadoRespaldoExcel('Este navegador no permite el guardado automático del Excel.');
        return;
    }

    try {
        if (handleRespaldoExcel && typeof handleRespaldoExcel.requestPermission === 'function') {
            const permisoExistente = await handleRespaldoExcel.requestPermission({ mode: 'readwrite' });
            if (permisoExistente === 'granted') {
                await escribirRespaldoExcel();
                return;
            }
        }

        handleRespaldoExcel = await window.showSaveFilePicker({
            suggestedName: 'Respaldo-Asistencia-Colegio.xlsx',
            types: [{ description: 'Libro de Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
        });
        const permiso = await handleRespaldoExcel.requestPermission({ mode: 'readwrite' });
        if (permiso !== 'granted') throw new Error('Chrome no autorizó escribir en el archivo seleccionado.');

        await guardarHandleExcel(handleRespaldoExcel);
        await escribirRespaldoExcel();
    } catch (error) {
        if (error.name !== 'AbortError') actualizarEstadoRespaldoExcel(`No se configuró el Excel: ${error.message}`);
    }
}

async function inicializarRespaldoExcel() {
    try {
        handleRespaldoExcel = await leerHandleExcel();
        if (!handleRespaldoExcel) {
            actualizarEstadoRespaldoExcel('Excel automático: sin configurar. Elige el archivo una vez.');
            return;
        }

        const permiso = await handleRespaldoExcel.queryPermission({ mode: 'readwrite' });
        actualizarEstadoRespaldoExcel(permiso === 'granted'
            ? `Excel automático configurado: ${handleRespaldoExcel.name}`
            : `Excel seleccionado: ${handleRespaldoExcel.name}. Autoriza el acceso para reanudar el guardado.`);
    } catch (error) {
        actualizarEstadoRespaldoExcel('No se pudo recuperar el permiso del Excel. Vuelve a elegir el archivo.');
    }
}

function leerDatosRespaldoExcel(archivo) {
    const libro = XLSX.read(archivo, { type: 'array' });
    const hoja = libro.Sheets['Datos internos'];
    if (!hoja) throw new Error('El Excel no contiene los datos de respaldo del sistema.');

    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' });
    if (filas[1]?.[0] !== 'asistencia-colegio-excel-v1') throw new Error('El formato del respaldo Excel no es válido.');

    const datos = {
        baseDatosGrados: Object.fromEntries(gradosLista.map(grado => [grado, []])),
        historialGrados: Object.fromEntries(gradosLista.map(grado => [grado, []])),
        archivosGrados: {}
    };

    filas.slice(2).forEach(fila => {
        const tipo = fila[1];
        const grado = fila[2];
        if (!gradosLista.includes(grado)) return;

        const valor = JSON.parse(fila[3]);
        if (tipo === 'estudiante') datos.baseDatosGrados[grado].push(valor);
        if (tipo === 'historial') datos.historialGrados[grado].push(valor);
        if (tipo === 'archivo') datos.archivosGrados[grado] = valor;
    });

    return datos;
}

function descargarRespaldo() {
    const respaldo = {
        formato: 'asistencia-colegio',
        version: 1,
        creadoEn: new Date().toISOString(),
        datos: crearDatosRespaldo()
    };
    const archivo = new Blob([JSON.stringify(respaldo, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(archivo);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `respaldo-asistencia-${new Date().toISOString().slice(0, 10)}.json`;
    enlace.click();
    URL.revokeObjectURL(url);
}

function restaurarRespaldo(event) {
    const archivo = event.target.files[0];
    event.target.value = '';
    if (!archivo) return;

    const lector = new FileReader();
    lector.onload = async function() {
        try {
            let datos;
            if (archivo.name.toLowerCase().endsWith('.xlsx')) {
                datos = leerDatosRespaldoExcel(lector.result);
            } else {
                const respaldo = JSON.parse(lector.result);
                if (respaldo.formato !== 'asistencia-colegio' || respaldo.version !== 1) {
                    throw new Error('El archivo no es un respaldo válido de este sistema.');
                }
                datos = respaldo.datos;
            }
            if (!validarDatosRespaldo(datos)) {
                throw new Error('El archivo no es un respaldo válido de este sistema.');
            }
            if (!confirm('Restaurar este respaldo reemplazará las listas y el historial actuales. ¿Deseas continuar?')) return;

            const datosAnteriores = Object.fromEntries(CLAVES_DATOS.map(clave => [clave, localStorage.getItem(clave)]));
            try {
                localStorage.setItem('asistenciaGrados', JSON.stringify(datos.baseDatosGrados));
                localStorage.setItem('historialGrados', JSON.stringify(datos.historialGrados));
                localStorage.setItem('archivosGrados', JSON.stringify(datos.archivosGrados));
                localStorage.setItem(CLAVE_RESPALDO_AUTOMATICO, JSON.stringify({ ...datos, guardadoEn: new Date().toISOString() }));
            } catch (error) {
                CLAVES_DATOS.forEach(clave => {
                    if (datosAnteriores[clave] === null) localStorage.removeItem(clave);
                    else localStorage.setItem(clave, datosAnteriores[clave]);
                });
                throw error;
            }
            baseDatosGrados = datos.baseDatosGrados;
            historialGrados = datos.historialGrados;
            archivosGrados = datos.archivosGrados;
            await escribirRespaldoExcel();
            alert('Respaldo restaurado. La página se recargará con los datos recuperados.');
            location.reload();
        } catch (error) {
            alert(error.message || 'No se pudo leer el archivo de respaldo.');
        }
    };
    if (archivo.name.toLowerCase().endsWith('.xlsx')) lector.readAsArrayBuffer(archivo);
    else lector.readAsText(archivo);
}

function actualizarArchivoCargado() {
    const archivo = archivosGrados[gradoActual];
    const estudiantes = baseDatosGrados[gradoActual] || [];
    const estadoArchivo = document.getElementById('archivo-cargado');

    if (archivo) {
        estadoArchivo.textContent = `Archivo cargado: ${archivo}`;
    } else if (estudiantes.length > 0) {
        estadoArchivo.textContent = 'Lista cargada anteriormente; nombre del archivo no disponible.';
    } else {
        estadoArchivo.textContent = 'No hay archivo cargado para este grado.';
    }
}

function inicializarPestañas() {
    const nav = document.getElementById('grades-nav');
    nav.innerHTML = '';
    gradosLista.forEach(grado => {
        const btn = document.createElement('button');
        btn.className = `tab-grado ${grado === gradoActual ? 'active' : ''}`;
        btn.innerText = `Grado ${grado}`;
        btn.onclick = () => seleccionarGrado(grado);
        nav.appendChild(btn);
    });
}

function seleccionarGrado(grado) {
    gradoActual = grado;
    document.getElementById('grado-titulo').innerText = grado;
    document.getElementById('grado-historial-label').innerText = grado;
    document.getElementById('busqueda-estudiante').value = '';
    document.getElementById('whatsapp-panel').style.display = 'none';
    inicializarPestañas();
    actualizarArchivoCargado();
    renderizarTabla();
    renderizarHistorial();
}

// 1. ESTADÍSTICAS GENERALES
function actualizarEstadisticas() {
    const estudiantes = baseDatosGrados[gradoActual] || [];
    const total = estudiantes.length;
    const asistieron = estudiantes.filter(e => e.estado === 'asistio').length;
    const faltaron = estudiantes.filter(e => e.estado === 'falto').length;
    const porcentaje = total > 0 ? Math.round((asistieron / total) * 100) : 100;

    document.getElementById('stat-total').innerText = total;
    document.getElementById('stat-asistieron').innerText = asistieron;
    document.getElementById('stat-faltaron').innerText = faltaron;
    document.getElementById('stat-porcentaje').innerText = `${porcentaje}%`;
}

function renderizarTabla() {
    const estudiantes = baseDatosGrados[gradoActual] || [];
    const tbody = document.getElementById('student-list');
    const consulta = document.getElementById('busqueda-estudiante').value.trim();
    const consultaNormalizada = consulta.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    tbody.innerHTML = '';

    if (estudiantes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#777; padding: 25px;">No hay estudiantes registrados para el grado ${gradoActual}. Sube un archivo CSV para comenzar.</td></tr>`;
        actualizarEstadisticas();
        return;
    }

    const estudiantesVisibles = estudiantes
        .map((estudiante, index) => ({ estudiante, index }))
        .filter(({ estudiante }) => {
            const nombre = String(estudiante.nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            const telefono = String(estudiante.telefono || '').replace(/\D/g, '');
            const consultaTelefono = consulta.replace(/\D/g, '');

            return nombre.includes(consultaNormalizada) ||
                (consultaTelefono && telefono.includes(consultaTelefono));
        });

    if (estudiantesVisibles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#777; padding: 25px;">No se encontraron estudiantes con esa búsqueda.</td></tr>';
        actualizarEstadisticas();
        return;
    }

    estudiantesVisibles.forEach(({ estudiante, index }) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${estudiante.nombre}</td>
            <td>${estudiante.telefono}</td>
            <td><strong><span style="color: ${estudiante.faltas > 0 ? 'var(--danger-color)' : 'inherit'}">${estudiante.faltas || 0}</span></strong></td>
            <td>
                <div class="attendance-btns">
                    <button id="asistio-${estudiante.id}" class="btn-asistio ${estudiante.estado === 'asistio' ? 'active' : ''}" onclick="marcar(${estudiante.id}, 'asistio')">Asistió</button>
                    <button id="falto-${estudiante.id}" class="btn-falto ${estudiante.estado === 'falto' ? 'active' : ''}" onclick="marcar(${estudiante.id}, 'falto')">Faltó</button>
                </div>
            </td>
            <td>
                <!-- 2. JUSTIFICACIÓN / NOTA -->
                <input type="text" class="input-justificacion" placeholder="Ej: Cita médica, sin excusa..." value="${estudiante.justificacion || ''}" onchange="guardarJustificacion(${estudiante.id}, this.value)">
            </td>
        `;
        tbody.appendChild(tr);
    });

    actualizarEstadisticas();
}

function guardarJustificacion(id, texto) {
    const estudiante = baseDatosGrados[gradoActual].find(e => e.id === id);
    if (estudiante) {
        estudiante.justificacion = texto;
        guardarEnMemoria();
    }
}

function renderizarHistorial() {
    const container = document.getElementById('historial-container');
    const historialDelGrado = historialGrados[gradoActual] || [];

    if (historialDelGrado.length === 0) {
        container.innerHTML = `<p style="color: #666; font-style: italic;">No hay registros de inasistencia guardados aún para este grado.</p>`;
        return;
    }

    container.innerHTML = '';
    historialDelGrado.slice().reverse().forEach((registro, indexReal) => {
        const indexOriginal = historialDelGrado.length - 1 - indexReal;
        
        const div = document.createElement('div');
        div.className = 'history-item';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';

        // Muestra también los detalles de los ausentes
        const detallesAusentes = Array.isArray(registro.detalles) ? registro.detalles : [];
        const nombresAusentes = Array.isArray(registro.ausentes)
            ? registro.ausentes
            : detallesAusentes.map(detalle => detalle.nombre).filter(Boolean);
        const detalleAusentes = detallesAusentes.length > 0
            ? detallesAusentes.map(d => `${d.nombre}${d.nota ? ' (' + d.nota + ')' : ''}`).join(', ')
            : nombresAusentes.join(', ');

        div.innerHTML = `
            <div><strong>📅 Fecha:</strong> ${registro.fecha} — <strong>Ausentes:</strong> ${detalleAusentes}</div>
            <button onclick="eliminarRegistroHistorial(${indexOriginal})" style="background: var(--danger-color); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;" title="Eliminar este registro">🗑️ Borrar</button>
        `;
        container.appendChild(div);
    });
}

function marcar(id, estado) {
    const estudiantes = baseDatosGrados[gradoActual];
    const estudiante = estudiantes.find(e => e.id === id);
    if (estudiante) {
        estudiante.estado = estado;
        document.getElementById(`asistio-${id}`).className = `btn-asistio ${estado === 'asistio' ? 'active' : ''}`;
        document.getElementById(`falto-${id}`).className = `btn-falto ${estado === 'falto' ? 'active' : ''}`;
        guardarEnMemoria();
        actualizarEstadisticas();
    }
}

function cargarArchivoCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n');
        let nuevosEstudiantes = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                const cols = line.split(',');
                if (cols.length >= 2) {
                    nuevosEstudiantes.push({
                        id: i,
                        nombre: cols[0].replace(/['"]+/g, '').trim(),
                        telefono: cols[1].replace(/['"]+/g, '').trim(),
                        estado: 'asistio',
                        faltas: 0,
                        justificacion: ''
                    });
                }
            }
        }

        if (nuevosEstudiantes.length > 0) {
            baseDatosGrados[gradoActual] = nuevosEstudiantes;
            archivosGrados[gradoActual] = file.name;
            guardarEnMemoria();
            actualizarArchivoCargado();
            renderizarTabla();
            alert(`¡Lista cargada y guardada con éxito para el grado ${gradoActual}!`);
        } else {
            alert("No se pudieron leer datos. Formato requerido: Nombre, Teléfono");
        }
    };
    reader.readAsText(file);
}

function guardarEnMemoria() {
    const datos = crearDatosRespaldo();
    try {
        localStorage.setItem(CLAVE_RESPALDO_AUTOMATICO, JSON.stringify({ ...datos, guardadoEn: new Date().toISOString() }));
    } catch (error) {
        console.warn('No se pudo actualizar el respaldo local automático.', error);
    }
    localStorage.setItem('asistenciaGrados', JSON.stringify(datos.baseDatosGrados));
    localStorage.setItem('historialGrados', JSON.stringify(datos.historialGrados));
    localStorage.setItem('archivosGrados', JSON.stringify(datos.archivosGrados));
    programarRespaldoExcel();
}

function recalcularFaltasTotales() {
    baseDatosGrados[gradoActual].forEach(est => est.faltas = 0);

    if (historialGrados[gradoActual]) {
        historialGrados[gradoActual].forEach(reg => {
            const ausentes = Array.isArray(reg.ausentes)
                ? reg.ausentes
                : Array.isArray(reg.detalles)
                    ? reg.detalles.map(detalle => detalle.nombre)
                    : [];

            ausentes.forEach(nombreAusente => {
                const estudiante = baseDatosGrados[gradoActual].find(e => e.nombre === nombreAusente);
                if (estudiante) {
                    estudiante.faltas = (estudiante.faltas || 0) + 1;
                }
            });
        });
    }
}

function guardarAsistencia() {
    document.getElementById('grado-actual-label').innerText = gradoActual;
    const estudiantes = baseDatosGrados[gradoActual] || [];
    
    if (estudiantes.length === 0) {
        alert("Primero debes cargar estudiantes para este grado.");
        return;
    }

    const ausentesHoy = estudiantes.filter(e => e.estado === 'falto');
    const nombresAusentesHoy = ausentesHoy.map(e => e.nombre);
    const detallesAusentesHoy = ausentesHoy.map(e => ({ nombre: e.nombre, nota: e.justificacion || '' }));

    if (!historialGrados[gradoActual]) {
        historialGrados[gradoActual] = [];
    }

    const indiceFecha = historialGrados[gradoActual].findIndex(reg => reg.fecha === fechaSeleccionadaTexto);

    if (indiceFecha >= 0) {
        if (nombresAusentesHoy.length > 0) {
            historialGrados[gradoActual][indiceFecha].ausentes = nombresAusentesHoy;
            historialGrados[gradoActual][indiceFecha].detalles = detallesAusentesHoy;
        } else {
            historialGrados[gradoActual].splice(indiceFecha, 1);
        }
    } else {
        if (nombresAusentesHoy.length > 0) {
            historialGrados[gradoActual].push({
                fecha: fechaSeleccionadaTexto,
                ausentes: nombresAusentesHoy,
                detalles: detallesAusentesHoy
            });
        }
    }

    recalcularFaltasTotales();
    guardarEnMemoria();
    renderizarTabla();
    renderizarHistorial();

    const panelWhatsApp = document.getElementById('whatsapp-panel');
    const listaAusentes = document.getElementById('lista-ausentes');
    listaAusentes.innerHTML = '';

    if (ausentesHoy.length === 0) {
        panelWhatsApp.style.display = 'block';
        listaAusentes.innerHTML = `<li>¡Excelente asistencia en el grado ${gradoActual}! No hay estudiantes ausentes para el ${fechaSeleccionadaTexto}.</li>`;
        alert(`¡Registro guardado! Asistencia perfecta.`);
        return;
    }

    ausentesHoy.forEach(estudiante => {
        let telefonoLimpio = estudiante.telefono.replace(/\D/g, '');
        let motivoTexto = estudiante.justificacion ? ` Motivo/Nota: ${estudiante.justificacion}.` : '';
        let mensaje = `Cordial saludo, estimado padre de familia. Le informamos desde la Institución Educativa Media Académica Sagrado Corazón De Jesús que el estudiante ${estudiante.nombre} (Grado ${gradoActual}) registró inasistencia el día ${fechaSeleccionadaTexto}.${motivoTexto} Agradecemos su atención.`;
        let mensajeCodificado = encodeURIComponent(mensaje);
        let linkWhatsApp = `https://wa.me/${telefonoLimpio}?text=${mensajeCodificado}`;

        const li = document.createElement('li');
        li.innerHTML = `
            <strong>${estudiante.nombre}</strong> (Faltas acumuladas: ${estudiante.faltas}) ${estudiante.justificacion ? '— <em>[' + estudiante.justificacion + ']</em>' : ''}<br>
            <a href="${linkWhatsApp}" target="_blank" class="btn-whatsapp btn-link-wa">Enviar WhatsApp de Inasistencia</a>
        `;
        listaAusentes.appendChild(li);
    });

    panelWhatsApp.style.display = 'block';
    alert(`¡Registro guardado y actualizado con éxito!`);
}

// 3. APERTURA RÁPIDA / EN MASIVO
function enviarReporteMasivoWhatsApp() {
    const links = document.querySelectorAll('.btn-link-wa');
    if (links.length === 0) return;

    if (confirm(`Se abrirán ${links.length} pestañas para enviar los mensajes de WhatsApp uno por uno. ¿Deseas continuar?`)) {
        links.forEach((link, idx) => {
            setTimeout(() => {
                window.open(link.href, '_blank');
            }, idx * 1000); // Abre con 1 segundo de diferencia para que el navegador no los bloquee
        });
    }
}

function eliminarRegistroHistorial(index) {
    if (confirm("¿Estás seguro de que deseas eliminar este registro del historial? Se descontarán las faltas asociadas.")) {
        historialGrados[gradoActual].splice(index, 1);
        recalcularFaltasTotales();
        guardarEnMemoria();
        renderizarTabla();
        renderizarHistorial();
        alert("Registro eliminado y contadores actualizados correctamente.");
    }
}

// Inicialización
actualizarPantallaAcceso();
document.getElementById('login-screen').hidden = false;
inicializarRespaldoExcel();
inicializarPestañas();
actualizarArchivoCargado();
renderizarTabla();
renderizarHistorial();
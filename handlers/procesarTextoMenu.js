const { obtenerConversacionDeDB, actualizarObservaciones, guardarConversacionEnDB } = require('../utils/dbAPI');
const { limpiarDuplicados, extraerUserId, obtenerTextoMensaje, logInfo, logError } = require('../utils/shared');
const ValidationService = require('../utils/validation');
const MessageService = require('../services/messageService');
const { promptInstitucional } = require('../utils/prompt');
const { sendMessage } = require('../utils/sendMessage');
const { consultarInformacionPaciente } = require('../utils/consultarPaciente');
const { marcarPagado } = require('../utils/marcarPagado');
const { sendPdf, generarPdfDesdeApi2Pdf } = require('../utils/pdf');
const { esCedula } = require('../utils/validaciones');

/**
 * Función auxiliar para enviar mensaje y guardar en base de datos
 */
async function enviarYGuardar(to, userId, nombre, mensaje, historial, nivel) {
    try {
        await sendMessage(to, mensaje);
        
        const nuevoHistorial = limpiarDuplicados([
            ...historial,
            {
                from: "sistema",
                mensaje: mensaje,
                timestamp: new Date().toISOString()
            }
        ]);
        
        await guardarConversacionEnDB({
            userId: userId,
            nombre: nombre,
            mensajes: nuevoHistorial,
            nivel: nivel
        });
        
        logInfo('procesarTextoMenu', 'Mensaje enviado y guardado', { to, nivel, mensaje: mensaje.substring(0, 50) });
        
    } catch (error) {
        logError('procesarTextoMenu', 'Error en enviarYGuardar', { to, error });
        throw error;
    }
}

/**
 * Maneja respuestas con IA cuando el usuario selecciona "Otra pregunta"
 */
async function manejarOtraPregunta(userId, nombre, to, mensajeLimpio, historial) {
    try {
        // Usar OpenAI directamente como en faseHandlers.js
        const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
        
        const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: promptInstitucional },
                    // Incluir últimos 15 mensajes para mejor contexto
                    ...historial.slice(-15).map(m => ({
                        role: m.from === "usuario" ? "user" : "assistant",
                        content: m.mensaje
                    })),
                    { role: 'user', content: mensajeLimpio }
                ],
                max_tokens: 300,
                temperature: 0.3
            })
        });

        const openaiJson = await aiRes.json();
        const respuestaBot = openaiJson.choices?.[0]?.message?.content || "¿En qué más puedo ayudarte?";

        // Agregar opción de volver al menú
        const respuestaConMenu = respuestaBot + "\n\n¿Necesitas algo más?\n0️⃣ Volver al menú principal";

        await enviarYGuardar(to, userId, nombre, respuestaConMenu, historial, 'pregunta_ia');
        
        return { success: true, respuesta: respuestaConMenu };
        
    } catch (error) {
        logError('procesarTextoMenu', 'Error en manejarOtraPregunta', { userId, error });
        
        // Fallback cuando la IA no está disponible
        const respuestaFallback = `❌ Lo siento, el sistema de respuestas inteligentes no está disponible en este momento.

Para tu pregunta: "${mensajeLimpio}"

Te recomiendo:
• Revisar nuestro menú principal con las opciones más comunes
• Contactar directamente a un asesor

¿Necesitas algo más?
0️⃣ Volver al menú principal`;

        await enviarYGuardar(to, userId, nombre, respuestaFallback, historial, 'pregunta_ia');
        
        return { success: true, respuesta: respuestaFallback };
    }
}

/**
 * Marca automáticamente como STOP cuando el admin envía mensaje específico
 */
async function marcarStopAutomatico(userId) {
    try {
        await actualizarObservaciones(userId, "stop");
        logInfo('procesarTextoMenu', 'STOP marcado automáticamente por mensaje de admin', { userId });
        return { success: true };
    } catch (error) {
        logError('procesarTextoMenu', 'Error marcando STOP automático', { userId, error });
        return { success: false, error: error.message };
    }
}

/**
 * FUNCIÓN PRINCIPAL - Sistema de menús numéricos con opción de IA
 */
async function procesarTextoMenu(message, res) {
    try {
        const from = message.from;
        const nombre = message.from_name || "Usuario";
        const to = from;
        const userMessage = obtenerTextoMensaje(message);
        const userId = extraerUserId(from);

        // Validar mensaje de entrada
        const validacionMensaje = ValidationService.validarMensajeTexto(userMessage, 500);
        if (!validacionMensaje.isValid) {
            logError('procesarTextoMenu', `Mensaje inválido: ${validacionMensaje.error}`, { userId });
            
            await MessageService.enviarMensajeSimple(to,
                `❌ ${validacionMensaje.error}. Por favor envía un mensaje válido.`
            );
            
            return res.status(400).json({ 
                success: false, 
                error: validacionMensaje.error,
                context: 'message_validation'
            });
        }

        const mensajeLimpio = validacionMensaje.sanitized.trim();

        logInfo('procesarTextoMenu', 'Procesando mensaje con sistema de menús', {
            userId,
            nombre,
            messagePreview: mensajeLimpio.substring(0, 50),
            originalLength: userMessage.length
        });

        // 1. Obtener historial de conversación y nivel actual
        const { mensajes: historial = [], observaciones = "", nivel = 0 } = 
            await obtenerConversacionDeDB(userId);
        const historialLimpio = limpiarDuplicados(historial);

        // 2. Verificar si el usuario está bloqueado
        if (MessageService.estaUsuarioBloqueado(observaciones)) {
            logInfo('procesarTextoMenu', 'Usuario bloqueado por observaciones STOP', { userId });
            return res.json({ success: true, mensaje: "Usuario bloqueado por observaciones." });
        }

        // 3. Agregar mensaje del usuario al historial
        const historialActualizado = MessageService.agregarMensajeUsuario(
            userId, 
            mensajeLimpio, 
            nombre, 
            historialLimpio
        );

        // 4. Manejar comandos especiales de transferencia
        if (mensajeLimpio.toLowerCase().includes("transfiriendo con asesor")) {
            await marcarStopAutomatico(userId);
            return res.json({ success: true, mensaje: "Bot detenido - transferido a asesor" });
        }

        let response = "";
        let nuevoNivel = nivel;

        // 5. Sistema de menús basado en niveles
        if (nivel === 0 || mensajeLimpio === "0") {
            // MENÚ PRINCIPAL
            response = `👋 ¡Hola ${nombre}!\n\nEscribe el *número* de la opción que necesitas:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Ya tengo mi examen (pagar/descargar)\n3️⃣ Consultar estado de mi cita\n4️⃣ Otra pregunta`;
            nuevoNivel = 1;
            
        } else if (nivel === 1) {
            // PROCESANDO OPCIÓN DEL MENÚ PRINCIPAL
            switch(mensajeLimpio) {
                case "1":
                    response = `🩺 *Exámenes Ocupacionales*\n\nTenemos dos modalidades:\n\n1️⃣ Virtual ($46.000)\n2️⃣ Presencial ($69.000)\n3️⃣ ¿Qué incluyen los exámenes?\n4️⃣ Otra pregunta\n0️⃣ Menú anterior`;
                    nuevoNivel = 2;
                    break;
                    
                case "2":
                    response = `💳 *Proceso de Pago*\n\n¿Ya revisaste tu certificado?\n\n1️⃣ Sí, está correcto - ver datos de pago\n2️⃣ Hay un error en mi certificado\n3️⃣ No he podido revisarlo\n4️⃣ Otra pregunta\n0️⃣ Menú anterior`;
                    nuevoNivel = 3;
                    break;
                    
                case "3":
                    response = `📅 *Consultar Estado de Cita*\n\nPor favor escribe tu número de documento (solo números, sin puntos).\n\n4️⃣ Tengo otra pregunta\n0️⃣ Menú principal`;
                    nuevoNivel = 'esperando_cedula';
                    break;
                    
                case "4":
                    response = `💬 *¿Cuál es tu pregunta?*\n\nEscríbela y te ayudaré con gusto.`;
                    nuevoNivel = 'pregunta_ia';
                    break;
                    
                default:
                    response = `❌ Por favor selecciona una opción válida:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Ya tengo mi examen (pagar/descargar)\n3️⃣ Consultar estado de mi cita\n4️⃣ Otra pregunta`;
                    nuevoNivel = 1;
            }
            
        } else if (nivel === 2) {
            // SUBMENU DE EXÁMENES
            switch(mensajeLimpio) {
                case "1":
                    response = `💻 *Examen Virtual ($46.000)*\n\n✅ 100% online desde cualquier lugar\n⏰ Disponible 7am-7pm todos los días\n⏱️ Duración: 35 minutos total\n📋 Incluye: Médico, audiometría, optometría\n\n📍 Agenda aquí: https://www.bsl.com.co/nuevaorden-1\n\n1️⃣ Ya agendé, ¿qué sigue?\n2️⃣ Tengo problemas para agendar\n4️⃣ Otra pregunta\n0️⃣ Menú anterior`;
                    nuevoNivel = 4;
                    break;
                    
                case "2":
                    response = `🏥 *Examen Presencial ($69.000)*\n\n📍 Calle 134 No. 7-83, Bogotá\n⏰ L-V: 7am-4pm | Sáb: 8am-11am\n📋 Incluye: Médico, audiometría, optometría\n🚶 No requiere cita - Por orden de llegada\n\n1️⃣ ¿Cómo llego?\n2️⃣ ¿Qué debo llevar?\n4️⃣ Otra pregunta\n0️⃣ Menú anterior`;
                    nuevoNivel = 5;
                    break;
                    
                case "3":
                    response = `📋 *Los exámenes incluyen:*\n\n✅ Médico Osteomuscular\n✅ Audiometría\n✅ Optometría\n\n*Adicionales opcionales:*\n• Cardiovascular ($5.000)\n• Vascular ($5.000)\n• Espirometría ($5.000)\n• Psicológico ($15.000)\n• Dermatológico ($5.000)\n• Perfil lipídico ($60.000)\n• Glicemia ($20.000)\n\n1️⃣ Quiero agendar virtual\n2️⃣ Prefiero presencial\n4️⃣ Otra pregunta\n0️⃣ Menú anterior`;
                    nuevoNivel = 2;
                    break;
                    
                case "4":
                    response = `💬 *¿Cuál es tu pregunta sobre los exámenes?*\n\nEscríbela y te ayudaré con gusto.`;
                    nuevoNivel = 'pregunta_ia';
                    break;
                    
                case "0":
                    response = `👋 ¡Hola ${nombre}!\n\nEscribe el *número* de la opción que necesitas:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Ya tengo mi examen (pagar/descargar)\n3️⃣ Consultar estado de mi cita\n4️⃣ Otra pregunta`;
                    nuevoNivel = 1;
                    break;
                    
                default:
                    response = `❌ Por favor selecciona una opción válida:\n\n1️⃣ Virtual ($46.000)\n2️⃣ Presencial ($69.000)\n3️⃣ ¿Qué incluyen?\n4️⃣ Otra pregunta\n0️⃣ Menú anterior`;
                    nuevoNivel = 2;
            }
            
        } else if (nivel === 3) {
            // SUBMENU DE PAGO
            switch(mensajeLimpio) {
                case "1":
                    response = `💳 *Datos para el pago:*\n\n*Bancolombia:*\nAhorros 44291192456\nCédula: 79981585\n\n*Daviplata:* 3014400818\n*Nequi:* 3008021701\n\n📱 Envía tu comprobante de pago por aquí y luego tu número de cédula.\n\n4️⃣ Tengo otra pregunta\n0️⃣ Menú principal`;
                    nuevoNivel = 'esperando_pago';
                    break;
                    
                case "2":
                case "3":
                    await marcarStopAutomatico(userId);
                    response = `🔄 ...transfiriendo con asesor para ayudarte con tu certificado`;
                    nuevoNivel = 0;
                    break;
                    
                case "4":
                    response = `💬 *¿Cuál es tu pregunta sobre el pago?*\n\nEscríbela y te ayudaré con gusto.`;
                    nuevoNivel = 'pregunta_ia';
                    break;
                    
                case "0":
                    response = `👋 ¡Hola ${nombre}!\n\nEscribe el *número* de la opción que necesitas:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Ya tengo mi examen (pagar/descargar)\n3️⃣ Consultar estado de mi cita\n4️⃣ Otra pregunta`;
                    nuevoNivel = 1;
                    break;
                    
                default:
                    response = `❌ Por favor selecciona una opción válida:\n\n1️⃣ Ver datos de pago\n2️⃣ Hay error en certificado\n3️⃣ No puedo revisar certificado\n4️⃣ Otra pregunta\n0️⃣ Menú anterior`;
                    nuevoNivel = 3;
            }
            
        } else if (nivel === 'pregunta_ia') {
            // Usuario está en modo pregunta libre con IA
            if (mensajeLimpio === "0") {
                response = `👋 ¡Hola ${nombre}!\n\nEscribe el *número* de la opción que necesitas:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Ya tengo mi examen (pagar/descargar)\n3️⃣ Consultar estado de mi cita\n4️⃣ Otra pregunta`;
                nuevoNivel = 1;
            } else {
                // Usar IA para responder
                const resultado = await manejarOtraPregunta(userId, nombre, to, mensajeLimpio, historialActualizado);
                return res.json(resultado);
            }
            
        } else if (nivel === 'esperando_cedula') {
            // Esperando cédula para consulta
            if (esCedula(mensajeLimpio)) {
                try {
                    await enviarYGuardar(to, userId, nombre, "🔍 Un momento, consultando tu información...", historialActualizado, nivel);
                    
                    const infoPaciente = await consultarInformacionPaciente(mensajeLimpio);
                    
                    if (infoPaciente && infoPaciente.length > 0) {
                        const paciente = infoPaciente[0];
                        response = `✅ *Información de tu cita:*\n\nNombre: ${paciente.nombre}\nFecha: ${paciente.fecha}\nHora: ${paciente.hora}\nEstado: ${paciente.atendido}\n\n1️⃣ Tengo otra consulta\n0️⃣ Menú principal`;
                    } else {
                        response = `❌ No encontré información con ese documento.\n\n1️⃣ Intentar con otro documento\n2️⃣ Hablar con un asesor\n0️⃣ Menú principal`;
                    }
                    nuevoNivel = 6;
                } catch (error) {
                    logError('procesarTextoMenu', 'Error consultando paciente', { userId, error });
                    response = `❌ Hubo un error consultando tu información. Por favor intenta más tarde.\n\n0️⃣ Menú principal`;
                    nuevoNivel = 1;
                }
            } else if (mensajeLimpio === "4") {
                response = `💬 *¿Cuál es tu pregunta?*\n\nEscríbela y te ayudaré con gusto.`;
                nuevoNivel = 'pregunta_ia';
            } else if (mensajeLimpio === "0") {
                response = `👋 ¡Hola ${nombre}!\n\nEscribe el *número* de la opción que necesitas:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Ya tengo mi examen (pagar/descargar)\n3️⃣ Consultar estado de mi cita\n4️⃣ Otra pregunta`;
                nuevoNivel = 1;
            } else {
                response = `❌ Por favor escribe un número de documento válido (solo números).\n\n4️⃣ Tengo otra pregunta\n0️⃣ Menú principal`;
                nuevoNivel = 'esperando_cedula';
            }
            
        } else if (nivel === 'esperando_pago') {
            // Esperando comprobante y cédula
            if (esCedula(mensajeLimpio)) {
                try {
                    await enviarYGuardar(to, userId, nombre, "🔍 Procesando tu pago...", historialActualizado, nivel);
                    
                    const infoPaciente = await consultarInformacionPaciente(mensajeLimpio);
                    
                    if (infoPaciente && infoPaciente.length > 0 && infoPaciente[0].atendido === "ATENDIDO") {
                        await marcarPagado(mensajeLimpio);
                        const pdfUrl = await generarPdfDesdeApi2Pdf(mensajeLimpio);
                        await sendPdf(to, pdfUrl, mensajeLimpio);
                        response = `✅ ¡Certificado enviado! Revisa tu WhatsApp.\n\n0️⃣ Menú principal`;
                        nuevoNivel = 1;
                    } else {
                        await marcarPagado(mensajeLimpio);
                        response = `✅ Pago registrado. Un asesor te contactará pronto para completar el proceso.\n\n0️⃣ Menú principal`;
                        nuevoNivel = 1;
                    }
                } catch (error) {
                    logError('procesarTextoMenu', 'Error procesando pago', { userId, error });
                    await marcarStopAutomatico(userId);
                    response = `🔄 ...transfiriendo con asesor para ayudarte con el pago`;
                    nuevoNivel = 0;
                }
            } else if (mensajeLimpio === "4") {
                response = `💬 *¿Cuál es tu pregunta?*\n\nEscríbela y te ayudaré con gusto.`;
                nuevoNivel = 'pregunta_ia';
            } else if (mensajeLimpio === "0") {
                response = `👋 ¡Hola ${nombre}!\n\nEscribe el *número* de la opción que necesitas:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Ya tengo mi examen (pagar/descargar)\n3️⃣ Consultar estado de mi cita\n4️⃣ Otra pregunta`;
                nuevoNivel = 1;
            } else {
                response = `📱 Por favor envía tu comprobante de pago y luego tu número de cédula.\n\n4️⃣ Tengo otra pregunta\n0️⃣ Menú principal`;
                nuevoNivel = 'esperando_pago';
            }
            
        } else if (nivel === 4) {
            // Submenu post-agendamiento virtual
            switch(mensajeLimpio) {
                case "1":
                    response = `📝 *Proceso después de agendar:*\n\n1️⃣ Recibirás un email de confirmación\n2️⃣ A la hora agendada, ingresa al link\n3️⃣ Realiza las pruebas (25 min)\n4️⃣ El médico te llamará (10 min)\n5️⃣ Revisa tu certificado\n6️⃣ Realiza el pago\n7️⃣ ¡Descarga tu certificado!\n\n4️⃣ Otra pregunta\n0️⃣ Menú principal`;
                    nuevoNivel = 1;
                    break;
                    
                case "2":
                    response = `🔧 *Solución de problemas:*\n\n1️⃣ Recarga la página\n2️⃣ Limpia caché del navegador\n3️⃣ Usa Chrome o Safari actualizados\n4️⃣ Verifica tu conexión a internet\n\n¿Se solucionó?\n\n1️⃣ Sí, gracias\n2️⃣ No, necesito ayuda\n4️⃣ Otra pregunta\n0️⃣ Menú anterior`;
                    nuevoNivel = 7;
                    break;
                    
                case "4":
                    response = `💬 *¿Cuál es tu pregunta?*\n\nEscríbela y te ayudaré con gusto.`;
                    nuevoNivel = 'pregunta_ia';
                    break;
                    
                case "0":
                    response = `🩺 *Exámenes Ocupacionales*\n\nTenemos dos modalidades:\n\n1️⃣ Virtual ($46.000)\n2️⃣ Presencial ($69.000)\n3️⃣ ¿Qué incluyen los exámenes?\n4️⃣ Otra pregunta\n0️⃣ Menú anterior`;
                    nuevoNivel = 2;
                    break;
                    
                default:
                    response = `❌ Por favor selecciona una opción válida:\n\n1️⃣ Ya agendé, ¿qué sigue?\n2️⃣ Problemas para agendar\n4️⃣ Otra pregunta\n0️⃣ Menú anterior`;
                    nuevoNivel = 4;
            }
            
        } else {
            // Estado desconocido o casos adicionales - resetear al menú principal
            response = `👋 ¡Hola ${nombre}!\n\nEscribe el *número* de la opción que necesitas:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Ya tengo mi examen (pagar/descargar)\n3️⃣ Consultar estado de mi cita\n4️⃣ Otra pregunta`;
            nuevoNivel = 1;
        }

        // 6. Enviar respuesta y guardar conversación actualizada
        await enviarYGuardar(to, userId, nombre, response, historialActualizado, nuevoNivel);

        logInfo('procesarTextoMenu', 'Respuesta enviada exitosamente', { 
            userId, 
            nivel: nuevoNivel,
            responseLength: response.length 
        });

        return res.json({ 
            success: true, 
            respuesta: response,
            nivel: nuevoNivel,
            approach: "menu-system"
        });

    } catch (error) {
        const userId = extraerUserId(message.from);
        logError('procesarTextoMenu', 'Error general procesando texto', { 
            userId, 
            error,
            messageType: message.type 
        });

        // Intentar enviar mensaje de error al usuario
        try {
            await MessageService.enviarMensajeSimple(message.from, 
                "❌ Hubo un problema procesando tu mensaje. Por favor intenta de nuevo."
            );
        } catch (sendError) {
            logError('procesarTextoMenu', 'Error enviando mensaje de error', { userId, error: sendError });
        }

        return res.status(500).json({ 
            success: false, 
            error: error.message,
            context: 'procesarTextoMenu'
        });
    }
}

module.exports = { procesarTextoMenu };
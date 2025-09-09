const BOT_NUMBER = "573008021701";

export function post_handleInput(request) {
    return request.body.json()
        .then(async (body) => {
            if (body && body.statuses && Array.isArray(body.statuses)) {
                console.log("Body recibido:", JSON.stringify(body, null, 2));
                return {
                    status: 200,
                    body: { message: "Evento de estado procesado correctamente." }
                };
            }

            if (!body || !body.messages || !Array.isArray(body.messages)) {
                return {
                    status: 200,
                    body: { message: "Solicitud ignorada: el payload no contiene mensajes." }
                };
            }

            const messages = body.messages;

            for (const message of messages) {
                const from = message && message.from ? message.from.trim() : null;
                const bodyText = (message && message.text && message.text.body ? message.text.body.trim() : null) || "Sin mensaje";
                const profileName = (message && message.from_name ? message.from_name.trim() : null) || "Nombre Desconocido";
                const fromMe = message && message.from_me ? message.from_me : false;
                
                // Detectar si el mensaje contiene una imagen
                const hasImage = message && (message.image || message.media_url || message.type === 'image');
                
                // Detectar si el mensaje viene de un grupo de WhatsApp
                const chatId = message && message.chat_id ? message.chat_id : null;
                const isGroupMessage = (chatId && chatId.includes('@g.us')) || 
                                     (from && from.includes('@g.us')) ||
                                     (message.group_id) ||
                                     (message.is_group) ||
                                     (chatId && chatId !== from);
                
                // Si el mensaje viene de un grupo, ignorarlo completamente
                if (isGroupMessage) {
                    console.log(`📱 Mensaje de grupo detectado. Ignorando mensaje de ${from}. ChatId: ${chatId}`);
                    continue; // No procesar mensajes de grupos
                }

                if (from === BOT_NUMBER && fromMe) {
                    const chatIdBot = message && message.chat_id ? message.chat_id.split("@")[0].trim() : null;
                    if (!chatIdBot) continue;

                    const queryResult = await wixData.query("WHP").eq("userId", chatIdBot).find();
                    if (queryResult.items.length > 0) {
                        const existingConversation = queryResult.items[0];
                        if (bodyText === "...transfiriendo con asesor") {
                            existingConversation.stopBot = true;
                        } else if (bodyText === "...te dejo con el bot 🤖") {
                            existingConversation.stopBot = false;
                        }
                        await wixData.update("WHP", existingConversation);
                    }
                    continue;
                }

                if (from === BOT_NUMBER || fromMe) continue;
                if (!from || !bodyText) continue;

                let existingConversation;
                try {
                    const queryResult = await wixData.query("WHP").eq("userId", from).find();
                    if (queryResult.items.length > 0) {
                        existingConversation = queryResult.items[0];
                    }
                } catch (error) {
                    console.error("Error consultando la conversación existente:", error);
                }

                let conversation;
                if (existingConversation) {
                    conversation = existingConversation;
                } else {
                    conversation = {
                        userId: from,
                        nombre: profileName,
                        mensajes: [],
                        nivel: 0,
                        stopBot: false
                    };
                }

                // Si el mensaje contiene una imagen, detener el bot inmediatamente
                if (hasImage) {
                    conversation.stopBot = true;
                    if (existingConversation) {
                        await wixData.update("WHP", conversation);
                    } else {
                        await wixData.insert("WHP", conversation);
                    }
                    console.log(`🖼️ Imagen detectada de ${from}. Bot detenido (stopBot = true)`);
                    continue;
                }

                if (bodyText === "Ya terminé mis la pruebas") {
                    conversation.stopBot = true;
                    const saved = existingConversation ?
                        await wixData.update("WHP", conversation) :
                        await wixData.insert("WHP", conversation);

                    setTimeout(async () => {
                        try {
                            const conv = await wixData.get("WHP", saved._id);
                            conv.stopBot = false;
                            await wixData.update("WHP", conv);
                            console.log(`✅ Bot reactivado para ${conv.userId}`);
                        } catch (err) {
                            console.error("❌ Error reactivando bot:", err);
                        }
                    }, 50000);
                    continue;
                }

                if (conversation.stopBot) continue;

                let response = "";

                if (conversation.nivel === 0) {
                    response = `¡Hola!\nEscribe el *número* de opción:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Pagar y Descargar\n3️⃣ ¿Otra pregunta?`;
                    conversation.nivel = 1;
                } else if (conversation.nivel === 1) {
                    if (bodyText === "1") {
                        response = `*Tenemos dos opciones:*\n\n1️⃣ Virtual ($ 46.000)\n2️⃣ Presencial ($ 69.000)\n3️⃣ Menú anterior\n4️⃣ ¿Otra pregunta?`;
                        conversation.nivel = 2;
                    } else if (bodyText === "2") {
                        response = `Paga $46.000 en las siguientes cuentas:\n\n*Bancolombia*\nCta Ahorros: 442 9119 2456\nCédula: 79 981 585\n\n*Daviplata:* 301 440 0818\n\n*Nequi:* 300 802 1701\n\nCuándo lo hagas *envía el soporte de pago por acá*`;
                        conversation.nivel = 1;
                        conversation.stopBot = true;
                    } else if (bodyText === "3") {
                        response = `¿Cuál es tu pregunta? Escribe tu consulta y te ayudaré.`;
                        conversation.nivel = 5; // Nivel especial para manejar preguntas de OpenAI
                    } else {
                        response = `Por favor selecciona una opción:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Pagar y Descargar\n3️⃣ ¿Otra pregunta?`;
                    }
                } else if (conversation.nivel === 2) {
                    if (bodyText === "1") {
                        response = `*¿Cómo funciona Virtual?*\n\n- Escoge la hora\n- Realiza las pruebas\n- El médico te contactará\n- Paga (Bcolombia, Nequi, Daviplata)\n\n*¡Listo!* Descarga tu certificado al instante.\n\n*Escoge la opción:*\n1️⃣ Agendar\n2️⃣ ¿Qué Incluye?\n3️⃣ Menú Anterior\n4️⃣ ¿Otra pregunta?`;
                        conversation.nivel = 3;
                    } else if (bodyText === "2") {
                        response = `*Presencial $ 69.000*\n\n*Bienestar y Salud Laboral*\n*Dirección:*\nCalle 134 No. 7-83\n\n*Horarios:*\nLunes a Viernes: 7:30 AM - 4:30 PM\nSábados: 8:00 AM - 11:30\n\n_No necesitas agendar_. Es por orden de llegada.\n\n*Escoge la opción:*\n1️⃣ ¿Qué Incluye?\n2️⃣ Virtual\n3️⃣ Menú Anterior\n4️⃣ ¿Otra pregunta?`;
                        conversation.nivel = 4;
                    } else if (bodyText === "3") {
                        response = `¡Hola!\nEscribe el *número* de opción:\n1️⃣ Exámenes Ocupacionales\n2️⃣ Pagar y Descargar\n3️⃣ Otros\n4️⃣ ¿Otra pregunta?`;
                        conversation.nivel = 1;
                    } else if (bodyText === "4") {
                        response = `¿Cuál es tu pregunta? Escribe tu consulta y te ayudaré.`;
                        conversation.nivel = 5; // Nivel especial para manejar preguntas de OpenAI
                    } else {
                        response = `Por favor selecciona una opción:\n1️⃣ Virtual ($ 46.000)\n2️⃣ Presencial ($ 69.000)\n3️⃣ Menú anterior\n4️⃣ ¿Otra pregunta?`;
                    }
                } else if (conversation.nivel === 3) {
                    if (bodyText === "1") {
                        response = `Para comenzar haz clic:\n\n*https://www.bsl.com.co/nuevaorden-1*`;
                        conversation.nivel = 0;
                    } else if (bodyText === "2") {
                        response = `Tu certificado incluye:\n\n 🦴Médico Osteomuscular\n👂 Audiometría\n👁️ Optometría\n\nPuedes agregar adicional:\n🫀 Cardiovascular ($ 5.000)\n🩸 Vascular ($ 5.000)\n🫁 Espirometría ($ 5.000)\n🧠 Psicológico ($ 15.000)\n🏻 Dermatológico ($ 5.000)\n💉 Perfil lipídico y otros laboratorios\n\n*Escoge la opción:*\n1️⃣ Agendar\n3️⃣ Menú Anterior\n4️⃣ ¿Otra pregunta?`;
                        conversation.nivel = 3;
                    } else if (bodyText === "3") {
                        response = `*Tenemos dos opciones:*\n1️⃣ Virtual ($ 46.000)\n2️⃣ Presencial ($ 69.000)\n3️⃣ Menú anterior\n4️⃣ ¿Otra pregunta?`;
                        conversation.nivel = 2;
                    } else if (bodyText === "4") {
                        response = `¿Cuál es tu pregunta? Escribe tu consulta y te ayudaré.`;
                        conversation.nivel = 5; // Nivel especial para manejar preguntas de OpenAI
                    } else {
                        response = `Por favor selecciona una opción:\n1️⃣ Agendar\n2️⃣ ¿Qué Incluye?\n3️⃣ Menú Anterior\n4️⃣ ¿Otra pregunta?`;
                    }
                } else if (conversation.nivel === 4) {
                    if (bodyText === "1") {
                        response = `Tu certificado incluye:\n\n 🦴Médico Osteomuscular\n👂 Audiometría\n👁️ Optometría\n\nPuedes agregar adicional:\n🫀 Cardiovascular ($ 5.000)\n🩸 Vascular ($ 5.000)\n🫁 Espirometría ($ 5.000)\n🧠 Psicológico ($ 15.000)\n🏻 Dermatológico ($ 5.000)\n💉 Perfil lipídico y otros laboratorios\n\n*Escoge la opción:*\n1️⃣ ¿Qué Incluye?\n2️⃣ Virtual\n3️⃣ Menú Anterior\n4️⃣ ¿Otra pregunta?`;
                        conversation.nivel = 4;
                    } else if (bodyText === "2") {
                        response = `*¿Cómo funciona Virtual?*\n\n1️⃣ Escoge la hora\n2️⃣ Realiza las pruebas\n3️⃣ El médico te contactará\n4️⃣ Paga (Bancolombia, Nequi, Daviplata)\n\n*¡Listo!* Descarga tu certificado al instante.\n\n*Escoge la opción:*\n1️⃣ Agendar\n2️⃣ ¿Qué Incluye?\n3️⃣ Menú Anterior\n4️⃣ ¿Otra pregunta?`;
                        conversation.nivel = 3;
                    } else if (bodyText === "3") {
                        response = `*Tenemos dos opciones:*\n1️⃣ Virtual ($ 46.000)\n2️⃣ Presencial ($ 69.000)\n3️⃣ Menú anterior\n4️⃣ ¿Otra pregunta?`;
                        conversation.nivel = 2;
                    } else if (bodyText === "4") {
                        response = `¿Cuál es tu pregunta? Escribe tu consulta y te ayudaré.`;
                        conversation.nivel = 5; // Nivel especial para manejar preguntas de OpenAI
                    } else {
                        response = `Por favor selecciona una opción:\n1️⃣ ¿Qué Incluye?\n2️⃣ Virtual\n3️⃣ Menú Anterior\n4️⃣ ¿Otra pregunta?`;
                    }
                } else if (conversation.nivel === 5) {
                    // Nivel especial para preguntas de OpenAI
                    
                    // Detectar si el usuario indica que ya agendó directamente
                    const agendaKeywords = ["ya agendé", "agendé", "listo", "agendado", "hecho", "completé", "terminé de agendar"];
                    const userSaysAgendaComplete = agendaKeywords.some(keyword => 
                        bodyText.toLowerCase().includes(keyword.toLowerCase())
                    );
                    
                    if (userSaysAgendaComplete) {
                        response = `¡Perfecto! Ya tienes tu cita agendada. 👍\n\nAhora realiza tus exámenes virtuales y el médico revisará tu certificado. Una vez aprobado, recibirás las instrucciones de pago.\n\n¡Nos vemos en tu consulta virtual! 👨‍⚕️`;
                        conversation.stopBot = true;
                    } else {
                        try {
                        const systemPrompt = `Eres el asistente virtual de BSL para exámenes médicos ocupacionales en Colombia. 

🎯 REGLAS FUNDAMENTALES:
- NUNCA te presentes como BSL si ya estás en una conversación activa
- Responde en frases cortas y claras, sin tecnicismos
- Si el usuario ya recibió información específica, NO la repitas automáticamente
- Mantén el contexto de la conversación

🚨 CUÁNDO TRANSFERIR A ASESOR:
Si no entiendes algo, hay problemas técnicos, o el usuario lo solicita, responde EXACTAMENTE: "...transfiriendo con asesor" (SIN PUNTO FINAL). Esto detiene el bot.

📋 SERVICIOS DISPONIBLES:

**Exámenes Ocupacionales:**
• Virtual: $46.000 COP (7am-7pm, todos los días, 35 min total)
• Presencial: $69.000 COP (Calle 134 No. 7-83, Bogotá)

**Incluyen:** Médico osteomuscular, audiometría, optometría

**Para agendar virtual:** https://www.bsl.com.co/nuevaorden-1

**Exámenes extras opcionales:**
• Cardiovascular, Vascular, Espirometría, Dermatológico: $5.000 c/u
• Psicológico: $15.000
• Perfil lipídico: $60.000
• Glicemia: $20.000

**Medios de pago:**
• Bancolombia: Ahorros 44291192456 (cédula 79981585)
• Daviplata: 3014400818 (Mar Rea)
• Nequi: 3008021701 (Dan Tal)
• Transfiya

📌 FLUJO DEL PROCESO:
1. Usuario agenda en el link
2. Realiza pruebas virtuales (25 min)
3. Consulta médica (10 min)
4. Médico revisa y aprueba certificado
5. Usuario paga
6. Descarga certificado sin marca de agua

🎯 RESPUESTAS SEGÚN CONTEXTO:

**Si pregunta cómo hacer examen o info general:**
"🩺 Nuestras opciones:
Virtual – $46.000 COP
Presencial – $69.000 COP"

**Si el usuario responde "virtual" o algo similar:**
"Excelente elección! 🩺 Examen Virtual ($46.000)
📍 100% online desde cualquier lugar
⏰ Disponible 7am-7pm todos los días
⏱️ Duración: 35 minutos total
🔬 Incluye: Médico, audiometría, optometría

Agenda aquí: https://www.bsl.com.co/nuevaorden-1"

**Si el usuario responde "presencial":**
"Perfecto! 🏥 Examen Presencial ($69.000)
📍 Calle 134 No. 7-83, Bogotá
⏰ Horario según disponibilidad
📋 Incluye: Médico, audiometría, optometría

Agenda aquí: https://www.bsl.com.co/nuevaorden-1"

**IMPORTANTE: Si ya mostraste las opciones y el usuario eligió una, NO vuelvas a mostrar el menú de opciones.**

**Si pregunta por horarios de cita agendada:**
"Para confirmar tu horario necesito tu número de documento."

**Si pregunta por pago ANTES de hacer el examen:**
Explica que primero debe hacer el examen, luego el médico aprueba el certificado, y después se paga.

**Si el usuario dice "menú" o "volver al menú":**
Responde EXACTAMENTE: "VOLVER_AL_MENU" (sin explicaciones adicionales)

**Si el usuario indica que ya agendó (dice cosas como "ya agendé", "listo", "agendado", "hecho"):**
Responde algo como "¡Perfecto! Ya tienes tu cita agendada. Realiza tus exámenes y el médico revisará tu certificado." y luego responde EXACTAMENTE: "AGENDA_COMPLETADA"

Pregunta del usuario: ${bodyText}`;
                        
                        const aiResponse = await callOpenAI(systemPrompt, from);
                        
                        // Si OpenAI responde con transferencia a asesor, no agregar menú
                        if (aiResponse.includes("...transfiriendo con asesor")) {
                            response = aiResponse;
                            conversation.stopBot = true; // Detener el bot como indica la lógica
                        } else if (aiResponse.includes("VOLVER_AL_MENU")) {
                            response = `¡Hola!\nEscribe el *número* de opción:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Pagar y Descargar\n3️⃣ Otros\n4️⃣ ¿Otra pregunta?`;
                            conversation.nivel = 1; // Volver al menú principal
                        } else if (aiResponse.includes("AGENDA_COMPLETADA")) {
                            // Extraer solo la parte antes de "AGENDA_COMPLETADA"
                            response = aiResponse.replace("AGENDA_COMPLETADA", "").trim();
                            conversation.stopBot = true; // Detener el bot después de agenda completada
                        } else {
                            response = aiResponse;
                            // Mantener en nivel 5 para continuar conversación con AI
                            conversation.nivel = 5;
                        }
                    } catch (error) {
                        console.error("Error llamando a OpenAI:", error);
                        response = `Lo siento, no pude procesar tu consulta en este momento. Por favor intenta de nuevo más tarde.`;
                        // Mantener en nivel 5 para que pueda intentar otra pregunta
                        conversation.nivel = 5;
                        }
                    }
                } else if (conversation.nivel === 6) {
                    // Nivel después de respuesta de OpenAI
                    if (bodyText === "1") {
                        response = `¡Hola!\nEscribe el *número* de opción:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Pagar y Descargar\n3️⃣ Otros\n4️⃣ ¿Otra pregunta?`;
                        conversation.nivel = 1;
                    } else if (bodyText === "2") {
                        response = `¿Cuál es tu pregunta? Escribe tu consulta y te ayudaré.`;
                        conversation.nivel = 5;
                    } else {
                        response = `Por favor selecciona una opción:\n\n1️⃣ Menú Principal\n2️⃣ Otra pregunta`;
                    }
                }
                // Si no se generó ninguna respuesta por la lógica de niveles, asignar bienvenida por defecto
                if (!response || response.trim() === "") {
                    console.warn("❌ Se intentó enviar un mensaje vacío. Mensaje del usuario:", bodyText);

                    // Asignar un mensaje de bienvenida por defecto
                    response = `¡Hola! 👋\nEscribe el *número* de opción:\n\n1️⃣ Exámenes Ocupacionales\n2️⃣ Pagar y Descargar\n3️⃣ Otros\n4️⃣ ¿Otra pregunta?`;
                    conversation.nivel = 1;
                }

                conversation.mensajes.push({
                    from: "usuario",
                    mensaje: bodyText,
                    timestamp: new Date().toISOString()
                });

                conversation.mensajes.push({
                    from: "sistema",
                    mensaje: response,
                    timestamp: new Date().toISOString()
                });

                try {
                    if (existingConversation) {
                        await wixData.update("WHP", conversation);
                    } else {
                        delete conversation._id;
                        await wixData.insert("WHP", conversation);
                    }
                } catch (error) {
                    console.error("Error guardando la conversación:", error);
                    console.error("Conversación que falló:", JSON.stringify(conversation, null, 2));
                }

                try {
                    console.log(`📤 Enviando respuesta a ${from}: ${response.substring(0, 50)}...`);
                    await sendTextMessage(from, response);
                    console.log(`✅ Mensaje enviado exitosamente a ${from}`);
                } catch (sendError) {
                    console.error(`❌ Error enviando mensaje a ${from}:`, sendError);
                    console.error("Respuesta que no se pudo enviar:", response);
                }
            }

            return {
                status: 200,
                body: { message: "Mensajes procesados correctamente." }
            };
        })
        .catch(error => {
            console.error("Error procesando webhook:", error);
            return {
                status: 500,
                body: { message: "Error procesando el webhook." }
            };
        });
}
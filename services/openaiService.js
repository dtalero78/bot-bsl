const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { promptInstitucional } = require('../utils/prompt');
const { logError, logInfo, generarTimestamp } = require('../utils/shared');

/**
 * Servicio consolidado para operaciones con OpenAI
 * Maneja clasificación de imágenes, extracción de información y conversaciones
 */
class OpenAIService {
    
    constructor() {
        this.apiKey = process.env.OPENAI_KEY;
        this.baseUrl = "https://api.openai.com/v1/chat/completions";
        this.defaultModel = "gpt-4o";
        
        if (!this.apiKey) {
            throw new Error("OPENAI_KEY no está configurada");
        }
    }
    
    /**
     * Realiza una llamada genérica a OpenAI
     * @param {Object} params - Parámetros de la llamada
     * @returns {Object} - Respuesta de OpenAI
     */
    async llamarOpenAI(params) {
        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.defaultModel,
                    ...params
                })
            });

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            
            if (!result.choices || !result.choices[0]) {
                throw new Error("Respuesta inválida de OpenAI API");
            }

            return result;
            
        } catch (error) {
            logError('OpenAIService.llamarOpenAI', error, { 
                model: params.model || this.defaultModel,
                messagesCount: params.messages?.length
            });
            throw error;
        }
    }
    
    /**
     * Clasifica una imagen en una de las categorías predefinidas
     * @param {string} base64Image - Imagen en base64
     * @param {string} mimeType - Tipo MIME de la imagen
     * @returns {string} - Categoría clasificada
     */
    async clasificarImagen(base64Image, mimeType) {
        const prompt = `Clasifica esta imagen en UNA de estas categorías y responde SOLO la etiqueta:
• comprobante_pago (transferencias bancarias, recibos de pago, capturas de Nequi, Daviplata, etc.)
• listado_examenes (órdenes médicas, listas de exámenes solicitados)
• confirmacion_cita (capturas de agendamiento, confirmaciones de citas médicas)
• documento_identidad (cédula, pasaporte, documentos de identificación)
• otro (cualquier otra imagen)

Responde únicamente la etiqueta correspondiente.`;

        try {
            const result = await this.llamarOpenAI({
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { 
                            type: 'image_url', 
                            image_url: { url: `data:${mimeType};base64,${base64Image}` } 
                        }
                    ]
                }],
                max_tokens: 10
            });

            const clasificacion = result.choices[0].message.content.trim().toLowerCase();
            
            logInfo('OpenAIService.clasificarImagen', 
                `Imagen clasificada como: ${clasificacion}`,
                { mimeType }
            );
            
            return clasificacion;
            
        } catch (error) {
            logError('OpenAIService.clasificarImagen', error, { mimeType });
            return "otro"; // Valor por defecto en caso de error
        }
    }
    
    /**
     * Extrae información específica de un comprobante de pago
     * @param {string} base64Image - Imagen en base64
     * @param {string} mimeType - Tipo MIME de la imagen
     * @returns {Object} - Información extraída del comprobante
     */
    async extraerInformacionPago(base64Image, mimeType) {
        const prompt = `Analiza este comprobante de pago y extrae la siguiente información en formato JSON:

{
    "valor": "monto encontrado (solo números, sin símbolos)",
    "banco": "entidad financiera (si está visible)",
    "fecha": "fecha de la transacción (si está visible)",
    "referencia": "número de referencia o transacción (si está visible)"
}

Si no puedes encontrar algún campo, usa null. Para el valor, extrae SOLO los números sin puntos, comas o símbolos de moneda.`;

        try {
            const result = await this.llamarOpenAI({
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { 
                            type: 'image_url', 
                            image_url: { url: `data:${mimeType};base64,${base64Image}` } 
                        }
                    ]
                }],
                max_tokens: 150
            });

            const respuesta = result.choices[0].message.content.trim();
            
            try {
                const informacion = JSON.parse(respuesta);
                
                logInfo('OpenAIService.extraerInformacionPago', 
                    'Información extraída del comprobante',
                    { valor: informacion.valor, banco: informacion.banco }
                );
                
                return informacion;
                
            } catch (parseError) {
                // Si no se puede parsear como JSON, intentar extraer solo el valor
                const valorMatch = respuesta.match(/\d{4,}/);
                const valor = valorMatch ? valorMatch[0] : null;
                
                return {
                    valor,
                    banco: null,
                    fecha: null,
                    referencia: null
                };
            }
            
        } catch (error) {
            logError('OpenAIService.extraerInformacionPago', error, { mimeType });
            return {
                valor: null,
                banco: null,
                fecha: null,
                referencia: null
            };
        }
    }
    
    /**
     * Genera una respuesta conversacional usando el contexto del historial
     * @param {string} mensajeUsuario - Mensaje actual del usuario
     * @param {Array} historial - Historial de la conversación
     * @param {string} nombreUsuario - Nombre del usuario
     * @param {string} fase - Fase actual de la conversación
     * @returns {string} - Respuesta generada
     */
    async generarRespuestaContextual(mensajeUsuario, historial = [], nombreUsuario = "Usuario", fase = "inicial") {
        try {
            // Construir contexto del historial (últimos 10 mensajes para no sobrecargar)
            const historialReciente = historial.slice(-10);
            const contextualHistory = historialReciente.map(msg => 
                `${msg.from === 'usuario' ? nombreUsuario : 'Asistente'}: ${msg.mensaje}`
            ).join('\n');
            
            const prompt = `${promptInstitucional}

📊 CONTEXTO DE LA CONVERSACIÓN:
Fase actual: ${fase}
Historial reciente:
${contextualHistory}

🎯 MENSAJE ACTUAL:
${nombreUsuario}: ${mensajeUsuario}

Responde de manera natural y contextual, considerando el historial de la conversación. No repitas información ya proporcionada a menos que sea necesario.`;

            const result = await this.llamarOpenAI({
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                max_tokens: 300,
                temperature: 0.7
            });

            const respuesta = result.choices[0].message.content.trim();
            
            logInfo('OpenAIService.generarRespuestaContextual', 
                'Respuesta contextual generada',
                { 
                    usuario: nombreUsuario, 
                    fase, 
                    historialLength: historial.length,
                    responseLength: respuesta.length
                }
            );
            
            return respuesta;
            
        } catch (error) {
            logError('OpenAIService.generarRespuestaContextual', error, { 
                usuario: nombreUsuario, 
                fase, 
                messageLength: mensajeUsuario?.length 
            });
            
            // Respuesta de fallback
            return "Disculpa, tengo problemas técnicos en este momento. ¿Podrías intentar de nuevo o contarme de otra manera en qué puedo ayudarte?";
        }
    }
    
    /**
     * Extrae información específica de un documento de identidad
     * @param {string} base64Image - Imagen en base64
     * @param {string} mimeType - Tipo MIME de la imagen
     * @returns {Object} - Información extraída del documento
     */
    async extraerInformacionDocumento(base64Image, mimeType) {
        const prompt = `Extrae la información de este documento de identidad en formato JSON:

{
    "numero_documento": "número de cédula o documento",
    "nombre_completo": "nombre completo de la persona",
    "tipo_documento": "tipo de documento (CC, TI, CE, etc.)"
}

Si no puedes encontrar algún campo, usa null.`;

        try {
            const result = await this.llamarOpenAI({
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { 
                            type: 'image_url', 
                            image_url: { url: `data:${mimeType};base64,${base64Image}` } 
                        }
                    ]
                }],
                max_tokens: 100
            });

            const respuesta = result.choices[0].message.content.trim();
            
            try {
                const informacion = JSON.parse(respuesta);
                
                logInfo('OpenAIService.extraerInformacionDocumento', 
                    'Información extraída del documento',
                    { tipo: informacion.tipo_documento }
                );
                
                return informacion;
                
            } catch (parseError) {
                logError('OpenAIService.extraerInformacionDocumento', 
                    'Error parseando JSON de documento', { respuesta });
                
                return {
                    numero_documento: null,
                    nombre_completo: null,
                    tipo_documento: null
                };
            }
            
        } catch (error) {
            logError('OpenAIService.extraerInformacionDocumento', error, { mimeType });
            return {
                numero_documento: null,
                nombre_completo: null,
                tipo_documento: null
            };
        }
    }
    
    /**
     * Valida si un texto parece ser un comprobante de pago textual
     * @param {string} texto - Texto a analizar
     * @returns {Object} - Resultado del análisis
     */
    async analizarTextoComprobante(texto) {
        const prompt = `Analiza este texto para determinar si es información de un comprobante de pago o transferencia bancaria.

Texto: "${texto}"

Responde en formato JSON:
{
    "es_comprobante": true/false,
    "valor_encontrado": "valor numérico si existe, null si no",
    "confianza": "alta/media/baja"
}`;

        try {
            const result = await this.llamarOpenAI({
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                max_tokens: 80
            });

            const respuesta = result.choices[0].message.content.trim();
            
            try {
                return JSON.parse(respuesta);
            } catch (parseError) {
                return {
                    es_comprobante: false,
                    valor_encontrado: null,
                    confianza: "baja"
                };
            }
            
        } catch (error) {
            logError('OpenAIService.analizarTextoComprobante', error, { 
                textoLength: texto?.length 
            });
            
            return {
                es_comprobante: false,
                valor_encontrado: null,
                confianza: "baja"
            };
        }
    }
}

// Singleton para reutilizar la instancia
let openAIServiceInstance = null;

function getOpenAIService() {
    if (!openAIServiceInstance) {
        openAIServiceInstance = new OpenAIService();
    }
    return openAIServiceInstance;
}

module.exports = {
    OpenAIService,
    getOpenAIService
};
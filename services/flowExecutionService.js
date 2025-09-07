const { logInfo, logError } = require('../utils/shared');
const ValidationService = require('../utils/validation');
const MessageService = require('../services/messageService');
const { consultarInformacionPaciente } = require('../utils/consultarPaciente');
const { marcarPagado } = require('../utils/marcarPagado');
const { sendPdf, generarPdfDesdeApi2Pdf } = require('../utils/pdf');
const { getOpenAIService } = require('../services/openaiService');
const { promptInstitucional } = require('../utils/prompt');

/**
 * Servicio de Ejecución de Flujo Visual
 * Convierte el flujo visual en lógica ejecutable
 */
class FlowExecutionService {
    constructor() {
        this.flowData = null;
        this.nodes = new Map();
        this.connections = new Map();
    }

    /**
     * Inicializar el flujo - crear mapas para acceso rápido
     */
    async initializeFlow(flowData) {
        this.flowData = flowData;
        
        if (!flowData || !flowData.nodes) {
            throw new Error('Datos de flujo inválidos');
        }

        // Limpiar mapas
        this.nodes.clear();
        this.connections.clear();

        // Crear mapa de nodos
        this.flowData.nodes.forEach(node => {
            this.nodes.set(node.id, node);
        });

        // Crear mapa de conexiones
        if (this.flowData.connections) {
            this.flowData.connections.forEach(conn => {
                if (!this.connections.has(conn.from)) {
                    this.connections.set(conn.from, []);
                }
                this.connections.get(conn.from).push(conn.to);
            });
        }

        logInfo('flowExecution', 'Flujo inicializado', {
            nodeCount: this.nodes.size,
            connectionCount: this.flowData.connections?.length || 0
        });
    }

    /**
     * Ejecutar un nodo específico
     */
    async executeNode(nodeId, context = {}) {
        const node = this.nodes.get(nodeId);
        if (!node) {
            throw new Error(`Nodo no encontrado: ${nodeId}`);
        }

        logInfo('flowExecution', `Ejecutando nodo ${node.type}`, { 
            nodeId, 
            title: node.data.title 
        });

        try {
            switch (node.type) {
                case 'start':
                    return await this.executeStartNode(node, context);
                case 'message':
                    return await this.executeMessageNode(node, context);
                case 'menu':
                    return await this.executeMenuNode(node, context);
                case 'condition':
                    return await this.executeConditionNode(node, context);
                case 'ai':
                    return await this.executeAINode(node, context);
                case 'input':
                    return await this.executeInputNode(node, context);
                case 'api':
                    return await this.executeAPINode(node, context);
                case 'payment':
                    return await this.executePaymentNode(node, context);
                case 'pdf':
                    return await this.executePDFNode(node, context);
                case 'transfer':
                    return await this.executeTransferNode(node, context);
                case 'image':
                    return await this.executeImageNode(node, context);
                case 'end':
                    return await this.executeEndNode(node, context);
                default:
                    throw new Error(`Tipo de nodo no soportado: ${node.type}`);
            }
        } catch (error) {
            logError('flowExecution', `Error ejecutando nodo ${nodeId}`, { error });
            throw error;
        }
    }

    /**
     * Nodo de inicio
     */
    async executeStartNode(node, context) {
        const nextNodes = this.connections.get(node.id) || [];
        if (nextNodes.length > 0) {
            return { nextNode: nextNodes[0] };
        }
        return { completed: true };
    }

    /**
     * Nodo de mensaje
     */
    async executeMessageNode(node, context) {
        const message = node.data.text || 'Mensaje no configurado';
        
        if (context.to && context.userId && context.nombre) {
            await MessageService.enviarMensajeYGuardar({
                to: context.to,
                userId: context.userId,
                nombre: context.nombre,
                texto: message,
                historial: context.historial || [],
                remitente: "sistema",
                fase: context.fase || "inicial"
            });
        }

        const nextNodes = this.connections.get(node.id) || [];
        return {
            message,
            nextNode: nextNodes.length > 0 ? nextNodes[0] : null,
            waitForUser: false
        };
    }

    /**
     * Nodo de menú
     */
    async executeMenuNode(node, context) {
        const options = node.data.options || [];
        let menuText = node.data.title || 'Selecciona una opción';
        
        if (options.length > 0) {
            menuText += '\n\n';
            options.forEach((option, index) => {
                menuText += `${index + 1}️⃣ ${option.text}\n`;
            });
        }

        if (context.to && context.userId && context.nombre) {
            await MessageService.enviarMensajeYGuardar({
                to: context.to,
                userId: context.userId,
                nombre: context.nombre,
                texto: menuText,
                historial: context.historial || [],
                remitente: "sistema",
                fase: context.fase || "inicial"
            });
        }

        // El menú espera respuesta del usuario
        return {
            message: menuText,
            waitForUser: true,
            menuOptions: options,
            nodeId: node.id
        };
    }

    /**
     * Procesar respuesta de menú
     */
    processMenuResponse(nodeId, userMessage, context) {
        const node = this.nodes.get(nodeId);
        if (!node || node.type !== 'menu') {
            return null;
        }

        const options = node.data.options || [];
        const userChoice = parseInt(userMessage.trim());

        if (userChoice >= 1 && userChoice <= options.length) {
            const selectedOption = options[userChoice - 1];
            
            // Si la opción tiene un next definido, usar eso
            if (selectedOption.next) {
                return selectedOption.next;
            }
            
            // Si no, usar las conexiones del nodo
            const nextNodes = this.connections.get(nodeId) || [];
            return nextNodes[userChoice - 1] || nextNodes[0] || null;
        }

        return null;
    }

    /**
     * Nodo de condición
     */
    async executeConditionNode(node, context) {
        const variable = node.data.variable || '';
        const operator = node.data.operator || 'equals';
        const value = node.data.value || '';
        
        let testValue = '';
        
        // Obtener el valor a evaluar según la variable
        switch (variable) {
            case 'userMessage':
                testValue = context.userMessage || '';
                break;
            case 'response':
                testValue = context.response || context.userMessage || '';
                break;
            case 'adminMessage':
                testValue = context.adminMessage || '';
                break;
            case 'userResponse':
                testValue = context.userResponse || context.userMessage || '';
                break;
            default:
                testValue = context[variable] || '';
        }

        let conditionMet = false;
        
        switch (operator) {
            case 'equals':
                conditionMet = testValue.toLowerCase() === value.toLowerCase();
                break;
            case 'contains':
                conditionMet = testValue.toLowerCase().includes(value.toLowerCase());
                break;
            case 'startsWith':
                conditionMet = testValue.toLowerCase().startsWith(value.toLowerCase());
                break;
            case 'regex':
                try {
                    const regex = new RegExp(value, 'i');
                    conditionMet = regex.test(testValue);
                } catch (e) {
                    logError('flowExecution', 'Error en regex de condición', { value, error: e });
                    conditionMet = false;
                }
                break;
        }

        const nextNodes = this.connections.get(node.id) || [];
        
        // Primera conexión = condición verdadera, segunda = falsa
        let nextNode = null;
        if (conditionMet && nextNodes.length > 0) {
            nextNode = nextNodes[0];
        } else if (!conditionMet && nextNodes.length > 1) {
            nextNode = nextNodes[1];
        } else if (nextNodes.length > 0) {
            nextNode = nextNodes[0];
        }

        return {
            conditionMet,
            testValue,
            nextNode
        };
    }

    /**
     * Nodo de IA
     */
    async executeAINode(node, context) {
        const prompt = node.data.prompt || promptInstitucional;
        const userMessage = context.userMessage || '';
        const historial = context.historial || [];

        try {
            const openaiService = getOpenAIService();
            const messages = [
                { role: 'system', content: prompt },
                ...historial.slice(-8).map(m => ({
                    role: m.from === "usuario" ? "user" : "assistant",
                    content: m.mensaje
                })),
                { role: 'user', content: userMessage }
            ];

            const response = await openaiService.generateResponse(messages, {
                maxTokens: 200
            });

            if (context.to && context.userId && context.nombre) {
                await MessageService.enviarMensajeYGuardar({
                    to: context.to,
                    userId: context.userId,
                    nombre: context.nombre,
                    texto: response,
                    historial: context.historial || [],
                    remitente: "sistema",
                    fase: context.fase || "inicial"
                });
            }

            const nextNodes = this.connections.get(node.id) || [];
            return {
                aiResponse: response,
                nextNode: nextNodes.length > 0 ? nextNodes[0] : null
            };

        } catch (error) {
            logError('flowExecution', 'Error en nodo IA', { error });
            
            const fallbackResponse = node.data.fallback || "Lo siento, no puedo procesar tu solicitud en este momento.";
            
            if (context.to && context.userId && context.nombre) {
                await MessageService.enviarMensajeYGuardar({
                    to: context.to,
                    userId: context.userId,
                    nombre: context.nombre,
                    texto: fallbackResponse,
                    historial: context.historial || [],
                    remitente: "sistema",
                    fase: context.fase || "inicial"
                });
            }

            const nextNodes = this.connections.get(node.id) || [];
            return {
                aiResponse: fallbackResponse,
                nextNode: nextNodes.length > 0 ? nextNodes[0] : null
            };
        }
    }

    /**
     * Nodo de input
     */
    async executeInputNode(node, context) {
        const promptText = node.data.prompt || '¿Cuál es tu respuesta?';
        const validation = node.data.validation || 'text';

        if (context.to && context.userId && context.nombre) {
            await MessageService.enviarMensajeYGuardar({
                to: context.to,
                userId: context.userId,
                nombre: context.nombre,
                texto: promptText,
                historial: context.historial || [],
                remitente: "sistema",
                fase: context.fase || "inicial"
            });
        }

        return {
            prompt: promptText,
            validation,
            waitForUser: true,
            nodeId: node.id
        };
    }

    /**
     * Procesar respuesta de input
     */
    processInputResponse(nodeId, userMessage, context) {
        const node = this.nodes.get(nodeId);
        if (!node || node.type !== 'input') {
            return null;
        }

        const validation = node.data.validation || 'text';
        let isValid = true;

        // Validar según el tipo
        switch (validation) {
            case 'cedula':
                isValid = ValidationService.validarCedula(userMessage).isValid;
                break;
            case 'email':
                isValid = ValidationService.validarEmail(userMessage).isValid;
                break;
            case 'number':
                isValid = !isNaN(parseFloat(userMessage));
                break;
            case 'text':
            default:
                isValid = userMessage.trim().length > 0;
        }

        if (isValid) {
            const nextNodes = this.connections.get(nodeId) || [];
            return {
                valid: true,
                value: userMessage,
                nextNode: nextNodes.length > 0 ? nextNodes[0] : null
            };
        } else {
            return {
                valid: false,
                error: `Formato inválido para ${validation}`
            };
        }
    }

    /**
     * Nodo de API
     */
    async executeAPINode(node, context) {
        const endpoint = node.data.endpoint || '';
        const method = node.data.method || 'GET';

        try {
            let result = null;

            // Ejecutar según el endpoint configurado
            switch (endpoint) {
                case 'consultarInformacionPaciente':
                    if (context.cedula || context.userMessage) {
                        const cedula = context.cedula || context.userMessage;
                        result = await consultarInformacionPaciente(cedula);
                    }
                    break;
                default:
                    logError('flowExecution', `Endpoint no reconocido: ${endpoint}`);
                    result = { error: 'Endpoint no configurado' };
            }

            const nextNodes = this.connections.get(node.id) || [];
            return {
                apiResult: result,
                nextNode: nextNodes.length > 0 ? nextNodes[0] : null
            };

        } catch (error) {
            logError('flowExecution', 'Error en nodo API', { endpoint, error });
            
            const nextNodes = this.connections.get(node.id) || [];
            return {
                apiResult: { error: error.message },
                nextNode: nextNodes.length > 0 ? nextNodes[0] : null
            };
        }
    }

    /**
     * Nodo de procesamiento de pago
     */
    async executePaymentNode(node, context) {
        const cedula = context.cedula || context.userMessage;
        
        try {
            if (!cedula || !ValidationService.validarCedula(cedula).isValid) {
                if (context.to && context.userId && context.nombre) {
                    await MessageService.enviarMensajeYGuardar({
                        to: context.to,
                        userId: context.userId,
                        nombre: context.nombre,
                        texto: "Ahora escribe SOLO tu número de documento (sin puntos ni letras).",
                        historial: context.historial || [],
                        remitente: "sistema",
                        fase: context.fase || "pago"
                    });
                }

                return {
                    waitForUser: true,
                    needsCedula: true,
                    nodeId: node.id
                };
            }

            // Procesar pago
            await marcarPagado(cedula);
            const infoPaciente = await consultarInformacionPaciente(cedula);

            const nextNodes = this.connections.get(node.id) || [];
            return {
                paymentProcessed: true,
                patientInfo: infoPaciente,
                cedula,
                nextNode: nextNodes.length > 0 ? nextNodes[0] : null
            };

        } catch (error) {
            logError('flowExecution', 'Error procesando pago', { error });
            
            if (context.to && context.userId && context.nombre) {
                await MessageService.enviarMensajeYGuardar({
                    to: context.to,
                    userId: context.userId,
                    nombre: context.nombre,
                    texto: "Hubo un problema procesando el pago. Un asesor te contactará.",
                    historial: context.historial || [],
                    remitente: "sistema",
                    fase: context.fase || "pago"
                });
            }

            const nextNodes = this.connections.get(node.id) || [];
            return {
                paymentProcessed: false,
                error: error.message,
                nextNode: nextNodes.length > 0 ? nextNodes[0] : null
            };
        }
    }

    /**
     * Nodo de generación de PDF
     */
    async executePDFNode(node, context) {
        const cedula = context.cedula;
        const template = node.data.template || 'certificate';

        try {
            if (!cedula) {
                throw new Error('Se requiere cédula para generar PDF');
            }

            const pdfUrl = await generarPdfDesdeApi2Pdf(cedula);
            
            if (context.to) {
                await sendPdf(context.to, pdfUrl, cedula);
            }

            const nextNodes = this.connections.get(node.id) || [];
            return {
                pdfGenerated: true,
                pdfUrl,
                template,
                nextNode: nextNodes.length > 0 ? nextNodes[0] : null
            };

        } catch (error) {
            logError('flowExecution', 'Error generando PDF', { error });
            
            const nextNodes = this.connections.get(node.id) || [];
            return {
                pdfGenerated: false,
                error: error.message,
                nextNode: nextNodes.length > 0 ? nextNodes[0] : null
            };
        }
    }

    /**
     * Nodo de transferencia
     */
    async executeTransferNode(node, context) {
        const message = node.data.message || '...transfiriendo con asesor';
        
        if (context.to && context.userId && context.nombre) {
            await MessageService.enviarMensajeYGuardar({
                to: context.to,
                userId: context.userId,
                nombre: context.nombre,
                texto: message,
                historial: context.historial || [],
                remitente: "sistema",
                fase: context.fase || "inicial"
            });

            // Marcar usuario como STOP
            const { actualizarObservaciones } = require('../utils/dbAPI');
            await actualizarObservaciones(context.userId, "stop");
        }

        const nextNodes = this.connections.get(node.id) || [];
        return {
            transferred: true,
            message,
            nextNode: nextNodes.length > 0 ? nextNodes[0] : null
        };
    }

    /**
     * Nodo de procesamiento de imagen
     */
    async executeImageNode(node, context) {
        const action = node.data.action || 'classify';
        
        // Este nodo generalmente se ejecuta desde el procesador de imágenes
        // Por ahora solo retornamos el siguiente nodo
        const nextNodes = this.connections.get(node.id) || [];
        return {
            imageProcessed: true,
            action,
            nextNode: nextNodes.length > 0 ? nextNodes[0] : null
        };
    }

    /**
     * Nodo final
     */
    async executeEndNode(node, context) {
        return {
            completed: true,
            endMessage: node.data.message || 'Conversación finalizada'
        };
    }

    /**
     * Buscar nodo inicial
     */
    getStartNode() {
        for (let [id, node] of this.nodes) {
            if (node.type === 'start') {
                return id;
            }
        }
        return null;
    }

    /**
     * Ejecutar flujo principal
     */
    async executeFlow(userMessage, context = {}) {
        try {
            if (!this.flowData || this.nodes.size === 0) {
                throw new Error('Flujo no inicializado');
            }

            // Encontrar nodo inicial
            let currentNodeId = this.getStartNode();
            if (!currentNodeId) {
                throw new Error('No se encontró nodo de inicio');
            }

            let executionContext = {
                ...context,
                userMessage,
                to: context.from
            };

            let maxIterations = 20; // Prevenir loops infinitos
            let iterations = 0;
            let finalResult = null;

            while (currentNodeId && iterations < maxIterations) {
                iterations++;
                
                const result = await this.executeNode(currentNodeId, executionContext);
                
                if (!result) {
                    break;
                }

                // Actualizar contexto con resultados
                executionContext = { ...executionContext, ...result };
                finalResult = result;

                // Si el nodo requiere esperar al usuario, retornar inmediatamente
                if (result.waitForUser) {
                    return {
                        success: true,
                        nodeId: currentNodeId,
                        waitingForUser: true,
                        response: result.prompt || result.message
                    };
                }

                // Pasar al siguiente nodo
                currentNodeId = result.nextNode;

                // Si llegamos a un nodo final, terminar
                if (result.completed) {
                    break;
                }
            }

            return {
                success: true,
                nodeId: currentNodeId,
                iterations,
                finalResult,
                response: finalResult?.message || finalResult?.aiResponse || 'Procesado'
            };

        } catch (error) {
            logError('flowExecution', 'Error ejecutando flujo', { error });
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Validar flujo
     */
    async validateFlow(flowData) {
        const errors = [];
        
        if (!flowData || !flowData.nodes || !Array.isArray(flowData.nodes)) {
            errors.push('Estructura de flujo inválida - se requieren nodos');
            return {
                isValid: false,
                errors
            };
        }

        // Crear mapas temporales para validación
        const tempNodes = new Map();
        flowData.nodes.forEach(node => {
            tempNodes.set(node.id, node);
        });
        
        // Verificar que hay al menos un nodo de inicio
        const startNodes = flowData.nodes.filter(n => n.type === 'start');
        if (startNodes.length === 0) {
            errors.push('El flujo debe tener al menos un nodo de inicio');
        }
        
        // Verificar que todos los nodos tienen datos básicos
        for (let node of flowData.nodes) {
            if (!node.id || node.id.trim() === '') {
                errors.push('Todos los nodos deben tener un ID válido');
            }
            if (!node.type || node.type.trim() === '') {
                errors.push(`El nodo ${node.id} no tiene tipo definido`);
            }
            if (!node.data || !node.data.title || node.data.title.trim() === '') {
                errors.push(`El nodo ${node.id} no tiene título`);
            }
        }
        
        // Verificar que las conexiones apuntan a nodos existentes
        if (flowData.connections && Array.isArray(flowData.connections)) {
            for (let connection of flowData.connections) {
                if (!tempNodes.has(connection.from)) {
                    errors.push(`Conexión desde nodo inexistente: ${connection.from}`);
                }
                if (!tempNodes.has(connection.to)) {
                    errors.push(`Conexión hacia nodo inexistente: ${connection.to}`);
                }
            }
        }

        // Validar configuraciones específicas por tipo de nodo
        for (let node of flowData.nodes) {
            switch (node.type) {
                case 'menu':
                    if (!node.data.options || !Array.isArray(node.data.options)) {
                        errors.push(`El nodo menú ${node.id} debe tener opciones definidas`);
                    }
                    break;
                case 'condition':
                    if (!node.data.variable || !node.data.operator) {
                        errors.push(`El nodo condición ${node.id} debe tener variable y operador definidos`);
                    }
                    break;
                case 'api':
                    if (!node.data.endpoint) {
                        errors.push(`El nodo API ${node.id} debe tener un endpoint definido`);
                    }
                    break;
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

module.exports = FlowExecutionService;
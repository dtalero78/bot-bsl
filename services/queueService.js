const { logInfo, logError, generarTimestamp } = require('../utils/shared');
const { getCacheService } = require('./cacheService');
const MessageService = require('./messageService');

/**
 * Servicio de colas para procesamiento asíncrono de tareas pesadas
 * Evita bloquear el hilo principal con operaciones costosas
 */
class QueueService {
    constructor() {
        this.queues = new Map();
        this.workers = new Map();
        this.isProcessing = false;
        this.processingInterval = null;
        
        // Configuración de colas
        this.queueConfig = {
            imageProcessing: {
                name: 'imageProcessing',
                maxConcurrency: 2, // Máximo 2 imágenes procesándose simultáneamente
                processingDelay: 1000, // 1 segundo entre procesamiento
                retryAttempts: 3
            }
        };
        
        this.initializeQueues();
        this.startProcessing();
    }
    
    initializeQueues() {
        // Inicializar colas vacías
        Object.keys(this.queueConfig).forEach(queueName => {
            this.queues.set(queueName, []);
            this.workers.set(queueName, {
                active: 0,
                processed: 0,
                failed: 0
            });
        });
        
        logInfo('QueueService', 'Colas inicializadas', { 
            queues: Object.keys(this.queueConfig) 
        });
    }
    
    /**
     * Añade una tarea de procesamiento de imagen a la cola
     */
    async enqueueImageProcessing(taskData) {
        const task = {
            id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'imageProcessing',
            data: taskData,
            timestamp: generarTimestamp(),
            attempts: 0,
            status: 'pending'
        };
        
        this.queues.get('imageProcessing').push(task);
        
        logInfo('QueueService', 'Tarea de procesamiento de imagen encolada', { 
            taskId: task.id,
            userId: taskData.userId,
            queueSize: this.queues.get('imageProcessing').length
        });
        
        return task.id;
    }
    
    /**
     * Inicia el procesamiento continuo de colas
     */
    startProcessing() {
        if (this.isProcessing) return;
        
        this.isProcessing = true;
        this.processingInterval = setInterval(() => {
            this.processQueues();
        }, 500); // Revisar colas cada 500ms
        
        logInfo('QueueService', 'Procesamiento de colas iniciado');
    }
    
    /**
     * Detiene el procesamiento de colas
     */
    stopProcessing() {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
        this.isProcessing = false;
        
        logInfo('QueueService', 'Procesamiento de colas detenido');
    }
    
    /**
     * Procesa todas las colas disponibles
     */
    async processQueues() {
        for (const [queueName, queue] of this.queues) {
            const config = this.queueConfig[queueName];
            const worker = this.workers.get(queueName);
            
            // Verificar si podemos procesar más tareas
            if (worker.active >= config.maxConcurrency) continue;
            if (queue.length === 0) continue;
            
            // Tomar la siguiente tarea
            const task = queue.shift();
            if (!task || task.status === 'processing') continue;
            
            // Marcar como en procesamiento
            task.status = 'processing';
            worker.active++;
            
            // Procesar tarea asíncronamente
            this.processTask(task, config)
                .then(() => {
                    worker.active--;
                    worker.processed++;
                })
                .catch((error) => {
                    worker.active--;
                    worker.failed++;
                    logError('QueueService', `Error procesando tarea ${task.id}`, { error });
                });
        }
    }
    
    /**
     * Procesa una tarea individual
     */
    async processTask(task, config) {
        try {
            task.attempts++;
            
            logInfo('QueueService', 'Procesando tarea', { 
                taskId: task.id,
                type: task.type,
                attempt: task.attempts
            });
            
            switch (task.type) {
                case 'imageProcessing':
                    await this.processImageTask(task);
                    break;
                
                default:
                    throw new Error(`Tipo de tarea no soportado: ${task.type}`);
            }
            
            task.status = 'completed';
            
            logInfo('QueueService', 'Tarea completada exitosamente', { 
                taskId: task.id,
                type: task.type
            });
            
        } catch (error) {
            task.status = 'failed';
            task.error = error.message;
            
            logError('QueueService', 'Error procesando tarea', { 
                taskId: task.id,
                type: task.type,
                attempt: task.attempts,
                error
            });
            
            // Reintentar si no hemos alcanzado el máximo
            if (task.attempts < config.retryAttempts) {
                task.status = 'pending';
                this.queues.get(task.type).push(task);
                
                logInfo('QueueService', 'Tarea re-encolada para reintento', { 
                    taskId: task.id,
                    attempt: task.attempts,
                    maxAttempts: config.retryAttempts
                });
            } else {
                // Notificar al usuario del fallo después de todos los intentos
                try {
                    await MessageService.enviarMensajeSimple(
                        task.data.to,
                        "❌ No pude procesar tu imagen después de varios intentos. Por favor intenta con una imagen más clara o contacta soporte."
                    );
                } catch (notifyError) {
                    logError('QueueService', 'Error notificando fallo al usuario', { 
                        taskId: task.id, 
                        error: notifyError 
                    });
                }
            }
        }
    }
    
    /**
     * Procesa una tarea de imagen específica
     */
    async processImageTask(task) {
        const { 
            base64Image, 
            mimeType, 
            to, 
            userId, 
            nombre, 
            historial, 
            openaiService 
        } = task.data;
        
        // 1. Clasificar imagen
        const clasificacion = await openaiService.clasificarImagen(base64Image, mimeType);
        
        let mensajeRespuesta = "";
        let valorDetectado = null;
        
        // 2. Procesar según clasificación
        switch (clasificacion) {
            case "comprobante_pago":
                const informacionPago = await openaiService.extraerInformacionPago(base64Image, mimeType);
                valorDetectado = informacionPago.valor;
                
                if (valorDetectado && /^\d{4,}$/.test(valorDetectado)) {
                    mensajeRespuesta = `✅ Comprobante recibido - Valor detectado: $${valorDetectado}\n\nAhora escribe SOLO tu número de documento *(sin puntos ni letras)*.`;
                } else {
                    mensajeRespuesta = "❌ No pude identificar el valor en el comprobante. Por favor envía una imagen más clara del soporte de pago.";
                }
                break;
                
            case "listado_examenes":
                mensajeRespuesta = `📋 He recibido tu orden médica.\n\n🩺 Nuestras opciones para exámenes ocupacionales:\n• Virtual: $46.000\n• Presencial: $69.000\n\n¿Cuál opción prefieres?`;
                break;
                
            case "confirmacion_cita":
                mensajeRespuesta = "📅 He recibido tu confirmación de cita. Para consultar información específica, proporciona tu número de documento.";
                break;
                
            case "documento_identidad":
                const informacionDoc = await openaiService.extraerInformacionDocumento(base64Image, mimeType);
                if (informacionDoc.numero_documento) {
                    mensajeRespuesta = `🆔 He recibido tu documento.\n\nNúmero identificado: ${informacionDoc.numero_documento}\n\n¿Necesitas consultar información sobre tu cita o realizar un examen médico?`;
                } else {
                    mensajeRespuesta = "🆔 He recibido tu documento. ¿Necesitas consultar información sobre tu cita o realizar un examen médico?";
                }
                break;
                
            default:
                mensajeRespuesta = "📷 He recibido tu imagen, pero no pude identificar qué tipo de documento es.\n\n¿Podrías decirme qué información necesitas o enviar un comprobante de pago, orden médica o documento más claro?";
                break;
        }
        
        // 3. Enviar respuesta
        await MessageService.enviarMensajeYGuardar({
            to,
            userId,
            nombre,
            texto: mensajeRespuesta,
            historial,
            remitente: "sistema"
        });
        
        logInfo('QueueService', 'Imagen procesada completamente', {
            userId,
            clasificacion,
            valorDetectado,
            responseLength: mensajeRespuesta.length
        });
    }
    
    /**
     * Obtiene estadísticas de las colas
     */
    getQueueStats() {
        const stats = {};
        
        for (const [queueName, queue] of this.queues) {
            const worker = this.workers.get(queueName);
            stats[queueName] = {
                pending: queue.length,
                active: worker.active,
                processed: worker.processed,
                failed: worker.failed,
                maxConcurrency: this.queueConfig[queueName].maxConcurrency
            };
        }
        
        return {
            isProcessing: this.isProcessing,
            queues: stats,
            totalPending: Object.values(stats).reduce((sum, q) => sum + q.pending, 0),
            totalActive: Object.values(stats).reduce((sum, q) => sum + q.active, 0)
        };
    }
    
    /**
     * Limpia todas las colas (usar con precaución)
     */
    clearAllQueues() {
        for (const queue of this.queues.values()) {
            queue.length = 0;
        }
        
        logInfo('QueueService', 'Todas las colas han sido limpiadas');
    }
}

// Singleton para reutilizar la instancia
let queueServiceInstance = null;

function getQueueService() {
    if (!queueServiceInstance) {
        queueServiceInstance = new QueueService();
    }
    return queueServiceInstance;
}

module.exports = {
    QueueService,
    getQueueService
};
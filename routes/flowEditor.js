const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { logInfo, logError } = require('../utils/shared');

// Ruta del archivo de flujo
const FLOW_FILE_PATH = path.join(__dirname, '../config/botFlow.json');

/**
 * Obtener el flujo actual
 */
router.get('/api/flow/load', async (req, res) => {
    try {
        // Intentar cargar flujo existente
        let flowData;
        try {
            const fileContent = await fs.readFile(FLOW_FILE_PATH, 'utf8');
            flowData = JSON.parse(fileContent);
        } catch (error) {
            // Si no existe, crear flujo por defecto basado en el sistema actual
            flowData = getDefaultFlow();
        }

        logInfo('flowEditor', 'Flujo cargado exitosamente');
        res.json({ success: true, flow: flowData });
    } catch (error) {
        logError('flowEditor', 'Error cargando flujo', { error });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Guardar el flujo
 */
router.post('/api/flow/save', async (req, res) => {
    try {
        const flowData = req.body;
        
        // Validar estructura básica
        if (!flowData.nodes || !Array.isArray(flowData.nodes)) {
            throw new Error('Estructura de flujo inválida');
        }

        // Agregar metadata
        flowData.metadata = {
            ...flowData.metadata,
            lastModified: new Date().toISOString(),
            modifiedBy: 'admin'
        };

        // Guardar en archivo
        await fs.writeFile(FLOW_FILE_PATH, JSON.stringify(flowData, null, 2));
        
        logInfo('flowEditor', 'Flujo guardado exitosamente', { 
            nodeCount: flowData.nodes.length,
            connectionCount: flowData.connections?.length || 0 
        });
        
        res.json({ success: true, message: 'Flujo guardado correctamente' });
    } catch (error) {
        logError('flowEditor', 'Error guardando flujo', { error });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Aplicar flujo en producción
 */
router.post('/api/flow/deploy', async (req, res) => {
    try {
        const flowData = req.body;
        
        // Importar FlowExecutionService
        const FlowExecutionService = require('../services/flowExecutionService');
        const flowService = new FlowExecutionService();
        
        // Validar flujo completo
        const validationResult = await flowService.validateFlow(flowData);
        if (!validationResult.isValid) {
            return res.status(400).json({
                success: false,
                error: 'Flujo inválido',
                details: validationResult.errors
            });
        }

        // Marcar flujo como desplegado
        flowData.metadata = {
            ...flowData.metadata,
            deployedAt: new Date().toISOString(),
            deployedBy: flowData.deployedBy || 'admin',
            isActive: true
        };

        // Guardar flujo válido
        await fs.writeFile(FLOW_FILE_PATH, JSON.stringify(flowData, null, 2));

        // Inicializar servicio de ejecución con el nuevo flujo
        await flowService.initializeFlow(flowData);
        
        logInfo('flowEditor', 'Flujo desplegado y activado en producción', {
            nodeCount: flowData.nodes.length,
            validationPassed: true,
            executionReady: true
        });
        
        res.json({ 
            success: true, 
            message: 'Flujo aplicado y activado exitosamente',
            details: {
                nodesProcessed: flowData.nodes.length,
                connectionsProcessed: flowData.connections?.length || 0,
                validationPassed: true
            }
        });
    } catch (error) {
        logError('flowEditor', 'Error desplegando flujo', { error });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Obtener flujo por defecto basado en el sistema actual
 */
function getDefaultFlow() {
    return {
        nodes: [
            {
                id: 'node-start',
                type: 'start',
                x: 50,
                y: 300,
                data: {
                    title: 'Inicio',
                    icon: 'fa-play-circle',
                    color: 'success',
                    isInitial: true
                }
            },
            {
                id: 'node-greeting',
                type: 'message',
                x: 200,
                y: 300,
                data: {
                    title: 'Saludo Inicial',
                    text: 'Hola, ¿en qué puedo ayudarte hoy?',
                    icon: 'fa-comment',
                    color: 'primary'
                }
            },
            {
                id: 'node-ai-response',
                type: 'ai',
                x: 400,
                y: 200,
                data: {
                    title: 'Respuesta IA (Fase Inicial)',
                    prompt: 'promptInstitucional',
                    icon: 'fa-robot',
                    color: 'success'
                }
            },
            {
                id: 'node-image-process',
                type: 'image',
                x: 400,
                y: 400,
                data: {
                    title: 'Procesar Imagen',
                    action: 'classify',
                    icon: 'fa-image',
                    color: 'info'
                }
            },
            {
                id: 'node-check-schedule',
                type: 'condition',
                x: 600,
                y: 300,
                data: {
                    title: '¿Usuario Agendó?',
                    variable: 'response',
                    operator: 'contains',
                    value: 'nuevaorden-1',
                    icon: 'fa-code-branch',
                    color: 'warning'
                }
            },
            {
                id: 'node-post-schedule-menu',
                type: 'menu',
                x: 800,
                y: 200,
                data: {
                    title: 'Menú Post-Agendamiento',
                    options: [
                        { text: '¿A qué hora quedó mi cita?', next: 'node-check-appointment' },
                        { text: 'Problemas con la aplicación', next: 'node-app-problems' },
                        { text: 'No me funciona el formulario', next: 'node-form-help' },
                        { text: 'Se me cerró la aplicación', next: 'node-app-closed' },
                        { text: 'Hablar con un asesor', next: 'node-transfer' }
                    ],
                    icon: 'fa-list',
                    color: 'purple'
                }
            },
            {
                id: 'node-check-appointment',
                type: 'input',
                x: 1000,
                y: 100,
                data: {
                    title: 'Solicitar Documento para Cita',
                    prompt: 'Para consultar el horario de tu cita, necesito tu número de documento. Por favor escríbelo (solo números, sin puntos).',
                    validation: 'cedula',
                    icon: 'fa-keyboard',
                    color: 'info'
                }
            },
            {
                id: 'node-appointment-info',
                type: 'api',
                x: 1200,
                y: 100,
                data: {
                    title: 'Consultar Información Cita',
                    endpoint: 'consultarInformacionPaciente',
                    method: 'GET',
                    icon: 'fa-database',
                    color: 'secondary'
                }
            },
            {
                id: 'node-app-problems',
                type: 'message',
                x: 1000,
                y: 150,
                data: {
                    title: 'Ayuda Problemas App',
                    text: 'Para problemas técnicos:\n\n✅ Recarga la página\n✅ Limpia el caché\n✅ Usa Chrome o Safari actualizados\n\n¿Se solucionó?',
                    icon: 'fa-comment',
                    color: 'primary'
                }
            },
            {
                id: 'node-form-help',
                type: 'message',
                x: 1000,
                y: 200,
                data: {
                    title: 'Ayuda Formulario',
                    text: 'Si el formulario no funciona:\n\n1️⃣ Verifica tu conexión\n2️⃣ Completa todos los campos\n3️⃣ Revisa el formato de datos\n\n¿Necesitas más ayuda?',
                    icon: 'fa-comment',
                    color: 'primary'
                }
            },
            {
                id: 'node-app-closed',
                type: 'message',
                x: 1000,
                y: 250,
                data: {
                    title: 'App Se Cerró',
                    text: 'Si se cerró:\n\n📱 Vuelve al link\n💾 Tus datos se guardan automáticamente\n🔄 Continúa donde quedaste\n\n¿Pudiste ingresar?',
                    icon: 'fa-comment',
                    color: 'primary'
                }
            },
            {
                id: 'node-help-followup',
                type: 'condition',
                x: 1200,
                y: 200,
                data: {
                    title: '¿Se Solucionó?',
                    variable: 'userResponse',
                    operator: 'contains',
                    value: 'sí|si|ok|correcto|solucionó|funciona',
                    icon: 'fa-code-branch',
                    color: 'warning'
                }
            },
            {
                id: 'node-check-review',
                type: 'condition',
                x: 800,
                y: 400,
                data: {
                    title: '¿Admin: Revisar Certificado?',
                    variable: 'adminMessage',
                    operator: 'contains',
                    value: 'revisa que todo esté en orden',
                    icon: 'fa-code-branch',
                    color: 'warning'
                }
            },
            {
                id: 'node-review-menu',
                type: 'menu',
                x: 1000,
                y: 400,
                data: {
                    title: 'Revisión Certificado',
                    options: [
                        { text: 'Sí, está correcto', next: 'node-payment-info' },
                        { text: 'Hay un error que corregir', next: 'node-transfer' },
                        { text: 'No he podido revisarlo', next: 'node-review-help' },
                        { text: 'Hablar con un asesor', next: 'node-transfer' }
                    ],
                    icon: 'fa-list',
                    color: 'purple'
                }
            },
            {
                id: 'node-payment-info',
                type: 'message',
                x: 1200,
                y: 350,
                data: {
                    title: 'Información de Pago',
                    text: '💳 **Datos para el pago:**\n\n**Bancolombia:** Ahorros 44291192456 (cédula 79981585)\n**Daviplata:** 3014400818 (Mar Rea)\n**Nequi:** 3008021701 (Dan Tal)\n**También:** Transfiya\n\nEnvía SOLO tu comprobante de pago por aquí',
                    icon: 'fa-comment',
                    color: 'primary'
                }
            },
            {
                id: 'node-review-help',
                type: 'message',
                x: 1200,
                y: 450,
                data: {
                    title: 'Ayuda Revisar Certificado',
                    text: 'Para revisar tu certificado:\n\n1️⃣ Verifica tu email (también spam)\n2️⃣ Descarga el PDF\n3️⃣ Revisa tus datos\n\n¿Lo encontraste?',
                    icon: 'fa-comment',
                    color: 'primary'
                }
            },
            {
                id: 'node-payment',
                type: 'payment',
                x: 1200,
                y: 300,
                data: {
                    title: 'Procesar Pago',
                    icon: 'fa-credit-card',
                    color: 'success'
                }
            },
            {
                id: 'node-pdf',
                type: 'pdf',
                x: 1400,
                y: 300,
                data: {
                    title: 'Generar Certificado PDF',
                    template: 'certificate',
                    icon: 'fa-file-pdf',
                    color: 'danger'
                }
            },
            {
                id: 'node-transfer',
                type: 'transfer',
                x: 1000,
                y: 550,
                data: {
                    title: 'Transferir a Asesor',
                    message: '...transfiriendo con asesor',
                    icon: 'fa-user-tie',
                    color: 'danger'
                }
            },
            {
                id: 'node-end',
                type: 'end',
                x: 1600,
                y: 300,
                data: {
                    title: 'Fin',
                    icon: 'fa-stop-circle',
                    color: 'danger'
                }
            }
        ],
        connections: [
            // Flujo principal inicial
            { from: 'node-start', to: 'node-greeting' },
            { from: 'node-greeting', to: 'node-ai-response' },
            { from: 'node-greeting', to: 'node-image-process' },
            { from: 'node-ai-response', to: 'node-check-schedule' },
            { from: 'node-image-process', to: 'node-check-schedule' },
            
            // Ramificación de agendamiento
            { from: 'node-check-schedule', to: 'node-post-schedule-menu' },
            { from: 'node-check-schedule', to: 'node-check-review' },
            
            // Opciones del menú post-agendamiento
            { from: 'node-post-schedule-menu', to: 'node-check-appointment' },
            { from: 'node-post-schedule-menu', to: 'node-app-problems' },
            { from: 'node-post-schedule-menu', to: 'node-form-help' },
            { from: 'node-post-schedule-menu', to: 'node-app-closed' },
            { from: 'node-post-schedule-menu', to: 'node-transfer' },
            
            // Flujo de consulta de cita
            { from: 'node-check-appointment', to: 'node-appointment-info' },
            { from: 'node-appointment-info', to: 'node-end' },
            
            // Flujo de ayuda técnica
            { from: 'node-app-problems', to: 'node-help-followup' },
            { from: 'node-form-help', to: 'node-help-followup' },
            { from: 'node-app-closed', to: 'node-help-followup' },
            { from: 'node-help-followup', to: 'node-end' }, // Sí se solucionó
            { from: 'node-help-followup', to: 'node-transfer' }, // No se solucionó
            
            // Flujo de revisión de certificado
            { from: 'node-check-review', to: 'node-review-menu' },
            { from: 'node-review-menu', to: 'node-payment-info' },
            { from: 'node-review-menu', to: 'node-transfer' },
            { from: 'node-review-menu', to: 'node-review-help' },
            
            // Flujo de pago
            { from: 'node-payment-info', to: 'node-payment' },
            { from: 'node-review-help', to: 'node-help-followup' },
            { from: 'node-payment', to: 'node-pdf' },
            { from: 'node-pdf', to: 'node-end' },
            
            // Flujo de transferencia
            { from: 'node-transfer', to: 'node-end' }
        ],
        metadata: {
            name: 'Flujo BSL Bot - Por Defecto',
            version: '1.0',
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            description: 'Flujo basado en la implementación actual del bot BSL'
        }
    };
}

/**
 * Exportar flujo como JSON descargable
 */
router.get('/api/flow/export', async (req, res) => {
    try {
        const fileContent = await fs.readFile(FLOW_FILE_PATH, 'utf8');
        const flowData = JSON.parse(fileContent);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="bsl-bot-flow-${Date.now()}.json"`);
        res.send(JSON.stringify(flowData, null, 2));
        
        logInfo('flowEditor', 'Flujo exportado');
    } catch (error) {
        logError('flowEditor', 'Error exportando flujo', { error });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Importar flujo desde archivo JSON
 */
router.post('/api/flow/import', express.json({ limit: '10mb' }), async (req, res) => {
    try {
        const flowData = req.body;
        
        // Validar estructura
        if (!flowData.nodes || !Array.isArray(flowData.nodes)) {
            throw new Error('El archivo no tiene un formato de flujo válido');
        }
        
        // Guardar como nuevo flujo
        flowData.metadata = {
            ...flowData.metadata,
            importedAt: new Date().toISOString(),
            importedBy: 'admin'
        };
        
        await fs.writeFile(FLOW_FILE_PATH, JSON.stringify(flowData, null, 2));
        
        logInfo('flowEditor', 'Flujo importado', { nodeCount: flowData.nodes.length });
        res.json({ success: true, message: 'Flujo importado correctamente' });
    } catch (error) {
        logError('flowEditor', 'Error importando flujo', { error });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
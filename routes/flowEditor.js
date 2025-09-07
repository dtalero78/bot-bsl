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
        
        // Validar que el flujo tenga al menos un nodo de inicio
        const startNodes = flowData.nodes.filter(n => n.type === 'start');
        if (startNodes.length === 0) {
            throw new Error('El flujo debe tener al menos un nodo de inicio');
        }

        // Guardar flujo
        flowData.metadata = {
            ...flowData.metadata,
            deployedAt: new Date().toISOString(),
            deployedBy: flowData.deployedBy || 'admin',
            isActive: true
        };

        await fs.writeFile(FLOW_FILE_PATH, JSON.stringify(flowData, null, 2));

        // TODO: Convertir flujo visual a lógica ejecutable
        // Por ahora solo guardamos, en el futuro esto debe:
        // 1. Validar el flujo completo
        // 2. Generar código ejecutable
        // 3. Actualizar los handlers del bot
        
        logInfo('flowEditor', 'Flujo desplegado en producción', {
            nodeCount: flowData.nodes.length,
            startNodes: startNodes.length
        });
        
        res.json({ 
            success: true, 
            message: 'Flujo aplicado exitosamente',
            warning: 'Nota: La integración con el bot actual está en desarrollo'
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
                id: 'node-1',
                type: 'start',
                x: 50,
                y: 200,
                data: {
                    title: 'Inicio',
                    icon: 'fa-play-circle',
                    color: 'success',
                    isInitial: true
                }
            },
            {
                id: 'node-2',
                type: 'message',
                x: 250,
                y: 200,
                data: {
                    title: 'Saludo Inicial',
                    text: '¿En qué puedo ayudarte hoy?',
                    icon: 'fa-comment',
                    color: 'primary'
                }
            },
            {
                id: 'node-3',
                type: 'ai',
                x: 450,
                y: 100,
                data: {
                    title: 'Respuesta IA (Fase Inicial)',
                    prompt: 'promptInstitucional',
                    icon: 'fa-robot',
                    color: 'success'
                }
            },
            {
                id: 'node-4',
                type: 'condition',
                x: 650,
                y: 200,
                data: {
                    title: 'Usuario Agenda?',
                    variable: 'response',
                    operator: 'contains',
                    value: 'nuevaorden-1',
                    icon: 'fa-code-branch',
                    color: 'warning'
                }
            },
            {
                id: 'node-5',
                type: 'menu',
                x: 850,
                y: 100,
                data: {
                    title: 'Menú Post-Agendamiento',
                    options: [
                        { text: '¿A qué hora quedó mi cita?', next: 'node-10' },
                        { text: 'Problemas con la aplicación', next: 'node-11' },
                        { text: 'No me funciona el formulario', next: 'node-12' },
                        { text: 'Se me cerró la aplicación', next: 'node-13' },
                        { text: 'Hablar con un asesor', next: 'node-transfer' }
                    ],
                    icon: 'fa-list',
                    color: 'purple'
                }
            },
            {
                id: 'node-6',
                type: 'condition',
                x: 850,
                y: 300,
                data: {
                    title: 'Admin: Revisa Certificado?',
                    variable: 'adminMessage',
                    operator: 'contains',
                    value: 'revisa que todo esté en orden',
                    icon: 'fa-code-branch',
                    color: 'warning'
                }
            },
            {
                id: 'node-7',
                type: 'menu',
                x: 1050,
                y: 300,
                data: {
                    title: 'Revisión Certificado',
                    options: [
                        { text: 'Sí, está correcto', next: 'node-payment' },
                        { text: 'Hay un error que corregir', next: 'node-transfer' },
                        { text: 'No he podido revisarlo', next: 'node-help' },
                        { text: 'Hablar con un asesor', next: 'node-transfer' }
                    ],
                    icon: 'fa-list',
                    color: 'purple'
                }
            },
            {
                id: 'node-payment',
                type: 'payment',
                x: 1250,
                y: 250,
                data: {
                    title: 'Procesar Pago',
                    icon: 'fa-credit-card',
                    color: 'success'
                }
            },
            {
                id: 'node-pdf',
                type: 'pdf',
                x: 1450,
                y: 250,
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
                x: 1050,
                y: 450,
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
                x: 1650,
                y: 250,
                data: {
                    title: 'Fin',
                    icon: 'fa-stop-circle',
                    color: 'danger'
                }
            },
            {
                id: 'node-image',
                type: 'image',
                x: 450,
                y: 350,
                data: {
                    title: 'Procesar Imagen',
                    action: 'classify',
                    icon: 'fa-image',
                    color: 'info'
                }
            }
        ],
        connections: [
            { from: 'node-1', to: 'node-2' },
            { from: 'node-2', to: 'node-3' },
            { from: 'node-3', to: 'node-4' },
            { from: 'node-4', to: 'node-5' },
            { from: 'node-4', to: 'node-6' },
            { from: 'node-6', to: 'node-7' },
            { from: 'node-7', to: 'node-payment' },
            { from: 'node-payment', to: 'node-pdf' },
            { from: 'node-pdf', to: 'node-end' },
            { from: 'node-transfer', to: 'node-end' },
            { from: 'node-2', to: 'node-image' },
            { from: 'node-image', to: 'node-4' }
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
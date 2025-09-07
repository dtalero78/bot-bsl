// Dashboard JavaScript para BSL Bot Admin
class BotDashboard {
    constructor() {
        this.apiToken = null;
        this.currentSection = 'dashboard';
        this.baseURL = window.location.origin;
        this.refreshInterval = null;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkAuthAndLoad();
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('[data-section]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.showSection(e.target.closest('[data-section]').dataset.section);
            });
        });

        // Auth form
        document.getElementById('authForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.authenticate();
        });

        // Filters
        document.getElementById('searchInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.filterConversations();
            }
        });
    }

    checkAuthAndLoad() {
        this.apiToken = localStorage.getItem('botAdminToken');
        if (!this.apiToken) {
            this.showAuthModal();
        } else {
            this.loadDashboard();
        }
    }

    showAuthModal() {
        const modal = new bootstrap.Modal(document.getElementById('authModal'));
        modal.show();
    }

    async authenticate() {
        const token = document.getElementById('adminToken').value;
        const errorDiv = document.getElementById('authError');
        
        try {
            const response = await this.apiCall('/api/admin/dashboard', 'GET', null, token);
            
            if (response.success) {
                this.apiToken = token;
                localStorage.setItem('botAdminToken', token);
                bootstrap.Modal.getInstance(document.getElementById('authModal')).hide();
                this.loadDashboard();
                errorDiv.style.display = 'none';
            } else {
                throw new Error('Token inválido');
            }
        } catch (error) {
            errorDiv.textContent = 'Token inválido o error de conexión';
            errorDiv.style.display = 'block';
        }
    }

    logout() {
        localStorage.removeItem('botAdminToken');
        this.apiToken = null;
        window.location.reload();
    }

    async apiCall(endpoint, method = 'GET', data = null, token = null) {
        const headers = {
            'Content-Type': 'application/json'
        };

        if (token || this.apiToken) {
            headers['Authorization'] = `Bearer ${token || this.apiToken}`;
        }

        const config = {
            method,
            headers
        };

        if (data) {
            config.body = JSON.stringify(data);
        }

        const response = await fetch(`${this.baseURL}${endpoint}`, config);
        return await response.json();
    }

    showSection(section) {
        // Update navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-section="${section}"]`).classList.add('active');

        // Show section
        document.querySelectorAll('.content-section').forEach(sec => {
            sec.style.display = 'none';
        });
        document.getElementById(`${section}-section`).style.display = 'block';

        this.currentSection = section;

        // Load section data
        switch (section) {
            case 'dashboard':
                this.loadDashboard();
                break;
            case 'conversations':
                this.loadConversations();
                break;
            case 'metrics':
                this.loadMetrics();
                break;
            case 'health':
                this.loadHealth();
                break;
        }
    }

    async loadDashboard() {
        const container = document.getElementById('dashboardContent');
        container.innerHTML = '<div class="loading"><i class="bi bi-hourglass-split"></i> Cargando dashboard...</div>';

        try {
            const data = await this.apiCall('/api/admin/dashboard');
            
            if (data.success) {
                container.innerHTML = this.renderDashboard(data.dashboard);
            } else {
                container.innerHTML = `<div class="error-message">Error: ${data.error}</div>`;
            }
        } catch (error) {
            container.innerHTML = `<div class="error-message">Error cargando dashboard: ${error.message}</div>`;
        }
    }

    renderDashboard(dashboard) {
        const faseColors = {
            'inicial': 'primary',
            'post_agendamiento': 'warning',
            'revision_certificado': 'info',
            'pago': 'success'
        };

        return `
            <div class="row">
                <div class="col-md-3">
                    <div class="stat-card">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <h4>${dashboard.conversaciones.total}</h4>
                                <p class="mb-0">Total Conversaciones</p>
                            </div>
                            <i class="bi bi-chat-dots fs-1"></i>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <h4>${dashboard.conversaciones.activas24h}</h4>
                                <p class="mb-0">Activas (24h)</p>
                            </div>
                            <i class="bi bi-clock fs-1"></i>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <h4>${dashboard.conversaciones.bloqueadas}</h4>
                                <p class="mb-0">Bloqueadas</p>
                            </div>
                            <i class="bi bi-slash-circle fs-1"></i>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="stat-card">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <h4>${dashboard.fases.length}</h4>
                                <p class="mb-0">Fases Activas</p>
                            </div>
                            <i class="bi bi-diagram-3 fs-1"></i>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row mt-4">
                <div class="col-md-8">
                    <div class="card">
                        <div class="card-header">
                            <h5><i class="bi bi-pie-chart"></i> Distribución por Fases</h5>
                        </div>
                        <div class="card-body">
                            ${dashboard.fases.map(fase => `
                                <div class="d-flex justify-content-between align-items-center mb-3">
                                    <div class="d-flex align-items-center">
                                        <span class="badge bg-${faseColors[fase.fase] || 'secondary'} me-2">${fase.fase}</span>
                                        <span>${fase.count} conversaciones</span>
                                    </div>
                                    <div class="progress" style="width: 200px;">
                                        <div class="progress-bar bg-${faseColors[fase.fase] || 'secondary'}" 
                                             style="width: ${(fase.count / dashboard.conversaciones.total * 100)}%"></div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="card">
                        <div class="card-header">
                            <h5><i class="bi bi-info-circle"></i> Estado del Bot</h5>
                        </div>
                        <div class="card-body">
                            <div class="mb-3">
                                <strong>Estado General:</strong>
                                <span class="badge bg-success ms-2">Activo</span>
                            </div>
                            <div class="mb-3">
                                <strong>Última Actualización:</strong><br>
                                <small class="text-muted">${new Date().toLocaleString()}</small>
                            </div>
                            <button class="btn btn-outline-primary btn-sm w-100" onclick="dashboard.refreshDashboard()">
                                <i class="bi bi-arrow-clockwise"></i> Actualizar Dashboard
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async loadConversations(page = 1) {
        const container = document.getElementById('conversationsContent');
        container.innerHTML = '<div class="loading"><i class="bi bi-hourglass-split"></i> Cargando conversaciones...</div>';

        try {
            const fase = document.getElementById('faseFilter')?.value || '';
            const bloqueados = document.getElementById('statusFilter')?.value || '';
            const search = document.getElementById('searchInput')?.value || '';

            let query = `?page=${page}&limit=20`;
            if (fase) query += `&fase=${fase}`;
            if (bloqueados) query += `&bloqueados=${bloqueados}`;
            if (search) query += `&search=${encodeURIComponent(search)}`;

            const data = await this.apiCall(`/api/admin/conversations${query}`);
            
            if (data.success) {
                container.innerHTML = this.renderConversations(data);
            } else {
                container.innerHTML = `<div class="error-message">Error: ${data.error}</div>`;
            }
        } catch (error) {
            container.innerHTML = `<div class="error-message">Error cargando conversaciones: ${error.message}</div>`;
        }
    }

    renderConversations(data) {
        const { conversations, pagination } = data;

        if (conversations.length === 0) {
            return '<div class="text-center py-4"><i class="bi bi-inbox"></i> No se encontraron conversaciones</div>';
        }

        const faseColors = {
            'inicial': 'primary',
            'post_agendamiento': 'warning',
            'revision_certificado': 'info',
            'pago': 'success'
        };

        return `
            <div class="table-responsive">
                <table class="table table-hover">
                    <thead class="table-dark">
                        <tr>
                            <th>Usuario</th>
                            <th>Nombre</th>
                            <th>Fase</th>
                            <th>Mensajes</th>
                            <th>Estado</th>
                            <th>Última Actividad</th>
                            <th>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${conversations.map(conv => `
                            <tr class="conversation-row" data-user-id="${conv.user_id}">
                                <td><code>${conv.user_id}</code></td>
                                <td>${conv.nombre || 'Sin nombre'}</td>
                                <td>
                                    <span class="badge bg-${faseColors[conv.fase] || 'secondary'}">${conv.fase}</span>
                                </td>
                                <td>${conv.total_mensajes}</td>
                                <td>
                                    ${conv.observaciones?.includes('stop') 
                                        ? '<span class="badge bg-danger">Bloqueado</span>' 
                                        : '<span class="badge bg-success">Activo</span>'}
                                </td>
                                <td>${new Date(conv.updated_at).toLocaleString()}</td>
                                <td>
                                    <button class="btn btn-sm btn-outline-primary me-1" 
                                            onclick="dashboard.viewConversation('${conv.user_id}')"
                                            title="Ver conversación">
                                        <i class="bi bi-eye"></i>
                                    </button>
                                    <button class="btn btn-sm btn-outline-warning me-1" 
                                            onclick="dashboard.toggleUserBlock('${conv.user_id}', ${conv.observaciones?.includes('stop')})"
                                            title="${conv.observaciones?.includes('stop') ? 'Desbloquear' : 'Bloquear'}">
                                        <i class="bi bi-${conv.observaciones?.includes('stop') ? 'check-circle' : 'slash-circle'}"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <!-- Pagination -->
            <nav class="mt-4">
                <ul class="pagination justify-content-center">
                    <li class="page-item ${pagination.page <= 1 ? 'disabled' : ''}">
                        <a class="page-link" href="#" onclick="dashboard.loadConversations(${pagination.page - 1})">Anterior</a>
                    </li>
                    
                    ${Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                        const page = i + Math.max(1, pagination.page - 2);
                        return `<li class="page-item ${page === pagination.page ? 'active' : ''}">
                            <a class="page-link" href="#" onclick="dashboard.loadConversations(${page})">${page}</a>
                        </li>`;
                    }).join('')}
                    
                    <li class="page-item ${pagination.page >= pagination.totalPages ? 'disabled' : ''}">
                        <a class="page-link" href="#" onclick="dashboard.loadConversations(${pagination.page + 1})">Siguiente</a>
                    </li>
                </ul>
                
                <div class="text-center text-muted">
                    Página ${pagination.page} de ${pagination.totalPages} 
                    (${pagination.total} conversaciones total)
                </div>
            </nav>
        `;
    }

    async viewConversation(userId) {
        try {
            const data = await this.apiCall(`/api/admin/conversations/${userId}`);
            
            if (data.success) {
                this.showConversationModal(data.conversation);
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (error) {
            alert(`Error cargando conversación: ${error.message}`);
        }
    }

    showConversationModal(conversation) {
        const modal = new bootstrap.Modal(document.getElementById('conversationModal'));
        const body = document.getElementById('conversationModalBody');
        
        body.innerHTML = `
            <div class="mb-3">
                <h6>Usuario: <code>${conversation.userId}</code></h6>
                <p><strong>Nombre:</strong> ${conversation.nombre || 'Sin nombre'}</p>
                <p><strong>Fase:</strong> <span class="badge bg-primary">${conversation.fase}</span></p>
                <p><strong>Observaciones:</strong> ${conversation.observaciones || 'Ninguna'}</p>
            </div>
            
            <div class="mb-3">
                <h6>Historial de Mensajes (${conversation.mensajes.length})</h6>
                <div class="border rounded" style="max-height: 400px; overflow-y: auto; padding: 15px;">
                    ${conversation.mensajes.map(msg => {
                        const fromColors = {
                            'usuario': 'primary',
                            'sistema': 'success',
                            'admin': 'warning'
                        };
                        const time = new Date(msg.timestamp).toLocaleString();
                        
                        return `
                            <div class="mb-2 p-2 border-start border-${fromColors[msg.from] || 'secondary'} border-3">
                                <small class="text-muted">
                                    <strong>${msg.from}</strong> - ${time}
                                </small>
                                <div>${msg.mensaje}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
            
            <div class="mb-3">
                <h6>Enviar Mensaje</h6>
                <div class="input-group">
                    <input type="text" class="form-control" id="newMessage" placeholder="Escribe un mensaje...">
                    <button class="btn btn-primary" onclick="dashboard.sendMessage('${conversation.userId}')">
                        <i class="bi bi-send"></i> Enviar
                    </button>
                </div>
            </div>
        `;
        
        modal.show();
    }

    async sendMessage(userId) {
        const messageInput = document.getElementById('newMessage');
        const mensaje = messageInput.value.trim();
        
        if (!mensaje) return;
        
        try {
            const data = await this.apiCall(`/api/admin/conversations/${userId}/messages`, 'POST', { mensaje });
            
            if (data.success) {
                messageInput.value = '';
                this.showSuccess('Mensaje enviado correctamente');
                // Refresh conversation
                setTimeout(() => this.viewConversation(userId), 1000);
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (error) {
            alert(`Error enviando mensaje: ${error.message}`);
        }
    }

    async toggleUserBlock(userId, isCurrentlyBlocked) {
        const action = isCurrentlyBlocked ? 'desbloquear' : 'bloquear';
        
        if (!confirm(`¿Estás seguro de que quieres ${action} este usuario?`)) return;
        
        try {
            const observaciones = isCurrentlyBlocked ? '' : 'stop - bloqueado por admin';
            const data = await this.apiCall(`/api/admin/conversations/${userId}/observations`, 'PUT', { observaciones });
            
            if (data.success) {
                this.showSuccess(`Usuario ${action}ado correctamente`);
                this.loadConversations();
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (error) {
            alert(`Error ${action}ando usuario: ${error.message}`);
        }
    }

    async loadMetrics() {
        const container = document.getElementById('metricsContent');
        container.innerHTML = '<div class="loading"><i class="bi bi-hourglass-split"></i> Cargando métricas...</div>';

        try {
            const [performance, endpoints] = await Promise.all([
                this.apiCall('/api/metrics/performance'),
                this.apiCall('/api/metrics/endpoints')
            ]);
            
            if (performance.success && endpoints.success) {
                container.innerHTML = this.renderMetrics(performance.metrics, endpoints.endpoints);
            } else {
                container.innerHTML = `<div class="error-message">Error cargando métricas</div>`;
            }
        } catch (error) {
            container.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
        }
    }

    renderMetrics(metrics, endpoints) {
        return `
            <div class="row mb-4">
                <div class="col-md-3">
                    <div class="card metric-card">
                        <div class="card-body">
                            <h5 class="card-title">Requests Total</h5>
                            <h2 class="text-primary">${metrics.requests.total}</h2>
                            <small class="text-muted">${metrics.requests.success} exitosos</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card metric-card">
                        <div class="card-body">
                            <h5 class="card-title">Tiempo Promedio</h5>
                            <h2 class="text-info">${Math.round(metrics.requests.avgResponseTime)}ms</h2>
                            <small class="text-muted">Respuesta API</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card metric-card">
                        <div class="card-body">
                            <h5 class="card-title">Memoria</h5>
                            <h2 class="text-warning">${metrics.memory.rss}MB</h2>
                            <small class="text-muted">Heap: ${metrics.memory.heapUsed}MB</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card metric-card">
                        <div class="card-body">
                            <h5 class="card-title">Uptime</h5>
                            <h2 class="text-success">${Math.round(metrics.system.uptime / 3600)}h</h2>
                            <small class="text-muted">Sistema activo</small>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row">
                <div class="col-md-6">
                    <div class="card">
                        <div class="card-header">
                            <h5>Cache Performance</h5>
                        </div>
                        <div class="card-body">
                            <div class="mb-3">
                                <strong>Hit Rate:</strong> 
                                <span class="badge bg-${metrics.cache.hitRate > 0.8 ? 'success' : 'warning'}">
                                    ${(metrics.cache.hitRate * 100).toFixed(1)}%
                                </span>
                            </div>
                            <div class="mb-2"><strong>Hits:</strong> ${metrics.cache.hits}</div>
                            <div class="mb-2"><strong>Misses:</strong> ${metrics.cache.misses}</div>
                            <div><strong>Total Operations:</strong> ${metrics.cache.operations}</div>
                        </div>
                    </div>
                </div>
                
                <div class="col-md-6">
                    <div class="card">
                        <div class="card-header">
                            <h5>Top Endpoints</h5>
                        </div>
                        <div class="card-body">
                            ${endpoints.slice(0, 5).map(ep => `
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <div>
                                        <strong>${ep.endpoint}</strong><br>
                                        <small class="text-muted">${ep.requests} requests</small>
                                    </div>
                                    <div class="text-end">
                                        <span class="badge bg-${ep.errorRate === '0%' ? 'success' : 'warning'}">${ep.avgResponseTime}ms</span><br>
                                        <small class="text-muted">${ep.errorRate} errors</small>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    async loadHealth() {
        const container = document.getElementById('healthContent');
        container.innerHTML = '<div class="loading"><i class="bi bi-hourglass-split"></i> Verificando salud...</div>';

        try {
            const data = await fetch(`${this.baseURL}/health/detailed`).then(r => r.json());
            container.innerHTML = this.renderHealth(data);
        } catch (error) {
            container.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
        }
    }

    renderHealth(health) {
        const getStatusIcon = (status) => {
            switch (status) {
                case 'healthy': return '<i class="bi bi-check-circle-fill health-healthy"></i>';
                case 'degraded': return '<i class="bi bi-exclamation-triangle-fill health-degraded"></i>';
                case 'unhealthy': return '<i class="bi bi-x-circle-fill health-unhealthy"></i>';
                default: return '<i class="bi bi-question-circle-fill"></i>';
            }
        };

        return `
            <div class="row mb-4">
                <div class="col-12">
                    <div class="alert alert-${health.status === 'healthy' ? 'success' : 'warning'} d-flex align-items-center">
                        ${getStatusIcon(health.status)}
                        <div class="ms-2">
                            <strong>Estado General: ${health.status.toUpperCase()}</strong><br>
                            <small>Última verificación: ${new Date(health.timestamp).toLocaleString()}</small>
                        </div>
                    </div>
                </div>
            </div>

            <div class="row">
                <div class="col-md-6 mb-4">
                    <div class="card">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <h5>Base de Datos</h5>
                            ${getStatusIcon(health.services.database.status)}
                        </div>
                        <div class="card-body">
                            <div class="mb-2"><strong>Host:</strong> ${health.services.database.host}</div>
                            <div class="mb-2"><strong>Database:</strong> ${health.services.database.database}</div>
                            <div class="mb-2"><strong>Conexiones Totales:</strong> ${health.services.database.pool?.totalConnections || 'N/A'}</div>
                            <div class="mb-2"><strong>Conexiones Inactivas:</strong> ${health.services.database.pool?.idleConnections || 'N/A'}</div>
                            <div><strong>Tiempo de Respuesta:</strong> ${health.services.database.responseTime || 'N/A'}ms</div>
                        </div>
                    </div>
                </div>

                <div class="col-md-6 mb-4">
                    <div class="card">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <h5>Redis Cache</h5>
                            ${getStatusIcon(health.services.redis.status)}
                        </div>
                        <div class="card-body">
                            <div class="mb-2"><strong>URL:</strong> ${health.services.redis.url || 'N/A'}</div>
                            <div class="mb-2"><strong>Tiempo de Respuesta:</strong> ${health.services.redis.responseTime || 'N/A'}ms</div>
                            ${health.services.redis.stats ? `
                                <div class="mb-2"><strong>Memoria Usada:</strong> ${health.services.redis.stats.memoryUsed || 'N/A'}</div>
                                <div><strong>Claves Totales:</strong> ${health.services.redis.stats.totalKeys || 'N/A'}</div>
                            ` : ''}
                        </div>
                    </div>
                </div>

                <div class="col-md-6 mb-4">
                    <div class="card">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <h5>Sistema de Colas</h5>
                            ${getStatusIcon(health.services.queues.status)}
                        </div>
                        <div class="card-body">
                            <div class="mb-2"><strong>Procesando:</strong> 
                                <span class="badge bg-${health.services.queues.isProcessing ? 'success' : 'secondary'}">
                                    ${health.services.queues.isProcessing ? 'Sí' : 'No'}
                                </span>
                            </div>
                            <div class="mb-2"><strong>Tareas Pendientes:</strong> ${health.services.queues.totalPending}</div>
                            <div class="mb-2"><strong>Tareas Activas:</strong> ${health.services.queues.totalActive}</div>
                            <div><strong>Límite Máximo:</strong> ${health.services.queues.maxPendingAllowed}</div>
                        </div>
                    </div>
                </div>

                <div class="col-md-6 mb-4">
                    <div class="card">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <h5>Recursos del Sistema</h5>
                            ${getStatusIcon(health.services.system.status)}
                        </div>
                        <div class="card-body">
                            <div class="mb-2"><strong>Memoria RSS:</strong> ${health.services.system.memory.rss}MB</div>
                            <div class="mb-2"><strong>Heap Usado:</strong> ${health.services.system.memory.heapUsed}MB</div>
                            <div class="mb-2"><strong>Uptime:</strong> ${Math.round(health.services.system.uptime / 3600)}h</div>
                            <div class="mb-2"><strong>Node Version:</strong> ${health.services.system.nodeVersion}</div>
                            <div><strong>PID:</strong> ${health.services.system.pid}</div>
                            ${health.services.system.warnings?.length ? `
                                <div class="mt-2">
                                    <strong>Advertencias:</strong>
                                    ${health.services.system.warnings.map(w => `<div class="text-warning small">${w}</div>`).join('')}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Utility methods
    filterConversations() {
        this.loadConversations(1);
    }

    refreshDashboard() {
        this.loadDashboard();
    }

    refreshConversations() {
        this.loadConversations();
    }

    refreshMetrics() {
        this.loadMetrics();
    }

    refreshHealth() {
        this.loadHealth();
    }

    async clearCache() {
        if (!confirm('¿Estás seguro de que quieres limpiar el caché?')) return;

        try {
            const data = await this.apiCall('/api/admin/cache/clear', 'POST');
            if (data.success) {
                this.showSuccess(data.message);
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    async resetMetrics() {
        if (!confirm('¿Estás seguro de que quieres reiniciar las métricas?')) return;

        try {
            const data = await this.apiCall('/api/metrics/reset', 'POST');
            if (data.success) {
                this.showSuccess(data.message);
                this.loadMetrics();
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    async exportConversations() {
        try {
            const response = await fetch(`${this.baseURL}/api/admin/export/conversations`, {
                headers: { 'Authorization': `Bearer ${this.apiToken}` }
            });
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `conversations-export-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            this.showSuccess('Exportación iniciada');
        } catch (error) {
            alert(`Error exportando: ${error.message}`);
        }
    }

    async bulkStopBot() {
        const numbersText = document.getElementById('bulkNumbers').value.trim();
        const reason = document.getElementById('stopReason').value.trim() || 'Carga masiva';
        
        if (!numbersText) {
            alert('Debe ingresar al menos un número');
            return;
        }
        
        // Parsear números (separados por líneas, comas, espacios)
        const numbers = numbersText
            .split(/[\n,\s]+/)
            .map(n => n.trim())
            .filter(n => n.length > 0);
            
        if (numbers.length === 0) {
            alert('No se encontraron números válidos');
            return;
        }
        
        if (!confirm(`¿Está seguro de marcar ${numbers.length} números como stopBot?`)) {
            return;
        }
        
        try {
            const response = await this.apiCall('/api/admin/bulk/stopbot', 'POST', {
                numbers: numbers,
                reason: reason
            });
            
            if (response.success) {
                this.showSuccess(`Éxito: ${response.message}`);
                document.getElementById('bulkNumbers').value = '';
                document.getElementById('stopReason').value = '';
                
                // Mostrar detalles si hay errores
                if (response.results.errors.length > 0) {
                    console.log('Errores encontrados:', response.results.errors);
                    alert(`Procesado con ${response.results.errors.length} errores. Ver consola para detalles.`);
                }
            } else {
                alert(`Error: ${response.error}`);
            }
        } catch (error) {
            alert(`Error: ${error.message}`);
        }
    }

    showSuccess(message) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-success alert-dismissible fade show position-fixed';
        alert.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        document.body.appendChild(alert);
        
        setTimeout(() => {
            if (alert.parentNode) alert.parentNode.removeChild(alert);
        }, 3000);
    }
}

// Global functions for onclick handlers
function logout() {
    dashboard.logout();
}

function bulkStopBot() {
    dashboard.bulkStopBot();
}

function filterConversations() {
    dashboard.filterConversations();
}

function refreshMetrics() {
    dashboard.refreshMetrics();
}

function refreshHealth() {
    dashboard.refreshHealth();
}

function clearCache() {
    dashboard.clearCache();
}

function resetMetrics() {
    dashboard.resetMetrics();
}

// Initialize dashboard
const dashboard = new BotDashboard();
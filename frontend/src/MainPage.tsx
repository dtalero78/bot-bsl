import { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface DashboardData {
  conversaciones: {
    total: number;
    activas24h: number;
    bloqueadas: number;
  };
}

interface Conversation {
  user_id: string;
  nombre?: string;
  fase?: string;
  message_count: number;
  observaciones?: string;
  updated_at: string;
}

type ActiveSection = 'dashboard' | 'conversations' | 'metrics' | 'health' | 'tools';

export default function MainPage() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const API_TOKEN = 'admin-secret-token';

  // Authentication
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adminToken === API_TOKEN) {
      setIsAuthenticated(true);
      setAuthError('');
      loadDashboard();
    } else {
      setAuthError('Token de administrador inválido');
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setAdminToken('');
    setDashboardData(null);
    setConversations([]);
  };

  // Data loading functions
  const loadDashboard = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/dashboard', {
        headers: { 'Authorization': `Bearer ${API_TOKEN}` }
      });
      const data = await response.json();
      if (data.success) {
        setDashboardData(data.dashboard);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadConversations = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/conversations?page=1&limit=20', {
        headers: { 'Authorization': `Bearer ${API_TOKEN}` }
      });
      const data = await response.json();
      if (data.success) {
        setConversations(data.conversations);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearCache = async () => {
    try {
      const response = await fetch('/api/admin/cache/clear', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_TOKEN}` }
      });
      const data = await response.json();
      alert(data.message || 'Caché limpiado exitosamente');
    } catch (error) {
      alert('Error al limpiar el caché');
    }
  };

  // Navigation
  const navItems = [
    { id: 'dashboard', label: '📊 Dashboard' },
    { id: 'conversations', label: '💬 Conversaciones' },
    { id: 'metrics', label: '📈 Métricas' },
    { id: 'health', label: '❤️ Salud del Sistema' },
    { id: 'tools', label: '🛠️ Herramientas' }
  ];

  // Handle section changes
  useEffect(() => {
    if (isAuthenticated) {
      switch (activeSection) {
        case 'dashboard':
          loadDashboard();
          break;
        case 'conversations':
          loadConversations();
          break;
      }
    }
  }, [activeSection, isAuthenticated]);

  // Login Modal
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center text-2xl">
              🔐
            </div>
            <CardTitle className="text-2xl">BSL Bot Admin</CardTitle>
            <CardDescription>
              Ingresa el token de administrador para acceder al dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <input
                  type="password"
                  placeholder="Token de Admin"
                  value={adminToken}
                  onChange={(e) => setAdminToken(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              {authError && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">
                  {authError}
                </div>
              )}
              <Button type="submit" className="w-full">
                🔐 Acceder
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main Dashboard
  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-slate-900 text-white min-h-screen flex-col p-4 hidden md:flex">
          <div className="mb-8">
            <div className="flex items-center mb-6">
              <div className="w-8 h-8 mr-3 text-2xl">🤖</div>
              <span className="text-xl font-bold">BSL Bot Admin</span>
            </div>
            
            <nav className="space-y-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id as ActiveSection)}
                  className={`w-full text-left px-3 py-3 rounded-md transition-colors ${
                    activeSection === item.id 
                      ? 'bg-blue-600 text-white' 
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="mt-6 pt-6 border-t border-slate-700 space-y-2">
              <a
                href="/dashboard"
                className="block px-3 py-2 text-slate-300 hover:bg-slate-700 hover:text-white rounded-md transition-colors"
              >
                📱 Dashboard React
              </a>
              <a
                href="/flow-builder.html"
                target="_blank"
                rel="noopener noreferrer"
                className="block px-3 py-2 text-slate-300 hover:bg-slate-700 hover:text-white rounded-md transition-colors"
              >
                🔧 Constructor Flujo
              </a>
              <a
                href="/flow-editor.html"
                target="_blank"
                rel="noopener noreferrer"
                className="block px-3 py-2 text-slate-300 hover:bg-slate-700 hover:text-white rounded-md transition-colors"
              >
                ✏️ Editor Visual
              </a>
            </div>
          </div>

          <div className="mt-auto">
            <Button 
              onClick={handleLogout}
              variant="outline" 
              className="w-full text-white border-slate-600 hover:bg-slate-700"
            >
              🚪 Cerrar Sesión
            </Button>
          </div>
        </aside>

        {/* Mobile Menu */}
        <div className="md:hidden fixed top-4 left-4 z-50">
          <Button variant="outline" size="sm">
            ☰ Menu
          </Button>
        </div>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {/* Dashboard Section */}
          {activeSection === 'dashboard' && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">📊 Dashboard</h1>
                <Button onClick={loadDashboard} variant="outline">
                  🔄 Actualizar
                </Button>
              </div>

              {loading ? (
                <div className="text-center py-20">
                  <div className="text-4xl mb-4">⏳</div>
                  <p className="text-muted-foreground">Cargando dashboard...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Total Conversaciones
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">
                        {dashboardData?.conversaciones.total || 0}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Activas (24h)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-green-600">
                        {dashboardData?.conversaciones.activas24h || 0}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Usuarios Bloqueados
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-red-600">
                        {dashboardData?.conversaciones.bloqueadas || 0}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Tasa de Respuesta
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-blue-600">
                        {dashboardData?.conversaciones.total > 0 
                          ? ((dashboardData.conversaciones.activas24h / dashboardData.conversaciones.total) * 100).toFixed(1)
                          : 0}%
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Quick Links */}
              <div className="mt-8">
                <h2 className="text-xl font-semibold mb-4">🔗 Enlaces Rápidos</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => window.open('/dashboard', '_blank')}>
                    <CardContent className="pt-6 text-center">
                      <div className="text-3xl mb-2">📱</div>
                      <h3 className="font-medium">Dashboard React</h3>
                      <p className="text-sm text-muted-foreground">Panel moderno con componentes shadcn/ui</p>
                    </CardContent>
                  </Card>

                  <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => window.open('/flow-builder.html', '_blank')}>
                    <CardContent className="pt-6 text-center">
                      <div className="text-3xl mb-2">🔧</div>
                      <h3 className="font-medium">Constructor Flujo</h3>
                      <p className="text-sm text-muted-foreground">Crear y editar flujos de conversación</p>
                    </CardContent>
                  </Card>

                  <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => window.open('/health', '_blank')}>
                    <CardContent className="pt-6 text-center">
                      <div className="text-3xl mb-2">💚</div>
                      <h3 className="font-medium">Health Check</h3>
                      <p className="text-sm text-muted-foreground">Monitor del estado del sistema</p>
                    </CardContent>
                  </Card>

                  <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => window.open('/metrics', '_blank')}>
                    <CardContent className="pt-6 text-center">
                      <div className="text-3xl mb-2">📈</div>
                      <h3 className="font-medium">Métricas</h3>
                      <p className="text-sm text-muted-foreground">Análisis de performance del sistema</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}

          {/* Conversations Section */}
          {activeSection === 'conversations' && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">💬 Conversaciones</h1>
                <div className="flex gap-2">
                  <Button variant="outline">
                    📥 Exportar
                  </Button>
                  <Button onClick={loadConversations} variant="outline">
                    🔄 Actualizar
                  </Button>
                </div>
              </div>

              {loading ? (
                <div className="text-center py-20">
                  <div className="text-4xl mb-4">⏳</div>
                  <p className="text-muted-foreground">Cargando conversaciones...</p>
                </div>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-4 font-medium">Usuario</th>
                            <th className="text-left p-4 font-medium">Nombre</th>
                            <th className="text-left p-4 font-medium">Fase</th>
                            <th className="text-left p-4 font-medium">Mensajes</th>
                            <th className="text-left p-4 font-medium">Estado</th>
                            <th className="text-left p-4 font-medium">Última Actividad</th>
                          </tr>
                        </thead>
                        <tbody>
                          {conversations.map((conv, index) => {
                            const isBlocked = conv.observaciones?.toLowerCase().includes('stop');
                            return (
                              <tr key={conv.user_id} className={`border-b hover:bg-muted/25 ${index % 2 === 0 ? 'bg-background' : 'bg-muted/10'}`}>
                                <td className="p-4 font-mono text-sm">{conv.user_id}</td>
                                <td className="p-4">{conv.nombre || 'Sin nombre'}</td>
                                <td className="p-4">
                                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                                    {conv.fase || 'inicial'}
                                  </span>
                                </td>
                                <td className="p-4">{conv.message_count || 0}</td>
                                <td className="p-4">
                                  <span className={`px-2 py-1 rounded-full text-xs ${isBlocked ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                    {isBlocked ? '🚫 Bloqueado' : '✅ Activo'}
                                  </span>
                                </td>
                                <td className="p-4 text-sm text-muted-foreground">
                                  {new Date(conv.updated_at).toLocaleString('es-CO')}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Other Sections */}
          {activeSection === 'tools' && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">🛠️ Herramientas de Administración</h1>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>🗑️ Limpiar Caché</CardTitle>
                    <CardDescription>
                      Elimina el caché de Redis para forzar la recarga de datos desde la base de datos.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button onClick={clearCache} variant="destructive">
                      🗑️ Limpiar Caché
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>🔄 Reset Métricas</CardTitle>
                    <CardDescription>
                      Reinicia las métricas de performance (solo disponible en desarrollo).
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant="secondary">
                      🔄 Reset Métricas
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Other sections placeholders */}
          {(activeSection === 'metrics' || activeSection === 'health') && (
            <div>
              <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">
                  {activeSection === 'metrics' ? '📈 Métricas de Performance' : '❤️ Salud del Sistema'}
                </h1>
                <Button variant="outline">
                  🔄 Actualizar
                </Button>
              </div>
              
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-20">
                    <div className="text-6xl mb-4">🚧</div>
                    <p className="text-muted-foreground text-lg">
                      Esta sección está en desarrollo...
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
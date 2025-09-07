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

function App() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const API_TOKEN = 'admin-secret-token';

  const loadDashboard = async () => {
    try {
      const response = await fetch('/api/admin/dashboard', {
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`
        }
      });
      
      if (!response.ok) throw new Error('Error al cargar dashboard');
      
      const data = await response.json();
      
      if (data.success) {
        setDashboardData(data.dashboard);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
    }
  };

  const loadConversations = async () => {
    try {
      const response = await fetch('/api/admin/conversations?page=1&limit=10', {
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`
        }
      });
      
      if (!response.ok) throw new Error('Error al cargar conversaciones');
      
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

  useEffect(() => {
    loadDashboard();
    loadConversations();
    
    const interval = setInterval(() => {
      loadDashboard();
      loadConversations();
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-20">
            <h2 className="text-2xl font-semibold text-gray-600">Cargando dashboard...</h2>
          </div>
        </div>
      </div>
    );
  }

  const responseRate = dashboardData?.conversaciones ? 
    ((dashboardData.conversaciones.activas24h / dashboardData.conversaciones.total) * 100).toFixed(1) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-3xl font-bold text-gray-800">
              🤖 BSL WhatsApp Bot Dashboard
            </CardTitle>
            <CardDescription className="text-lg">
              Panel de control y estadísticas en tiempo real
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              <Button variant="outline" className="h-20 flex-col gap-2" asChild>
                <a href="/admin-dashboard.html">
                  <span className="text-2xl">📊</span>
                  <span>Panel Principal</span>
                </a>
              </Button>
              <Button variant="outline" className="h-20 flex-col gap-2" asChild>
                <a href="/flow-builder.html">
                  <span className="text-2xl">🔧</span>
                  <span>Constructor Flujo</span>
                </a>
              </Button>
              <Button variant="outline" className="h-20 flex-col gap-2" asChild>
                <a href="/flow-editor.html">
                  <span className="text-2xl">✏️</span>
                  <span>Editor Flujo</span>
                </a>
              </Button>
              <Button variant="outline" className="h-20 flex-col gap-2" asChild>
                <a href="/health" target="_blank">
                  <span className="text-2xl">💓</span>
                  <span>Health Check</span>
                </a>
              </Button>
              <Button variant="outline" className="h-20 flex-col gap-2" asChild>
                <a href="/metrics" target="_blank">
                  <span className="text-2xl">📈</span>
                  <span>Métricas</span>
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Conversaciones</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {dashboardData?.conversaciones.total || 0}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Activas (24h)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {dashboardData?.conversaciones.activas24h || 0}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Usuarios Bloqueados</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {dashboardData?.conversaciones.bloqueadas || 0}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Tasa de Respuesta</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {responseRate}%
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Conversations */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Conversaciones Recientes</CardTitle>
              <Button onClick={() => { loadDashboard(); loadConversations(); }} variant="outline">
                🔄 Actualizar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3">Usuario</th>
                    <th className="text-left p-3">Nombre</th>
                    <th className="text-left p-3">Fase</th>
                    <th className="text-left p-3">Mensajes</th>
                    <th className="text-left p-3">Estado</th>
                    <th className="text-left p-3">Última Actividad</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conv) => {
                    const isBlocked = conv.observaciones?.toLowerCase().includes('stop');
                    const statusClass = isBlocked ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800';
                    const statusText = isBlocked ? 'Bloqueado' : 'Activo';
                    const lastActivity = new Date(conv.updated_at).toLocaleString('es-CO');
                    
                    return (
                      <tr key={conv.user_id} className="border-b hover:bg-gray-50">
                        <td className="p-3 font-mono text-sm">{conv.user_id}</td>
                        <td className="p-3">{conv.nombre || 'Sin nombre'}</td>
                        <td className="p-3">
                          <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                            {conv.fase || 'inicial'}
                          </span>
                        </td>
                        <td className="p-3">{conv.message_count || 0}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded-full text-xs ${statusClass}`}>
                            {statusText}
                          </span>
                        </td>
                        <td className="p-3 text-sm text-gray-600">{lastActivity}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App

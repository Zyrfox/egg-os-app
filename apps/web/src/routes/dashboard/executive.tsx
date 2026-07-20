import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/auth-store'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BarChart3, AlertTriangle, RefreshCcw, TrendingUp } from 'lucide-react'

type ExecData = {
  outlet_status: Array<{
    outlet_id: string
    outlet_name: string
    opening_status: string
    closing_status: string
  }>
  report_compliance: Array<{
    outlet_id: string
    compliant_days: number
    elapsed_days: number
    calendar_days: number | null
    compliance_to_date_pct: number
  }>
  approval_pending: Array<{
    outlet_id: string
    submitted_count: number
    validated_count: number
  }>
  stock_discrepancy: Array<{
    outlet_id: string
    item_id: string
    item_name: string
    total_delta: string
  }>
}

export const Route = createFileRoute('/dashboard/executive')({
  beforeLoad: () => {
    const { accessToken } = useAuthStore.getState()
    if (!accessToken) throw redirect({ to: '/login' })
  },
  component: ExecutiveDashboard,
})

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function ExecutiveDashboard() {
  const month = currentMonth()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'executive', month],
    queryFn: async () => {
      const res = await api.get(`/dashboards/executive?month=${month}`)
      return res.data.data as ExecData
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}><CardHeader><Skeleton className="h-5 w-32" /></CardHeader><CardContent><Skeleton className="h-24 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-700">
            <AlertTriangle size={18} />
            <span>Gagal memuat data dashboard</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCcw size={14} className="mr-1" />Coba lagi
          </Button>
        </CardContent>
      </Card>
    )
  }

  const pendingTotal = data?.approval_pending?.reduce((sum, a) => sum + a.submitted_count, 0) ?? 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--brand-accent-1)' }}>
        Dashboard Executive
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Compliance per outlet */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <TrendingUp size={18} />
            <CardTitle className="text-base">Compliance Report</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.report_compliance?.length ? (
              <div className="space-y-3">
                {data.report_compliance.map((c) => (
                  <div key={c.outlet_id} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{c.outlet_id.slice(0, 8)}</span>
                      <span className="font-medium">{c.compliance_to_date_pct.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width: `${Math.min(c.compliance_to_date_pct, 100)}%`,
                          background: c.compliance_to_date_pct < 50
                            ? 'var(--brand-micro, #C0F926)'
                            : 'var(--brand-accent-1)',
                        }}
                      />
                    </div>
                    <div className="text-xs text-gray-400">
                      {c.compliant_days} / {c.elapsed_days} hari compliant
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Belum ada data</p>
            )}
          </CardContent>
        </Card>

        {/* Outlet status */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <BarChart3 size={18} />
            <CardTitle className="text-base">Status Outlet</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.outlet_status?.length ? (
              <div className="space-y-2">
                {data.outlet_status.map((s) => (
                  <div key={s.outlet_id} className="flex items-center justify-between text-sm">
                    <span>{s.outlet_name}</span>
                    <div className="flex gap-2">
                      <Badge variant={s.opening_status === 'completed' ? 'default' : 'outline'}>
                        {s.opening_status === 'completed' ? 'opening ✓' : 'opening —'}
                      </Badge>
                      <Badge variant={s.closing_status === 'completed' ? 'default' : 'outline'}>
                        {s.closing_status === 'completed' ? 'closing ✓' : 'closing —'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Belum ada data</p>
            )}
          </CardContent>
        </Card>

        {/* Pending approvals summary */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <AlertTriangle size={18} />
            <CardTitle className="text-base">Approval Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold" style={{ color: 'var(--brand-accent-1)' }}>
              {pendingTotal}
            </div>
            <p className="text-sm text-gray-400 mt-1">Total item menunggu approval</p>
          </CardContent>
        </Card>

        {/* Top discrepancies */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <AlertTriangle size={18} />
            <CardTitle className="text-base">Top Discrepancies</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.stock_discrepancy?.length ? (
              <div className="space-y-2">
                {data.stock_discrepancy.slice(0, 5).map((d, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{d.item_name}</span>
                    <span className="font-mono text-red-600">{d.total_delta}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Tidak ada discrepancy</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

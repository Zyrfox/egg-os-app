import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/auth-store'
import { applyBrandTheme, BRAND_SLUG_MAP } from '@/lib/brand-theme'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileText, ClipboardCheck, AlertTriangle, RefreshCcw } from 'lucide-react'

type SpvData = {
  report_today: Array<{
    outlet_id: string
    report_type: string
    report_id: string | null
    status: string | null
    submitted_by_name: string | null
    checked_count: number
  }>
  pending_validation: {
    reports_submitted: { count: number; items: Array<{ id: string; outlet_id: string; type: string }> }
  } | null
  opname_today: Array<{ id: string; outlet_id: string; status: string }>
  issue_log: Array<{ id: string; outlet_id: string; title: string; severity: string }>
  evidence_missing: Array<{ report_id: string | null; outlet_id: string; report_type: string }>
}

export const Route = createFileRoute('/dashboard/spv')({
  beforeLoad: () => {
    const { accessToken } = useAuthStore.getState()
    if (!accessToken) throw redirect({ to: '/login' })
  },
  component: SpvDashboard,
})

function todayWIB(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 420)
  return d.toISOString().slice(0, 10)
}

function SpvDashboard() {
  const date = todayWIB()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'spv', date],
    queryFn: async () => {
      const res = await api.get(`/dashboards/spv?date=${date}`)
      const body = res.data.data as SpvData
      const outletId = body.report_today?.[0]?.outlet_id ?? null
      if (outletId && BRAND_SLUG_MAP[outletId]) {
        applyBrandTheme(BRAND_SLUG_MAP[outletId])
      }
      return body
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
              <CardContent><Skeleton className="h-24 w-full" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle size={18} />
              <span>Gagal memuat data dashboard</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCcw size={14} className="mr-1" />
              Coba lagi
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--brand-accent-1)' }}>
        Dashboard SPV
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Report Today */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <FileText size={18} />
            <CardTitle className="text-base">Report Hari Ini</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.report_today?.length ? (
              <div className="space-y-2">
                {data.report_today.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                    <span>{r.report_type}</span>
                    <Badge variant={r.status === 'submitted' || r.status === 'validated' ? 'default' : 'outline'}>
                      {r.status ?? 'belum dibuat'}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Belum ada report hari ini</p>
            )}
          </CardContent>
        </Card>

        {/* Pending Validation */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <ClipboardCheck size={18} />
            <CardTitle className="text-base">Menunggu Validasi</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.pending_validation ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Reports</span>
                  <Badge>{data.pending_validation.reports_submitted.count}</Badge>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Tidak ada pending</p>
            )}
          </CardContent>
        </Card>

        {/* Opname Today */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <AlertTriangle size={18} />
            <CardTitle className="text-base">Opname Hari Ini</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.opname_today?.length ? (
              <div className="space-y-2">
                {data.opname_today.map((o) => (
                  <div key={o.id} className="flex justify-between text-sm">
                    <span>#{o.id.slice(0, 8)}</span>
                    <Badge variant="outline">{o.status}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Tidak ada opname</p>
            )}
          </CardContent>
        </Card>

        {/* Evidence Missing */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <FileText size={18} />
            <CardTitle className="text-base">Evidence Belum Lengkap</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.evidence_missing?.length ? (
              <div className="space-y-2 text-sm">
                {data.evidence_missing.map((e, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{e.report_type}</span>
                    <span className="text-gray-400">{e.outlet_id.slice(0, 8)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Semua evidence lengkap</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

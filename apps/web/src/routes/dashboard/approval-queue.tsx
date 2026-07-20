import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/auth-store'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClipboardCheck, AlertTriangle, RefreshCcw, FileText } from 'lucide-react'

type QueueItem = {
  id: string
  type: string
  outlet_id: string
  submitted_by: string
  submitted_by_name: string
  submitted_at: string
  status: string
}

type QueueData = {
  stock_movements: {
    to_validate: QueueItem[]
    to_finalize: QueueItem[]
  }
  reports_to_validate: QueueItem[]
}

export const Route = createFileRoute('/dashboard/approval-queue')({
  beforeLoad: () => {
    const { accessToken } = useAuthStore.getState()
    if (!accessToken) throw redirect({ to: '/login' })
  },
  component: ApprovalQueueDashboard,
})

function todayWIB(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset() + 420)
  return d.toISOString().slice(0, 10)
}

function ApprovalQueueDashboard() {
  const date = todayWIB()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'approval-queue', date],
    queryFn: async () => {
      const res = await api.get(`/dashboards/approval-queue?date=${date}`)
      return res.data.data as QueueData
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3].map((i) => (
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

  const stockToValidate = data?.stock_movements?.to_validate ?? []
  const stockToFinalize = data?.stock_movements?.to_finalize ?? []
  const reports = data?.reports_to_validate ?? []

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--brand-accent-1)' }}>
        Approval Queue
      </h1>

      <div className="space-y-4">
        {/* Stock movements — to validate */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <ClipboardCheck size={18} />
            <CardTitle className="text-base">Stock Movement — Perlu Validasi ({stockToValidate.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {stockToValidate.length ? (
              <div className="space-y-2">
                {stockToValidate.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                    <div>
                      <div className="font-medium">{item.type}</div>
                      <div className="text-xs text-gray-400">oleh {item.submitted_by_name} · {item.outlet_id.slice(0, 8)}</div>
                    </div>
                    <Badge variant="outline">{item.status}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Tidak ada item menunggu validasi</p>
            )}
          </CardContent>
        </Card>

        {/* Stock movements — to finalize */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <ClipboardCheck size={18} />
            <CardTitle className="text-base">Stock Movement — Perlu Finalisasi ({stockToFinalize.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {stockToFinalize.length ? (
              <div className="space-y-2">
                {stockToFinalize.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                    <div>
                      <div className="font-medium">{item.type}</div>
                      <div className="text-xs text-gray-400">oleh {item.submitted_by_name} · {item.outlet_id.slice(0, 8)}</div>
                    </div>
                    <Badge>{item.status}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Tidak ada item menunggu finalisasi</p>
            )}
          </CardContent>
        </Card>

        {/* Reports to validate */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <FileText size={18} />
            <CardTitle className="text-base">Reports — Perlu Validasi ({reports.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {reports.length ? (
              <div className="space-y-2">
                {reports.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                    <div>
                      <div className="font-medium">{item.type}</div>
                      <div className="text-xs text-gray-400">oleh {item.submitted_by_name} · {item.outlet_id.slice(0, 8)}</div>
                    </div>
                    <Badge variant="outline">{item.status}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Tidak ada report menunggu validasi</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

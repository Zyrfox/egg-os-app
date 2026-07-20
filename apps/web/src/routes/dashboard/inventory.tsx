import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/auth-store'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Package, AlertTriangle, RefreshCcw } from 'lucide-react'

type InvData = {
  stock_critical: Array<{
    outlet_id: string
    item_id: string
    item_name: string
    stock_qty: string
    min_stock: string | null
  }>
  movement_today: Array<{
    type: string
    count: number
  }>
  waste_summary: Array<{
    outlet_id: string
    item_name: string
    qty: string
  }>
  pending_validation: {
    approval_count: number
    waste_count: number
  } | null
  top_discrepancy: Array<{
    item_name: string
    total_delta: string
  }>
}

export const Route = createFileRoute('/dashboard/inventory')({
  beforeLoad: () => {
    const { accessToken } = useAuthStore.getState()
    if (!accessToken) throw redirect({ to: '/login' })
  },
  component: InventoryDashboard,
})

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function InventoryDashboard() {
  const month = currentMonth()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'inventory', month],
    queryFn: async () => {
      const res = await api.get(`/dashboards/inventory?month=${month}`)
      return res.data.data as InvData
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--brand-accent-1)' }}>
        Dashboard Inventory
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Stock critical */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <AlertTriangle size={18} />
            <CardTitle className="text-base">Stok Kritis</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.stock_critical?.length ? (
              <div className="space-y-2">
                {data.stock_critical.map((s, i) => (
                  <div key={i} className="flex justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                    <div>
                      <div className="font-medium">{s.item_name}</div>
                      <div className="text-xs text-gray-400">Stok: {s.stock_qty} {s.min_stock ? `/ min: ${s.min_stock}` : ''}</div>
                    </div>
                    <Badge variant="outline" className="h-fit">low</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Semua stok aman</p>
            )}
          </CardContent>
        </Card>

        {/* Movement today */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Package size={18} />
            <CardTitle className="text-base">Movement Hari Ini</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.movement_today?.length ? (
              <div className="space-y-2">
                {data.movement_today.map((m, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{m.type}</span>
                    <Badge variant="secondary">{m.count}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Belum ada movement</p>
            )}
          </CardContent>
        </Card>

        {/* Waste summary */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <AlertTriangle size={18} />
            <CardTitle className="text-base">Waste Bulan Ini</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.waste_summary?.length ? (
              <div className="space-y-2">
                {data.waste_summary.map((w, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>{w.item_name}</span>
                    <span className="font-mono text-red-600">{w.qty}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Tidak ada waste</p>
            )}
          </CardContent>
        </Card>

        {/* Pending validation */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Package size={18} />
            <CardTitle className="text-base">Menunggu Validasi</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.pending_validation ? (
              <div className="space-y-4 text-sm">
                <div className="flex justify-between">
                  <span>Approvals</span>
                  <Badge>{data.pending_validation.approval_count}</Badge>
                </div>
                <div className="flex justify-between">
                  <span>Waste Reports</span>
                  <Badge variant="outline">{data.pending_validation.waste_count}</Badge>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Tidak ada pending</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Check, CreditCard, Plus, X } from 'lucide-react'
import { toast } from 'react-hot-toast'
import depth from '@/styles/clinic-depth.module.css'
import { formatCurrencyTR, formatDynamicDateTR } from './types'

interface LinkedPaymentItem {
  rowId: string
  tableId: string
  title: string
  amount: number
  date: string
  status: 'completed' | 'pending' | 'cancelled'
  statusLabel: string
  methodLabel: string | null
}

interface AppointmentPaymentContext {
  appointmentId: string
  linkedPayments: LinkedPaymentItem[]
  linkedPersonRow: { id: string; tableId: string; displayTitle: string } | null
  linkedServiceRows: Array<{
    id: string
    tableId: string
    displayTitle: string
    suggestedAmount: number
  }>
  suggestedAmount: number
}

interface AppointmentDynamicPaymentSectionProps {
  appointmentId: string
  appointmentTitle?: string
  linksRefreshKey?: string
}

const METHODS = [
  'Nakit (Kasa)',
  'Kredi Kartı / POS',
  'Havale / EFT / FAST',
  'Online Ödeme / Sanal POS',
  'Çek / Senet',
  'Vadeli / Açık Hesap',
  'Diğer / Kurum',
]

export default function AppointmentDynamicPaymentSection({
  appointmentId,
  appointmentTitle = '',
  linksRefreshKey = '',
}: AppointmentDynamicPaymentSectionProps) {
  const [hasFinanceTables, setHasFinanceTables] = useState(false)
  const [ctx, setCtx] = useState<AppointmentPaymentContext | null>(null)
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('Nakit (Kasa)')
  const [status, setStatus] = useState<'completed' | 'pending'>('completed')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const loadContext = useCallback(async () => {
    if (!appointmentId) return
    try {
      const res = await fetch(
        `/api/dynamic-tables/finance/overview?appointmentId=${encodeURIComponent(appointmentId)}`,
        { credentials: 'include' }
      )
      if (!res.ok) return
      const data = await res.json().catch(() => null)
      if (!data) return
      setHasFinanceTables(Boolean(data.hasFinanceTables))
      setCtx(data.appointmentContext || null)
    } catch {
      // Sessizce geç
    } finally {
      setLoading(false)
    }
  }, [appointmentId])

  useEffect(() => {
    setFormOpen(false)
    setLoading(true)
    void loadContext()
  }, [loadContext, linksRefreshKey])

  const openQuickForm = () => {
    const paidSoFar = (ctx?.linkedPayments || [])
      .filter((p) => p.status === 'completed')
      .reduce((acc, p) => acc + p.amount, 0)
    const remaining = Math.max(0, (ctx?.suggestedAmount || 0) - paidSoFar)
    if (remaining > 0) {
      setAmount(String(remaining))
    } else if ((ctx?.suggestedAmount || 0) > 0) {
      setAmount(String(ctx!.suggestedAmount))
    } else {
      setAmount('')
    }
    setMethod('Nakit (Kasa)')
    setStatus('completed')
    setNotes('')
    setFormOpen(true)
  }

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = Number(String(amount).replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Lütfen geçerli bir tahsilat tutarı giriniz')
      return
    }

    const serviceNames = (ctx?.linkedServiceRows || []).map((s) => s.displayTitle).join(', ')
    const personName = ctx?.linkedPersonRow?.displayTitle || ''
    const title =
      serviceNames && personName
        ? `${personName} — ${serviceNames}`
        : serviceNames || personName || appointmentTitle || 'Randevu Tahsilatı'

    setSaving(true)
    try {
      const res = await fetch('/api/dynamic-tables/finance/quick-entry', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryType: 'income',
          title,
          amount: parsed,
          status,
          method,
          notes: notes.trim() || undefined,
          personRowId: ctx?.linkedPersonRow?.id || null,
          serviceRowIds: (ctx?.linkedServiceRows || []).map((s) => s.id),
          appointmentId,
        }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(payload.error || 'Tahsilat kaydedilemedi')
        return
      }
      toast.success('Randevu tahsilatı dinamik finans tablosuna kaydedildi')
      setFormOpen(false)
      await loadContext()
    } catch {
      toast.error('Tahsilat kaydedilirken hata oluştu')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null
  if (!hasFinanceTables && (ctx?.linkedServiceRows.length || 0) === 0) return null

  const payments = ctx?.linkedPayments || []
  const paidSum = payments
    .filter((p) => p.status === 'completed')
    .reduce((acc, p) => acc + p.amount, 0)
  const pendingSum = payments
    .filter((p) => p.status === 'pending')
    .reduce((acc, p) => acc + p.amount, 0)

  return (
    <div
      className={depth.subcard}
      style={{
        marginTop: 10,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'var(--card-bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <CreditCard size={14} style={{ color: 'var(--pc-blue)' }} />
          <strong style={{ fontSize: 12.5, color: 'var(--foreground)' }}>
            Tahsilat &amp; Ödeme
          </strong>
          {paidSum > 0 && (
            <span className={depth.badge} style={{ fontSize: 10.5 }}>
              {formatCurrencyTR(paidSum)} Tahsil
            </span>
          )}
          {pendingSum > 0 && (
            <span className={depth.badge} style={{ fontSize: 10.5, color: 'var(--danger)' }}>
              {formatCurrencyTR(pendingSum)} Bekliyor
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => (formOpen ? setFormOpen(false) : openQuickForm())}
          className={formOpen ? depth.btn : depth.btnPrimary}
          style={{ minHeight: 27, padding: '3px 10px', fontSize: 11.5 }}
        >
          {formOpen ? (
            <>
              <X size={12} />
              <span>Kapat</span>
            </>
          ) : (
            <>
              <Plus size={12} color="#ffffff" />
              <span style={{ color: '#ffffff' }}>Tahsilat Ekle</span>
            </>
          )}
        </button>
      </div>

      {ctx && ctx.suggestedAmount > 0 && payments.length === 0 && !formOpen && (
        <div style={{ fontSize: 11.5, color: 'var(--pc-muted)' }}>
          Seçili işlem/teklif/hizmet önerilen tutarı:{' '}
          <strong style={{ color: 'var(--foreground)' }}>
            {formatCurrencyTR(ctx.suggestedAmount)}
          </strong>
        </div>
      )}

      {payments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {payments.slice(0, 6).map((p) => (
            <div
              key={p.rowId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                padding: '5px 8px',
                borderRadius: 8,
                background: 'var(--pc-surface)',
                border: '1px solid var(--pc-border)',
                fontSize: 11.5,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <strong style={{ color: 'var(--foreground)' }}>
                  {formatCurrencyTR(p.amount)}
                </strong>
                <span style={{ color: 'var(--pc-muted)' }}>
                  {' '}
                  • {p.methodLabel || 'Ödeme'} • {formatDynamicDateTR(p.date)}
                </span>
              </div>
              <span
                className={depth.badge}
                style={{
                  fontSize: 10,
                  padding: '1px 7px',
                  color: p.status === 'pending' ? 'var(--danger)' : undefined,
                }}
              >
                {p.statusLabel}
              </span>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <form
          onSubmit={handleSavePayment}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            paddingTop: 6,
            borderTop: '1px solid var(--pc-border)',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Tutar (₺)"
              className={depth.input}
              style={{ minHeight: 30, fontSize: 12, fontWeight: 700 }}
              autoFocus
            />
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className={depth.input}
              style={{ minHeight: 30, fontSize: 11.5 }}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'completed' | 'pending')}
              className={depth.input}
              style={{ minHeight: 30, fontSize: 11.5 }}
            >
              <option value="completed">Tamamlandı</option>
              <option value="pending">Bekliyor (Vadeli)</option>
            </select>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Kısa not…"
              className={depth.input}
              style={{ minHeight: 30, fontSize: 11.5 }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              disabled={saving}
              className={depth.btnPrimary}
              style={{ minHeight: 29, padding: '3px 12px', fontSize: 11.5 }}
            >
              <Check size={13} color="#ffffff" />
              <span style={{ color: '#ffffff' }}>
                {saving ? 'Kaydediliyor…' : 'Tahsilatı Kaydet'}
              </span>
            </button>
          </div>
        </form>
      )}
    </div>
  )
}


'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MessageSquare, RotateCcw, Send, Sparkles, Trash2, X } from 'lucide-react'
import depth from '@/styles/clinic-depth.module.css'
import InfoTooltip from '../ui/InfoTooltip'
import type { DynamicTableDef } from '../dynamic-tables/types'

export type FlowAssistantDirection = 'inbound' | 'outbound' | 'web' | 'whatsapp'

export interface FlowAiChatMessage {
  id: string
  direction: FlowAssistantDirection
  role: 'user' | 'assistant'
  content: string
  appliedFlow: boolean
  nodeCount: number | null
  edgeCount: number | null
  changeSummary: string | null
  canRevert: boolean
  createdAt: string
}

export interface FlowAiChatBoxProps {
  direction: FlowAssistantDirection
  getCurrentGraph: () => { nodes: any[]; edges: any[] }
  dynamicTables?: DynamicTableDef[]
  onApplyGeneratedFlow: (
    flow: { nodes: any[]; edges: any[] },
    meta: { summary: string | null; issues?: any[]; direction: FlowAssistantDirection },
  ) => void
  onToast?: (msg: string, type?: 'success' | 'error') => void
}

const DIRECTION_UI_META: Record<
  FlowAssistantDirection,
  {
    badge: string
    title: string
    subtitle: string
    placeholder: string
  }
> = {
  inbound: {
    badge: '📞 Gelen Arama',
    title: 'Gelen Arama Akışı Asistanı',
    subtitle: 'Telefonla arayanlar için karşılama, soru ve yönlendirmeleri anlatın.',
    placeholder:
      'Örn: Arayan kişi kayıtlıysa doğrudan tarih ve saat sorsun; kayıtlı değilse ad soyad alıp randevu talebi oluştursun...',
  },
  outbound: {
    badge: '📤 Giden Arama',
    title: 'Giden Arama Akışı Asistanı',
    subtitle: 'Dış aramalarda memnuniyet anketi, hatırlatma veya takip akışını anlatın.',
    placeholder:
      'Örn: İşlem sonrası memnuniyet puanını sorsun; 4 ve üzerindeyse teşekkür edip bitirsin, altındaysa sebebini not alsın...',
  },
  web: {
    badge: '🌐 Web Asistanı',
    title: 'Web Sesli Asistanı Akışı',
    subtitle: 'Web sitesinden sesli bağlanan ziyaretçiler için hızlı senaryoyu anlatın.',
    placeholder:
      'Örn: Kısa bir hoş geldin sonrası ziyaretçinin talebini, adını ve telefonunu alıp hızlı randevu talebi oluştursun...',
  },
  whatsapp: {
    badge: '💬 WhatsApp',
    title: 'WhatsApp Asistanı Akışı',
    subtitle: 'WhatsApp mesajlaşma akışını, yanıtları ve randevu adımlarını anlatın.',
    placeholder:
      'Örn: Mesaj gelince sıcak bir karşılama yazsın, ilgilendiği konuyu ve uygun günü sorup randevu oluştursun...',
  },
}

function buildStarterPrompts(
  direction: FlowAssistantDirection,
  dynamicTables: DynamicTableDef[],
): Array<{ label: string; prompt: string }> {
  const firstTable = dynamicTables[0]
  const secondTable = dynamicTables[1]
  const tablePhrase = firstTable ? `${firstTable.name}` : 'kayıt'

  if (direction === 'inbound') {
    return [
      {
        label: '📅 Kayıt kontrolü + randevu',
        prompt: `Arayan numara ${tablePhrase} listemizde kayıtlıysa doğrudan talep konusunu, günü ve saati sorup randevu talebi oluştursun. Kayıtlı değilse önce adını soyadını alsın.`,
      },
      {
        label: '💸 Fiyat soranı yetkiliye aktar',
        prompt:
          'Arayan fiyat veya detay sorarsa kısaca bilgi verip onay alarak yetkiliye aktarsın; adres sorarsa WhatsApp üzerinden konum göndersin.',
      },
      {
        label: '🌙 Mesai dışı not alma',
        prompt:
          'İşletme çalışma saatleri dışındaysa nazikçe kapalı olduğumuzu söyleyip ad, telefon ve talep notunu alsın; mesai saatindeyse normal randevu akışına devam etsin.',
      },
    ]
  }

  if (direction === 'outbound') {
    return [
      {
        label: '⭐ Hizmet sonrası memnuniyet',
        prompt:
          'Görüşmeyi nazikçe başlatıp hizmetten 1 ile 5 arasında memnuniyet puanı istesin. Puan 4 ve üzeriyse teşekkür edip kapatsın; düşükse şikayet notunu kaydedip görüşmeyi bitirsin.',
      },
      {
        label: '🗓️ Randevu teyit araması',
        prompt:
          'Yarınki randevusunu hatırlatıp katılım teyidini sorsun. Gelecekse teyit notu düşsün; ertelemek isterse yeni gün ve saat alıp randevu talebi oluştursun.',
      },
      {
        label: '🔁 Teklif / başvuru takibi',
        prompt: `${secondTable ? secondTable.name : 'Hizmet'} talebiyle ilgili kararını sorsun; ilgileniyorsa uygun gün için görüşme planlasın.`,
      },
    ]
  }

  if (direction === 'web') {
    return [
      {
        label: '⚡ Hızlı web randevusu',
        prompt:
          'Ziyaretçiyi kısaca karşılayıp hangi konuda destek istediğini, adını, telefon numarasını, gün ve saat tercihini alıp randevu talebi oluştursun.',
      },
      {
        label: '📝 Bilgi ve geri arama',
        prompt:
          'Önce sorusunu dinleyip yanıtlasın; detaylı teklif istiyorsa iletişim bilgilerini ve notunu kaydedip ekip geri dönüşü planlasın.',
      },
    ]
  }

  return [
    {
      label: '💬 WhatsApp randevu asistanı',
      prompt: `İlk mesajda samimi bir karşılama yazsın; ${secondTable ? secondTable.name : 'talep konusu'}, ad soyad, gün ve saat bilgisini sorup randevu talebi oluştursun.`,
    },
    {
      label: '📋 Detay toplayıp tabloya kaydet',
      prompt: `Müşterinin adını, iletişim bilgisini ve ${tablePhrase} talebini alıp veri tablosuna kaydetsin, ardından bilgilendirici WhatsApp yanıtı göndersin.`,
    },
    {
      label: '👩‍💼 Yetkili dönüş notu',
      prompt:
        'Sorusu karmaşıksa müşterinin talebini ve telefon numarasını not olarak kaydedip en kısa sürede buradan yanıt verileceğini yazsın.',
    },
  ]
}

export default function FlowAiChatBox({
  direction,
  getCurrentGraph,
  dynamicTables = [],
  onApplyGeneratedFlow,
  onToast,
}: FlowAiChatBoxProps) {
  const [openByDirection, setOpenByDirection] = useState<Partial<Record<FlowAssistantDirection, boolean>>>({})
  const [messagesByDirection, setMessagesByDirection] = useState<
    Partial<Record<FlowAssistantDirection, FlowAiChatMessage[]>>
  >({})
  const [draftByDirection, setDraftByDirection] = useState<Partial<Record<FlowAssistantDirection, string>>>({})
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [sending, setSending] = useState(false)
  const [revertingId, setRevertingId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const listEndRef = useRef<HTMLDivElement | null>(null)
  const activeDirectionRef = useRef<FlowAssistantDirection>(direction)
  activeDirectionRef.current = direction

  const isOpen = Boolean(openByDirection[direction])
  const messages = useMemo(() => messagesByDirection[direction] ?? [], [messagesByDirection, direction])
  const draft = draftByDirection[direction] ?? ''
  const meta = DIRECTION_UI_META[direction]
  const starterPrompts = useMemo(
    () => buildStarterPrompts(direction, dynamicTables),
    [direction, dynamicTables],
  )

  const latestRevertableId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant' && messages[i]?.canRevert) {
        return messages[i].id
      }
    }
    return null
  }, [messages])

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenByDirection(prev => ({ ...prev, [direction]: next }))
      setConfirmClear(false)
      setErrorMsg(null)
    },
    [direction],
  )

  const setDraft = useCallback(
    (value: string) => {
      setDraftByDirection(prev => ({ ...prev, [direction]: value }))
    },
    [direction],
  )

  // Kanal değişince yalnızca ilgili asistanın sohbet geçmişini yükle
  useEffect(() => {
    let cancelled = false
    setConfirmClear(false)
    setErrorMsg(null)
    setLoadingHistory(true)

    fetch(`/api/admin/flow/ai-chat?direction=${encodeURIComponent(direction)}`)
      .then(async res => {
        if (!res.ok) return null
        return await res.json().catch(() => null)
      })
      .then(data => {
        if (cancelled || activeDirectionRef.current !== direction) return
        if (data && Array.isArray(data.messages)) {
          setMessagesByDirection(prev => ({ ...prev, [direction]: data.messages }))
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })

    return () => {
      cancelled = true
    }
  }, [direction])

  useEffect(() => {
    if (!isOpen) return
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [isOpen, messages.length, sending])

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const targetDir = direction
      const text = (overrideText ?? draft).trim()
      if (text.length < 2 || sending) return

      setErrorMsg(null)
      setConfirmClear(false)
      setSending(true)

      const optimisticUser: FlowAiChatMessage = {
        id: `temp_user_${Date.now()}`,
        direction: targetDir,
        role: 'user',
        content: text,
        appliedFlow: false,
        nodeCount: null,
        edgeCount: null,
        changeSummary: null,
        canRevert: false,
        createdAt: new Date().toISOString(),
      }
      setMessagesByDirection(prev => ({
        ...prev,
        [targetDir]: [...(prev[targetDir] ?? []), optimisticUser],
      }))
      if (!overrideText) setDraft('')

      try {
        const currentGraph = getCurrentGraph()
        const res = await fetch('/api/admin/flow/ai-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            direction: targetDir,
            message: text,
            currentNodes: currentGraph.nodes,
            currentEdges: currentGraph.edges,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.error || 'Akış sohbeti yanıtlanamadı.')
        }

        if (Array.isArray(data.messages)) {
          setMessagesByDirection(prev => ({ ...prev, [targetDir]: data.messages }))
        }

        if (data.appliedFlow && data.flow && Array.isArray(data.flow.nodes)) {
          onApplyGeneratedFlow(
            {
              nodes: data.flow.nodes,
              edges: Array.isArray(data.flow.edges) ? data.flow.edges : [],
            },
            {
              summary: data.changeSummary ?? null,
              issues: Array.isArray(data.issues) ? data.issues : [],
              direction: targetDir,
            },
          )
          onToast?.(`✅ ${DIRECTION_UI_META[targetDir].badge} akışı sohbete göre güncellendi`)
        }
      } catch (err: any) {
        setMessagesByDirection(prev => ({
          ...prev,
          [targetDir]: (prev[targetDir] ?? []).filter(m => m.id !== optimisticUser.id),
        }))
        if (!overrideText) {
          setDraftByDirection(prev => ({ ...prev, [targetDir]: text }))
        }
        const msg = err instanceof Error ? err.message : 'Akış sohbeti sırasında hata oluştu.'
        setErrorMsg(msg)
        onToast?.(msg, 'error')
      } finally {
        setSending(false)
      }
    },
    [direction, draft, sending, getCurrentGraph, onApplyGeneratedFlow, onToast, setDraft],
  )

  const handleRevert = useCallback(
    async (messageId: string) => {
      if (revertingId || sending) return
      const targetDir = direction
      setRevertingId(messageId)
      setErrorMsg(null)
      try {
        const res = await fetch('/api/admin/flow/ai-chat/revert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction: targetDir, messageId }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.error || 'Önceki akış geri yüklenemedi.')
        }
        if (Array.isArray(data.messages)) {
          setMessagesByDirection(prev => ({ ...prev, [targetDir]: data.messages }))
        }
        if (data.flow && Array.isArray(data.flow.nodes)) {
          onApplyGeneratedFlow(
            {
              nodes: data.flow.nodes,
              edges: Array.isArray(data.flow.edges) ? data.flow.edges : [],
            },
            {
              summary: 'Önceki akış geri yüklendi',
              issues: Array.isArray(data.issues) ? data.issues : [],
              direction: targetDir,
            },
          )
          onToast?.('↩ Önceki akış geri yüklendi')
        }
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : 'Geri alma başarısız.'
        setErrorMsg(msg)
        onToast?.(msg, 'error')
      } finally {
        setRevertingId(null)
      }
    },
    [direction, revertingId, sending, onApplyGeneratedFlow, onToast],
  )

  const handleClearChat = useCallback(async () => {
    const targetDir = direction
    setConfirmClear(false)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/admin/flow/ai-chat?direction=${encodeURIComponent(targetDir)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Sohbet temizlenemedi.')
      }
      setMessagesByDirection(prev => ({ ...prev, [targetDir]: [] }))
      onToast?.(`🗑 ${DIRECTION_UI_META[targetDir].badge} sohbet geçmişi temizlendi`)
    } catch (err: any) {
      setErrorMsg(err instanceof Error ? err.message : 'Sohbet temizlenemedi.')
    }
  }, [direction, onToast])

  return (
    <div
      className="nodrag nopan"
      style={{ position: 'relative', display: 'inline-block' }}
      onClick={e => e.stopPropagation()}
    >
      <button
        type="button"
        data-testid={`flow-ai-chat-toggle-${direction}`}
        onClick={() => setOpen(!isOpen)}
        className={isOpen ? depth.btnPale : depth.btnPrimary}
        style={{
          borderRadius: 999,
          padding: '6px 13px',
          minHeight: 30,
          fontSize: 11.5,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: isOpen ? 'var(--pc-clay-pale)' : 'var(--pc-clay-primary)',
          ...(isOpen
            ? { color: 'var(--pc-tint-fg)' }
            : { color: '#ffffff' }),
        }}
      >
        <Sparkles size={13} color={isOpen ? 'currentColor' : '#ffffff'} />
        <span style={isOpen ? undefined : { color: '#ffffff' }}>
          {isOpen ? 'Sohbeti Gizle' : 'Sohbetle Akış Tasarla'}
        </span>
        {messages.length > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: 999,
              background: isOpen ? 'var(--card-bg)' : '#1d4ed8',
              border: `1px solid ${isOpen ? 'var(--pc-border)' : '#60a5fa'}`,
              color: isOpen ? 'var(--pc-tint-fg)' : '#ffffff',
            }}
          >
            {messages.length}
          </span>
        )}
      </button>

      {isOpen && (
        <section
          aria-label={meta.title}
          data-testid={`flow-ai-chat-panel-${direction}`}
          className="nodrag nopan nowheel"
          onWheel={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 80,
            width: 'min(520px, calc(100vw - 32px))',
            height: 'min(560px, 74vh)',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 14,
            border: '1.5px solid var(--input-border)',
            background: 'var(--card-bg)',
            color: 'var(--foreground)',
            boxShadow: 'var(--pc-modal-shadow)',
            overflow: 'hidden',
          }}
        >
          {/* Üst Başlık */}
          <div
            style={{
              padding: '11px 14px',
              background: 'var(--card-inner)',
              borderBottom: '1px solid var(--input-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                className={depth.badge}
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  padding: '3px 8px',
                  whiteSpace: 'nowrap',
                }}
              >
                {meta.badge}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: 'var(--foreground)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {meta.title}
              </span>
              <InfoTooltip title="Asistan akışı sohbetle nasıl tasarlanır?" size={16}>
                Her asistan kanalı için ayrı bir tasarım sohbeti tutulur. Yapılmasını istediğiniz
                soruları, koşulları ve randevu kurallarını sade Türkçe ile yazabilirsiniz; yapay zeka
                mevcut veri tablolarınıza göre akış diyagramını anında oluşturur ve sonraki mesajlarınızla
                adım adım günceller.
              </InfoTooltip>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {messages.length > 0 && !confirmClear && (
                <button
                  type="button"
                  title="Bu asistanın sohbet geçmişini temizle"
                  onClick={() => setConfirmClear(true)}
                  className={depth.btn}
                  style={{ minHeight: 26, padding: '3px 8px', fontSize: 11 }}
                >
                  <Trash2 size={12} />
                  <span>Temizle</span>
                </button>
              )}
              {confirmClear && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => void handleClearChat()}
                    className={depth.btn}
                    style={{
                      minHeight: 26,
                      padding: '3px 8px',
                      fontSize: 11,
                      background: 'var(--flow-danger-bg)',
                      borderColor: '#dc2626',
                      color: '#dc2626',
                    }}
                  >
                    Sil
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className={depth.btn}
                    style={{ minHeight: 26, padding: '3px 8px', fontSize: 11 }}
                  >
                    Vazgeç
                  </button>
                </div>
              )}
              <button
                type="button"
                aria-label="Sohbet panelini kapat"
                onClick={() => setOpen(false)}
                className={depth.btn}
                style={{ minHeight: 26, width: 28, padding: 0, justifyContent: 'center' }}
              >
                <X size={13} />
              </button>
            </div>
          </div>

          {/* Alt Bilgi */}
          <div
            style={{
              padding: '7px 14px',
              background: 'var(--pc-tint)',
              borderBottom: '1px solid var(--input-border)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--pc-tint-fg)',
            }}
          >
            {meta.subtitle}
          </div>

          {/* Mesaj Listesi */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 12,
              background: 'var(--card-inner)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {loadingHistory && messages.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--foreground-2)', textAlign: 'center', padding: '18px 0' }}>
                Sohbet geçmişi yükleniyor…
              </div>
            )}

            {!loadingHistory && messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                  style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--input-border)',
                    borderRadius: 12,
                    padding: '12px 13px',
                    boxShadow: 'var(--pc-neo-subcard)',
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: 'var(--foreground)',
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MessageSquare size={14} />
                    <span>Merhaba! Bu kanalın konuşma akışını birlikte tasarlayalım.</span>
                  </div>
                  <div style={{ color: 'var(--foreground-2)' }}>
                    Müşterilerin size nasıl ulaştığını, hangi bilgilerin sorulmasını ve hangi durumda nasıl
                    yönlendirme yapılmasını istediğinizi yazın. Dilerseniz aşağıdaki örneklerden biriyle
                    başlayabilirsiniz:
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {starterPrompts.map(chip => (
                    <button
                      key={chip.label}
                      type="button"
                      disabled={sending}
                      onClick={() => setDraft(chip.prompt)}
                      className={depth.btn}
                      style={{
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        padding: '8px 11px',
                        fontSize: 11.5,
                        lineHeight: 1.4,
                        height: 'auto',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: 'var(--pc-tint-fg)', whiteSpace: 'nowrap' }}>
                        {chip.label}:
                      </span>
                      <span style={{ color: 'var(--foreground-2)', fontWeight: 500 }}>{chip.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => {
              const isUser = msg.role === 'user'
              const showRevert = !isUser && msg.canRevert && msg.id === latestRevertableId
              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      maxWidth: '88%',
                      padding: '9px 12px',
                      borderRadius: 12,
                      fontSize: 12,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      ...(isUser
                        ? {
                            background: '#2563eb',
                            border: '1px solid #1d4ed8',
                            color: '#ffffff',
                            boxShadow: 'var(--pc-clay-primary)',
                          }
                        : {
                            background: 'var(--card-bg)',
                            border: '1px solid var(--input-border)',
                            color: 'var(--foreground)',
                            boxShadow: 'var(--pc-neo-subcard)',
                          }),
                    }}
                  >
                    <div style={isUser ? { color: '#ffffff' } : undefined}>{msg.content}</div>

                    {!isUser && msg.appliedFlow && (
                      <div
                        style={{
                          marginTop: 8,
                          paddingTop: 7,
                          borderTop: '1px solid var(--input-border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: 'var(--flow-success-bg)',
                            border: '1px solid #16a34a',
                            color: '#15803d',
                          }}
                        >
                          ✓ Akışa uygulandı ({msg.nodeCount ?? 0} adım, {msg.edgeCount ?? 0} bağlantı)
                        </span>

                        {showRevert && (
                          <button
                            type="button"
                            disabled={revertingId === msg.id || sending}
                            onClick={() => void handleRevert(msg.id)}
                            className={depth.btn}
                            style={{ minHeight: 24, padding: '2px 8px', fontSize: 10.5 }}
                          >
                            <RotateCcw size={11} />
                            <span>{revertingId === msg.id ? 'Dönülüyor…' : 'Önceki Akışa Dön'}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {sending && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  background: 'var(--card-bg)',
                  border: '1px solid var(--input-border)',
                  borderRadius: 12,
                  padding: '9px 12px',
                  fontSize: 12,
                  color: 'var(--foreground-2)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: 'var(--pc-neo-subcard)',
                }}
              >
                <Loader2 size={14} className="animate-spin" />
                <span>{meta.badge} akışı tasarlanıyor…</span>
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                style={{
                  background: 'var(--flow-danger-bg)',
                  border: '1px solid #dc2626',
                  color: '#dc2626',
                  borderRadius: 10,
                  padding: '8px 11px',
                  fontSize: 11.5,
                  fontWeight: 600,
                }}
              >
                {errorMsg}
              </div>
            )}

            <div ref={listEndRef} />
          </div>

          {/* Alt Yazma Alanı */}
          <form
            onSubmit={e => {
              e.preventDefault()
              void sendMessage()
            }}
            style={{
              padding: 10,
              background: 'var(--card-bg)',
              borderTop: '1px solid var(--input-border)',
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
            }}
          >
            <textarea
              rows={2}
              value={draft}
              disabled={sending}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendMessage()
                }
              }}
              placeholder={meta.placeholder}
              className={depth.input}
              style={{
                flex: 1,
                resize: 'none',
                minHeight: 54,
                fontSize: 12,
                padding: '8px 10px',
                lineHeight: 1.4,
              }}
            />
            <button
              type="submit"
              disabled={sending || draft.trim().length < 2}
              className={depth.btnPrimary}
              style={{
                minHeight: 40,
                padding: '0 14px',
                fontSize: 12,
                borderRadius: 10,
                color: '#ffffff',
                opacity: sending || draft.trim().length < 2 ? 0.55 : 1,
                flexShrink: 0,
              }}
            >
              {sending ? <Loader2 size={14} color="#ffffff" className="animate-spin" /> : <Send size={14} color="#ffffff" />}
              <span style={{ color: '#ffffff' }}>{sending ? 'Oluşturuluyor' : 'Gönder'}</span>
            </button>
          </form>
        </section>
      )}
    </div>
  )
}

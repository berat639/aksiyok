'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, Users } from 'lucide-react'
import InfoTooltip from './ui/InfoTooltip'
import styles from './EvolutionWhatsAppCard.module.css'

type Config = { clinicId: string; clinicName: string; provider?: 'evolution' | 'n8n_meta' }
type Conversation = {
  id: string
  phone: string | null
  remoteJid: string | null
  aiPaused: boolean
  lastMessageAt: string
  contactName?: string | null
  isPhonebookContact?: boolean
}
type Message = {
  id: string
  direction: string
  text: string
  replyText: string | null
  status: string
  deliveryStatus: string | null
  error: string | null
  createdAt: string
}
type StatusFilter = 'all' | 'ai' | 'staff'

const API = '/api/admin/whatsapp'
const messageStates: Record<string, string> = {
  pending: 'Yanıt bekliyor',
  processing: 'Yapay zeka yanıtlıyor',
  reply_ready: 'Gönderim bekliyor',
  sending: 'Gönderiliyor',
  sent: 'Gönderildi',
  received: 'Personel mesajı',
  held: 'Personelde / otomasyon kapalı',
  failed: 'Başarısız',
  uncertain: 'Gönderimi kontrol edin',
  skipped: 'Tercih nedeniyle atlandı',
  resolved: 'Personel sonuçlandırdı',
}

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'İşlem tamamlanamadı.')
  return data as T
}

export default function WhatsAppConversationsCard() {
  const [configs, setConfigs] = useState<Config[]>([])
  const [clinicId, setClinicId] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api<Config[]>('/').then(rows => {
      if (!active) return
      setConfigs(rows)
      setClinicId(rows[0]?.clinicId || '')
    }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const refreshConversations = useCallback(async () => {
    if (!clinicId) return
    const rows = await api<Conversation[]>(`/${clinicId}/conversations`)
    setConversations(rows)
  }, [clinicId])

  useEffect(() => { void refreshConversations().catch(e => setError(e.message)) }, [refreshConversations])
  useEffect(() => {
    if (!selected || !clinicId) { setMessages([]); return }
    let active = true
    const refresh = () => api<Message[]>(`/${clinicId}/conversations/${selected}/messages`)
      .then(rows => { if (active) setMessages(rows) }).catch(e => { if (active) setError(e.message) })
    void refresh()
    const timer = setInterval(() => { void refresh() }, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [selected, clinicId])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await operation() } catch (e) { setError(e instanceof Error ? e.message : 'İşlem tamamlanamadı.') } finally { setBusy(false) }
  }

  const counts = useMemo(() => {
    let aiOpen = 0
    let staffMode = 0
    for (const c of conversations) {
      if (c.aiPaused) staffMode++
      else aiOpen++
    }
    return { total: conversations.length, aiOpen, staffMode }
  }, [conversations])

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR')
    return conversations.filter(c => {
      if (statusFilter === 'ai' && c.aiPaused) return false
      if (statusFilter === 'staff' && !c.aiPaused) return false
      if (!q) return true
      const hay = `${c.contactName || ''} ${c.phone || ''}`.toLocaleLowerCase('tr-TR')
      return hay.includes(q)
    })
  }, [conversations, searchQuery, statusFilter])

  const selectedConversation = conversations.find(c => c.id === selected)
  const activeConfig = configs.find(c => c.clinicId === clinicId)
  const isEvolutionProvider = !activeConfig?.provider || activeConfig.provider === 'evolution'

  const syncContacts = async () => {
    if (!clinicId) return
    const res = await api<{ ok: boolean; syncedCount: number }>(`/${clinicId}/sync-contacts`, 'POST')
    await refreshConversations()
    setNotice(
      res.syncedCount > 0
        ? `Telefon rehberinden ${res.syncedCount} kişi eşitlendi.`
        : 'Telefon rehberi kontrol edildi (yeni kayıtlı kişi bulunamadı).',
    )
  }

  return (
    <section className={styles.card} aria-labelledby="whatsapp-conversations-heading">
      <div className={styles.inboxHeader}>
        <div>
          <div className={styles.inboxTitleRow}>
            <h3 id="whatsapp-conversations-heading">WhatsApp Gelen Mesajlar</h3>
            {!loading && clinicId && (
              <span className={styles.badge}>{counts.total} sohbet</span>
            )}
            <InfoTooltip title="Otomatik yanıt kuralı">
              Personel WhatsApp üzerinden yanıt verdiğinde yapay zeka o sohbette otomatik olarak duraklatılır. Yapay zekayı yeniden açtığınızda ayar sonraki gelen mesajlar için geçerli olur.
            </InfoTooltip>
          </div>
          <p className={styles.description}>
            Gelen WhatsApp mesajlarını görüntüleyin ve yapay zeka yanıtlarını yönetin.
          </p>
        </div>
        <div className={styles.headerActions}>
          {isEvolutionProvider && (
            <button type="button" className={styles.secondary} disabled={busy || !clinicId} onClick={() => run(syncContacts)}>
              <Users size={14} />
              <span>Rehberi eşitle</span>
            </button>
          )}
          <button type="button" className={styles.secondary} disabled={busy || !clinicId} onClick={() => run(refreshConversations)}>
            <RefreshCw size={14} />
            <span>Sohbetleri yenile</span>
          </button>
        </div>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      {loading ? (
        <p>WhatsApp gelen mesajları yükleniyor…</p>
      ) : !clinicId ? (
        <p>WhatsApp gelen mesajlarını görmek için önce bir işletme kaydı oluşturun.</p>
      ) : (
        <>
          {configs.length > 1 && (
            <label className={styles.field}>
              İşletme
              <select
                value={clinicId}
                disabled={busy}
                onChange={e => {
                  setClinicId(e.target.value)
                  setSelected('')
                  setConversations([])
                  setMessages([])
                }}
              >
                {configs.map(config => (
                  <option key={config.clinicId} value={config.clinicId}>
                    {config.clinicName}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={styles.inboxToolbar}>
            <div className={styles.inboxSearchWrap}>
              <Search size={14} className={styles.inboxSearchIcon} aria-hidden="true" />
              <input
                type="search"
                className={styles.inboxSearchInput}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Kişi adı veya telefon numarası ara…"
                aria-label="WhatsApp sohbetlerinde ara"
              />
            </div>

            <div className={styles.inboxFilterTrack} role="group" aria-label="Sohbet durumu filtresi">
              <button
                type="button"
                className={statusFilter === 'all' ? styles.inboxFilterActive : styles.inboxFilterBtn}
                aria-pressed={statusFilter === 'all'}
                onClick={() => setStatusFilter('all')}
              >
                Tümü ({counts.total})
              </button>
              <button
                type="button"
                className={statusFilter === 'ai' ? styles.inboxFilterActive : styles.inboxFilterBtn}
                aria-pressed={statusFilter === 'ai'}
                onClick={() => setStatusFilter('ai')}
              >
                Yapay Zeka Açık ({counts.aiOpen})
              </button>
              <button
                type="button"
                className={statusFilter === 'staff' ? styles.inboxFilterActive : styles.inboxFilterBtn}
                aria-pressed={statusFilter === 'staff'}
                onClick={() => setStatusFilter('staff')}
              >
                Personel Desteğinde ({counts.staffMode})
              </button>
            </div>
          </div>

          <div className={styles.inbox}>
            <div className={styles.conversations}>
              {!filteredConversations.length && (
                <p>
                  {conversations.length === 0
                    ? 'Henüz gelen WhatsApp mesajı yok.'
                    : 'Arama veya filtreye uygun sohbet bulunamadı.'}
                </p>
              )}
              {filteredConversations.map(conversation => {
                const showPhonebook = Boolean(conversation.isPhonebookContact && conversation.contactName)
                const primaryTitle = showPhonebook
                  ? conversation.contactName!
                  : (conversation.phone || 'Numarası doğrulanmamış sohbet')
                return (
                  <button
                    type="button"
                    key={conversation.id}
                    className={selected === conversation.id ? styles.selected : styles.conversation}
                    onClick={() => setSelected(conversation.id)}
                  >
                    <div className={styles.conversationTopRow}>
                      <strong>{primaryTitle}</strong>
                      {showPhonebook && <span className={styles.contactBadge}>Rehber Kişisi</span>}
                    </div>
                    <div className={styles.conversationSubRow}>
                      {showPhonebook && conversation.phone && <span>{conversation.phone}</span>}
                      <span>{conversation.aiPaused ? 'Personel desteğinde' : 'Yapay zeka açık'}</span>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className={styles.messages}>
              {selectedConversation ? (
                <>
                  <div className={styles.messagesHeaderBar}>
                    <div className={styles.messagesPeerInfo}>
                      <strong>
                        {selectedConversation.isPhonebookContact && selectedConversation.contactName
                          ? selectedConversation.contactName
                          : (selectedConversation.phone || 'Numarası doğrulanmamış sohbet')}
                      </strong>
                      {selectedConversation.isPhonebookContact && selectedConversation.phone && (
                        <span>{selectedConversation.phone}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => run(async () => {
                        await api(`/${clinicId}/conversations/${selected}`, 'PUT', { paused: !selectedConversation.aiPaused })
                        await refreshConversations()
                      })}
                    >
                      {selectedConversation.aiPaused ? 'Sonraki mesajlarda yapay zekayı aç' : 'Personel desteğine al'}
                    </button>
                  </div>

                  {!messages.length && <p>Bu sohbette henüz kayıtlı mesaj yok.</p>}
                  {messages.map(message => (
                    <article className={styles.message} key={message.id}>
                      <div className={styles.meta}>
                        {message.direction === 'inbound'
                          ? 'Müşteri'
                          : message.direction === 'notification'
                            ? 'Bildirim'
                            : 'Personel'} · {new Date(message.createdAt).toLocaleString('tr-TR')}
                      </div>
                      <p>{message.text}</p>
                      {message.direction === 'inbound' && message.replyText && (
                        <>
                          <strong>Yapay zeka yanıtı</strong>
                          <p>{message.replyText}</p>
                        </>
                      )}
                      <small>
                        {messageStates[message.status] || message.status}
                        {message.deliveryStatus ? ` · ${message.deliveryStatus}` : ''}
                      </small>
                      {message.error && <p className={styles.error}>{message.error}</p>}
                      {['failed', 'uncertain'].includes(message.status) && (
                        <div className={styles.actions}>
                          {message.status === 'failed' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => run(async () => {
                                await api(`/${clinicId}/messages/${message.id}/resolve`, 'POST', { action: 'retry' })
                                await refreshConversations()
                                setNotice('Mesaj yeniden kuyruğa alındı.')
                              })}
                            >
                              Yeniden dene
                            </button>
                          )}
                          <button
                            type="button"
                            className={styles.secondary}
                            disabled={busy}
                            onClick={() => run(async () => {
                              await api(`/${clinicId}/messages/${message.id}/resolve`, 'POST', { action: 'resolve' })
                              setNotice('Mesaj sonuçlandırıldı. Hazır olduğunuzda yapay zeka yanıtlarını açabilirsiniz.')
                            })}
                          >
                            WhatsApp&apos;tan kontrol ettim, sonuçlandır
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </>
              ) : (
                <p>Mesajları görmek için soldan bir sohbet seçin.</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

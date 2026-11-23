'use client'

import { Inbox, MessageCircle } from 'lucide-react'
import InfoTooltip from '../../../admin/components/ui/InfoTooltip'
import WhatsAppConversationsCard from '../../../admin/components/WhatsAppConversationsCard'
import s from './GelenKayitlarTab.module.css'

export default function GelenKayitlarTab() {
  return (
    <div className={s.root}>
      <header className={s.headerCard}>
        <div className={s.headerTop}>
          <div className={s.titleGroup}>
            <span className={s.iconChip} aria-hidden="true">
              <Inbox size={20} strokeWidth={2.2} color="#ffffff" />
            </span>
            <div className={s.titleWrap}>
              <div className={s.titleRow}>
                <h2 className={s.title}>Gelen Kayıtlar</h2>
                <InfoTooltip title="Gelen Kayıtlar nedir?">
                  Bağlı iletişim kanallarından işletmenize ulaşan müşteri mesajları burada toplanır. WhatsApp üzerinden gelen konuşmaları izleyebilir, yapay zeka yanıtlarını yönetebilir veya sohbeti personel desteğine alabilirsiniz.
                </InfoTooltip>
              </div>
              <p className={s.subtitle}>
                WhatsApp üzerinden gelen müşteri mesajlarını ve yapay zeka yanıtlarını tek ekranda yönetin.
              </p>
            </div>
          </div>

          <div className={s.channelTrack} role="tablist" aria-label="Gelen kayıt kanalları">
            <button
              type="button"
              role="tab"
              aria-selected="true"
              className={s.channelPillActive}
            >
              <MessageCircle size={14} strokeWidth={2.3} color="#ffffff" />
              <span>WhatsApp Gelen Mesajlar</span>
            </button>
          </div>
        </div>
      </header>

      <WhatsAppConversationsCard />
    </div>
  )
}

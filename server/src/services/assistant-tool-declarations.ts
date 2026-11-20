import { Type, type FunctionDeclaration } from '@google/genai'

export async function buildToolDeclarations(direction: string = 'inbound'): Promise<FunctionDeclaration[]> {
  const { getActiveFlow, flowToToolFields } = await import('../db/repositories/flows')
  let tableNamesHint = ''
  try {
    const { getClinicDynamicPromptMetadata } = await import('../db/repositories/dynamic-tables')
    const meta = await getClinicDynamicPromptMetadata()
    if (meta.tableNames.length > 0) {
      tableNamesHint = meta.tableNames.join(', ')
    }
  } catch { /* ignore */ }

  // Build randevuOlustur fields from flow (zero hardcoded fields)
  const flow = await getActiveFlow(direction)
  let fieldProps: Record<string, unknown> = {}
  let fieldRequired: string[] = []

  if (flow && flow.nodes.some(n => n.type === 'FIELD')) {
    const { properties, required } = flowToToolFields(flow)
    for (const [k, v] of Object.entries(properties)) {
      fieldProps[k] = v.enum
        ? { type: Type.STRING, enum: v.enum, description: v.description }
        : { type: Type.STRING, description: v.description }
    }
    fieldRequired = required
  }

  // Ensure doktor_id and musteri_adi are always available as optional params
  if (!fieldProps['doktor_id']) {
    fieldProps['doktor_id'] = { type: Type.STRING, description: 'Mevcut kişi için atanacak sorumlu çalışanın ID\'si (musteriSorgula sonucundaki doktor_gecmisi\'nden). Eğer kişi seçim yapmazsa veya farketmez derse boş (null) bırakın.' }
  }
  if (!fieldProps['musteri_adi']) {
    fieldProps['musteri_adi'] = { type: Type.STRING, description: 'Müşteri adı soyadı (kayıtlı kişi için musteriSorgula\'dan gelen ad)' }
  }

  const tools: FunctionDeclaration[] = [
    {
      name: 'akisBilgisiGuncelle',
      description: 'Akışla yürütülen görüşmede müşterinin yeni veya düzeltilmiş bilgilerini kaydeder ve sıradaki kısa görevi alır. Müşteriden yeni bir bilgi aldığında (veri tablosu alanları dahil), işlem çağırmadan önce kullan.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          bilgiler: {
            type: Type.OBJECT,
            description: 'Müşterinin açıkça verdiği alan adı → değer çiftleri (veri tablosu alanlarında tam anahtar adını kullanın).',
            properties: {
              musteri_adi: { type: Type.STRING, description: 'Hasta / müşteri adı ve soyadı' },
              telefon: { type: Type.STRING, description: 'Telefon numarası' },
              tarih: { type: Type.STRING, description: 'Tarih (YYYY-MM-DD)' },
              saat: { type: Type.STRING, description: 'Saat (HH:MM)' },
              sikayet: { type: Type.STRING, description: 'Şikayet, talep veya açıklama' },
              ...fieldProps,
            },
          },
          yeni_kisi: { type: Type.BOOLEAN, description: 'Müşteri başka kişi için yeni işlem istiyorsa true.' },
        },
      },
    },
    {
      name: 'veriTablosunaKaydet',
      description: 'Görüşme boyunca müşteriden toplanan veri tablosu sütunlarını (anket, müşteri veya özel tablo alanları) ilgili veri tablosuna kaydeder veya günceller.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          hedef_tablo_id: {
            type: Type.STRING,
            description: 'Kaydın yazılacağı hedef veri tablosu kimliği (akış talimatında belirtilmişse gönderin, aksi halde boş bırakabilirsiniz).',
          },
          bilgiler: {
            type: Type.OBJECT,
            description: 'Kaydedilecek alan adı → değer çiftleri.',
            properties: {
              musteri_adi: { type: Type.STRING, description: 'Müşteri adı ve soyadı' },
              telefon: { type: Type.STRING, description: 'Telefon numarası' },
              ...fieldProps,
            },
          },
        },
      },
    },
    {
      name: 'veriTablosuSorgula',
      description: `Aktif veri tablolarında (${tableNamesHint || 'Müşteriler, Ürün & Demirbaş Stoku, Anket vb.'}) telefon numarası, ilan/kayıt linki (URL), ilan başlığı veya aranan değerle kayıt olup olmadığını okuma amaçlı sorgular. Tablo/link sorgularında asla Google veya dış arama yapma; yalnızca bu aracın döndürdüğü gerçek satır verisini kullan.`,
      parameters: {
        type: Type.OBJECT,
        properties: {
          tablo: {
            type: Type.STRING,
            description: tableNamesHint
              ? `Sorgulanacak veri tablosunun adı veya kimliği (Mevcut tablolar: ${tableNamesHint}). Boş bırakılırsa tüm aktif tablolarda arar.`
              : 'Sorgulanacak veri tablosunun adı veya kimliği (ör. "Müşteriler", "Ürün & Demirbaş Stoku"). Boş bırakılırsa tüm tablolarda arar.',
          },
          aranan_deger: {
            type: Type.STRING,
            description: 'Aranacak tam link/URL (ör. sahibinden veya platform ilanı bağlantısı), ürün/ilan adı, kayıt başlığı, kod, isim veya sütun değeri.',
          },
          sutun: {
            type: Type.STRING,
            description: 'İsteğe bağlı: Yalnızca belirli bir sütunda aramak için sütun adı.',
          },
          telefon: {
            type: Type.STRING,
            description: 'İsteğe bağlı: Arayan kişinin telefon numarası ile tabloda kayıtlı olup olmadığını kontrol etmek için telefon numarası.',
          },
        },
      },
    },
    {
      name: 'randevuOlustur',
      description: 'Müşteri veya kişi randevu almak istediğinde randevu oluşturur ve kaydeder. Aynı arama içinde birden fazla kişi için sırayla birden fazla kez çağrılabilir.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          musteri_adi: { type: Type.STRING, description: 'Kişinin adı ve soyadı' },
          telefon: { type: Type.STRING, description: 'Kişinin telefon numarası' },
          tarih: { type: Type.STRING, description: 'Randevu tarihi (YYYY-MM-DD formatında)' },
          saat: { type: Type.STRING, description: 'Randevu saati (HH:MM formatında)' },
          sikayet: { type: Type.STRING, description: 'Kişinin talebi, konusu veya işlem açıklaması' },
          doktor_id: { type: Type.STRING, description: 'Tercih edilen sorumlu çalışan ID\'si (Kişi belirtmezse veya farketmez derse boş bırakın)' },
          ...fieldProps,
        },
        required: ['musteri_adi', 'telefon', 'tarih', 'saat'],
      },
    },
    {
      name: 'randevuGuncelle',
      description: 'Mevcut bir randevunun tarih, saat, durum (onay/iptal/erteleme) veya diğer bilgilerini günceller.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          randevu_id: { type: Type.STRING, description: 'Güncellenecek randevu ID\'si (bilinmiyorsa boş bırakılabilir)' },
          musteri_adi: { type: Type.STRING, description: 'Müşteri adı soyadı' },
          telefon: { type: Type.STRING, description: 'Telefon numarası' },
          tarih: { type: Type.STRING, description: 'Yeni tarih (YYYY-MM-DD)' },
          saat: { type: Type.STRING, description: 'Yeni saat (HH:MM)' },
          durum: { type: Type.STRING, enum: ['confirmed', 'postponed', 'cancelled'], description: 'Kişi geleceğini onaylıyorsa confirmed, gelemeyeceğini/iptal ettiğini söylüyorsa cancelled, başka tarihe ertelemek istiyorsa postponed' },
          sorun_veya_talep: { type: Type.STRING, description: 'Şikayet / talep / iptal veya erteleme nedeni' },
        },
      },
    },
    {
      name: 'randevuDurumBildir',
      description: 'Kişi mevcut randevusuna geleceğini onayladığında (confirmed), gelemeyeceğini/iptal ettiğini söylediğinde (cancelled) veya ertelemek istediğinde (postponed) randevu durumunu interaktif takvimde günceller.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          durum: { type: Type.STRING, enum: ['confirm', 'postpone', 'cancel'], description: 'confirm = Geleceğim/Onaylıyorum, postpone = Ertelemek/Tarih değiştirmek istiyorum, cancel = Gelmiyorum/İptal' },
          not: { type: Type.STRING, description: 'Kişinin belirttiği mazeret, iptal nedeni veya not' },
          tercih_edilen_tarih: { type: Type.STRING, description: 'Erteleme talebinde kişinin tercih ettiği yeni tarih/gün bilgisi' },
          randevu_id: { type: Type.STRING, description: 'Biliniyorsa randevu ID\'si' },
          telefon: { type: Type.STRING, description: 'Kişinin telefon numarası' },
        },
        required: ['durum'],
      },
    },
    {
      name: 'musteriSorgula',
      description: 'Arayan telefon numarasına göre kişiyi sorgular; kayıtlı ise ad soyad ve geçmiş randevularını döndürür.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          telefon: { type: Type.STRING, description: 'Sorgulanacak telefon numarası' },
        },
        required: ['telefon'],
      },
    },
    {
      name: 'gecmisRandevular',
      description: 'Müşterinin geçmiş randevu listesini döndürür.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          telefon: { type: Type.STRING, description: 'Telefon numarası' },
          limit: { type: Type.INTEGER, description: 'Maksimum kayıt sayısı' },
        },
        required: ['telefon'],
      },
    },
    {
      name: 'randevuMusaitlikKontrol',
      description: 'Belirli bir tarihteki randevu yoğunluğunu ve müsaitliği kontrol eder.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          tarih: { type: Type.STRING, description: 'Kontrol edilecek tarih (YYYY-MM-DD)' },
          baslangic_tarih: { type: Type.STRING, description: 'Başlangıç tarihi (YYYY-MM-DD)' },
          bitis_tarih: { type: Type.STRING, description: 'Bitiş tarihi (YYYY-MM-DD)' },
        },
      },
    },
    {
      name: 'searchKnowledgeBase',
      description: 'İşletme hakkında, çalışanlar, hizmetler veya çalışma saatleri hakkında bilgi tabanında arama yapar.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          sorgu: { type: Type.STRING, description: 'Aranacak kelime veya soru' },
        },
        required: ['sorgu'],
      },
    },
    {
      name: 'hastaNotKaydet',
      description: 'Kişi randevu oluşturmayıp işletmeye bir not, mesaj veya talep iletmek istediğinde yetkililerin görmesi için not kaydeder.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          telefon: { type: Type.STRING, description: 'Kişinin telefon numarası' },
          not: { type: Type.STRING, description: 'Kişinin işletmeye iletmek istediği not veya mesaj' },
          hasta_adi: { type: Type.STRING, description: 'Kişinin adı ve soyadı (biliniyorsa)' },
        },
        required: ['telefon', 'not'],
      },
    },
    {
      name: 'whatsappKonumGonder',
      description: 'Telefon görüşmesindeki kişi konumu, adresi veya yol tarifini WhatsApp üzerinden istediğinde çağır. Konumu arayan telefon numarasına gönderir. Başarılı araç sonucundan önce gönderildiğini söyleme.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: 'aramaAktar',
      description: 'Aramayı aktif Flow Builder işlem düğümünde tanımlanan yetkili hedefe aktarır. Hedef numarayı tahmin etme veya örnek numara kullanma.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          hedef: { type: Type.STRING, description: 'Aktif Flow Builder aktarım düğümünde tanımlı telefon numarası veya rehber etiketi' },
          sebep: { type: Type.STRING, description: 'Aktarım sebebi' },
        },
        required: ['hedef'],
      },
    },
    {
      name: 'havaDurumuSorgula',
      description: 'Belirtilen şehrin (varsayılan Ankara) anlık canlı hava durumunu ve sıcaklığını sorgular.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          sehir: { type: Type.STRING, description: 'Hava durumu sorgulanacak şehir (varsayılan: "Ankara")' },
        },
      },
    },
    {
      name: 'cagriySonlandir',
      description: 'Müşteri ile görüşme tamamlandığında veya müşteri vedalaştığında çağrıyı sonlandırır.',
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
  ]
  return tools
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Calendar, X } from 'lucide-react';
import FancyHourPicker from './FancyHourPicker';
import AppointmentDynamicRecordsSection, {
  type AppointmentBookingContextData,
  type AppointmentDynamicRecordsHandle,
} from './dynamic-tables/AppointmentDynamicRecordsSection';
import { useBackdropDismiss } from '../../../hooks/useBackdropDismiss';
import { useAuth } from '../../../lib/auth-context';
import { PhoneMaskedInput } from '@/lib/phone-mask';

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  onSave: (data: any) => void | Promise<void>;
  defaultDate: string;
  defaultStartTime: string;
  defaultEndTime: string;
  doctorId: string | null;
  patients: any[];
  doctors: any[];
  events?: any[];
  shifts?: any[];
  doctorLeaves?: any[];
  isCentered?: boolean;
  initialSelectedIdsByTable?: Record<string, string[]>;
  initialBookingContext?: AppointmentBookingContextData | null;
}

export default function QuickCreatePopover({
  x,
  y,
  onClose,
  onSave,
  defaultDate,
  defaultStartTime,
  defaultEndTime,
  doctorId,
  doctors,
  shifts = [],
  doctorLeaves = [],
  isCentered = false,
  initialSelectedIdsByTable,
  initialBookingContext,
}: Props) {
  const { user } = useAuth();
  const isClinicSector = user?.businessTemplate === 'dental_clinic';
  const backdropDismiss = useBackdropDismiss(onClose);
  const dynamicSectionRef = useRef<AppointmentDynamicRecordsHandle | null>(null);

  // Dynamic Appointment Context
  const [contextLoading, setContextLoading] = useState(!initialBookingContext);
  const [bookingContext, setBookingContext] = useState<AppointmentBookingContextData>(
    initialBookingContext || {
      hasAnyDynamicTables: false,
      linkedTables: [],
      allTables: [],
      relations: [],
      rowLinks: [],
    }
  );

  // Per-table selected row IDs (supports single OR multiple records per table)
  const [selectedIdsByTable, setSelectedIdsByTable] = useState<Record<string, string[]>>(
    () => initialSelectedIdsByTable || {}
  );

  useEffect(() => {
    if (initialSelectedIdsByTable && Object.keys(initialSelectedIdsByTable).length > 0) {
      setSelectedIdsByTable(initialSelectedIdsByTable);
    }
  }, [initialSelectedIdsByTable]);

  // Standalone / General Appointment Fields
  const [customTitle, setCustomTitle] = useState('');
  const [hasEditedCustomTitle, setHasEditedCustomTitle] = useState(false);
  const [standalonePhone, setStandalonePhone] = useState('');
  const [apptNotes, setApptNotes] = useState('');
  const [appointmentType, setAppointmentType] = useState<string>('general');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Specialist / Staff & Time state
  const [selectedDoctorId, setSelectedDoctorId] = useState(doctorId || '');
  const [hasUserChangedTime, setHasUserChangedTime] = useState(false);

  const timeToNumber = (t: string) => {
    if (!t) return 9;
    const [h, m] = t.split(':').map(Number);
    return h + (m >= 30 ? 0.5 : 0);
  };
  const formatNumberTime = (val: number) => {
    const h = Math.floor(val).toString().padStart(2, '0');
    const m = val % 1 === 0.5 ? '30' : '00';
    return `${h}:${m}`;
  };

  const [timeRange, setTimeRange] = useState<[number, number]>([
    timeToNumber(defaultStartTime) || 9,
    timeToNumber(defaultEndTime) || 9.5,
  ]);

  const loadBookingContext = useCallback(async (): Promise<AppointmentBookingContextData | null> => {
    try {
      const r = await fetch('/api/dynamic-tables/appointment-context');
      const data = await r.json();
      if (data?.error) return null;
      const nextCtx: AppointmentBookingContextData = {
        hasAnyDynamicTables: Boolean(data.hasAnyDynamicTables),
        linkedTables: Array.isArray(data.linkedTables) ? data.linkedTables : [],
        allTables: Array.isArray(data.allTables) ? data.allTables : [],
        relations: Array.isArray(data.relations) ? data.relations : [],
        rowLinks: Array.isArray(data.rowLinks) ? data.rowLinks : [],
      };
      setBookingContext(nextCtx);
      return nextCtx;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (!initialBookingContext) setContextLoading(true);
    loadBookingContext().finally(() => {
      if (active) setContextLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadBookingContext, initialBookingContext]);

  useEffect(() => {
    setSelectedDoctorId(doctorId || '');
  }, [doctorId]);

  useEffect(() => {
    setTimeRange([
      timeToNumber(defaultStartTime) || 9,
      timeToNumber(defaultEndTime) || 9.5,
    ]);
    setHasUserChangedTime(false);
  }, [defaultStartTime, defaultEndTime, defaultDate]);

  const allTableEntriesMap = useMemo(() => {
    const map = new Map<string, (typeof bookingContext.allTables)[number]>();
    for (const t of bookingContext.allTables) map.set(t.table.id, t);
    for (const lt of bookingContext.linkedTables) map.set(lt.table.id, lt);
    return map;
  }, [bookingContext.allTables, bookingContext.linkedTables]);

  // Auto-compose appointment title from selected dynamic rows across all tables unless manually edited
  const autoComposedTitle = useMemo(() => {
    const orderedIds = Array.from(
      new Set([
        ...bookingContext.linkedTables.map((lt) => lt.table.id),
        ...Object.keys(selectedIdsByTable),
      ])
    );
    const parts: string[] = [];
    for (const tableId of orderedIds) {
      const entry = allTableEntriesMap.get(tableId);
      if (!entry) continue;
      const selIds = selectedIdsByTable[tableId] || [];
      for (const selId of selIds) {
        const found = entry.rows.find((r) => r.id === selId);
        if (found?.displayTitle) parts.push(found.displayTitle);
      }
    }
    return parts.slice(0, 4).join(' • ');
  }, [bookingContext.linkedTables, allTableEntriesMap, selectedIdsByTable]);

  useEffect(() => {
    if (!hasEditedCustomTitle && bookingContext.hasAnyDynamicTables) {
      setCustomTitle(autoComposedTitle);
    }
  }, [autoComposedTitle, hasEditedCustomTitle, bookingContext.hasAnyDynamicTables]);

  // Auto-adjust appointment duration if selected dynamic rows have a duration column (e.g. Süre (Dk), Seans Süresi)
  useEffect(() => {
    if (hasUserChangedTime) return;
    let totalMinutes = 0;
    for (const [tableId, rowIds] of Object.entries(selectedIdsByTable)) {
      if (!rowIds || rowIds.length === 0) continue;
      const entry = allTableEntriesMap.get(tableId);
      if (!entry) continue;
      const durCol = entry.columns.find(
        (c) =>
          c.fieldType === 'number' &&
          /(süre|sure|dakika|\bdk\b)/i.test(c.name)
      );
      if (!durCol) continue;
      for (const rowId of rowIds) {
        const row = entry.rows.find((r) => r.id === rowId);
        const val = Number(row?.values?.[durCol.id]);
        if (Number.isFinite(val) && val > 0) {
          totalMinutes += val;
        }
      }
    }
    if (totalMinutes >= 15) {
      const durationHours = Math.max(0.5, Math.ceil(totalMinutes / 30) * 0.5);
      setTimeRange((prev) => {
        const nextEnd = Math.min(24, prev[0] + durationHours);
        if (nextEnd === prev[1]) return prev;
        return [prev[0], nextEnd];
      });
    }
  }, [selectedIdsByTable, allTableEntriesMap, hasUserChangedTime]);

  const selectedDoctorObj = useMemo(() => {
    if (!selectedDoctorId) return null;
    return doctors.find((d) => d.id === selectedDoctorId) || null;
  }, [doctors, selectedDoctorId]);

  const targetDate = String(defaultDate || '').slice(0, 10);

  const dayShifts = useMemo(() => {
    return (shifts || []).filter(
      (s: any) => String(s.date || '').slice(0, 10) === targetDate
    );
  }, [shifts, targetDate]);

  const selectedDoctorShifts = useMemo(() => {
    if (!selectedDoctorId) return [];
    return dayShifts.filter((s: any) => s.userId === selectedDoctorId);
  }, [dayShifts, selectedDoctorId]);

  useEffect(() => {
    if (!isCentered || hasUserChangedTime) {
      return;
    }
    const relevantShifts = selectedDoctorId ? selectedDoctorShifts : dayShifts;
    if (relevantShifts.length === 0) {
      return;
    }
    const startMin = Math.round(timeRange[0] * 60);
    const endMin = Math.round(timeRange[1] * 60);
    const isCovered = relevantShifts.some((shift: any) => {
      const [sH, sM] = String(shift.startTime || '00:00').split(':').map(Number);
      const [eH, eM] = String(shift.endTime || '23:59').split(':').map(Number);
      const shiftStartMin = (sH || 0) * 60 + (sM || 0);
      let shiftEndMin = (eH || 0) * 60 + (eM || 0);
      if (shiftEndMin <= shiftStartMin) shiftEndMin += 1440;
      return startMin >= shiftStartMin && endMin <= shiftEndMin;
    });
    if (!isCovered) {
      const firstShift = relevantShifts[0];
      const sVal = timeToNumber(firstShift.startTime || '09:00');
      const eLimit = timeToNumber(firstShift.endTime || '18:00');
      const nextStart = Math.max(6, Math.min(23.5, sVal));
      const nextEnd = Math.min(24, Math.max(nextStart + 0.5, Math.min(eLimit, nextStart + 0.5)));
      setTimeRange([nextStart, nextEnd]);
    }
  }, [isCentered, hasUserChangedTime, selectedDoctorId, selectedDoctorShifts, dayShifts, timeRange]);

  const shiftValidationError = useMemo(() => {
    const startMin = Math.round(timeRange[0] * 60);
    const endMin = Math.round(timeRange[1] * 60);

    const isShiftCoveringRange = (shift: any) => {
      const [sH, sM] = String(shift.startTime || '00:00').split(':').map(Number);
      const [eH, eM] = String(shift.endTime || '23:59').split(':').map(Number);
      const shiftStartMin = (sH || 0) * 60 + (sM || 0);
      let shiftEndMin = (eH || 0) * 60 + (eM || 0);
      if (shiftEndMin <= shiftStartMin) shiftEndMin += 1440;
      let evStart = startMin;
      let evEnd = endMin;
      if (evEnd <= evStart) evEnd += 1440;
      if (shiftEndMin > 1440 && evStart < shiftStartMin) {
        evStart += 1440;
        evEnd += 1440;
      }
      return evStart >= shiftStartMin && evEnd <= shiftEndMin;
    };

    const findDoctorLeaveConflict = (docId: string) => {
      return (doctorLeaves || []).find((l: any) => {
        if (
          l.doctorId !== docId ||
          String(l.date || '').slice(0, 10) !== targetDate
        ) {
          return false;
        }
        if (l.isFullDay) return true;
        const [sH, sM] = String(l.startTime || '00:00').split(':').map(Number);
        const [eH, eM] = String(l.endTime || '23:59').split(':').map(Number);
        const lStart = (sH || 0) * 60 + (sM || 0);
        const lEnd = (eH || 0) * 60 + (eM || 0);
        return startMin < lEnd && endMin > lStart;
      });
    };

    if (!selectedDoctorId) {
      if (dayShifts.length === 0) {
        return `Bu tarihte (${defaultDate}) tanımlı vardiya bulunmamaktadır. Vardiya olmadan randevu eklenemez!`;
      }
      const coveringShifts = dayShifts.filter(isShiftCoveringRange);
      if (coveringShifts.length === 0) {
        const shiftRanges = Array.from(
          new Set(dayShifts.map((s: any) => `${s.startTime}-${s.endTime}`))
        ).join(', ');
        return `Seçilen randevu saati (${formatNumberTime(timeRange[0])} - ${formatNumberTime(timeRange[1])}), bu tarihteki vardiya saatleri (${shiftRanges}) dışındadır. Randevu eklenemez!`;
      }
      const hasAvailableShiftDoctor = coveringShifts.some(
        (s: any) => !s.userId || !findDoctorLeaveConflict(s.userId)
      );
      if (!hasAvailableShiftDoctor) {
        return `Seçilen saat aralığında (${formatNumberTime(timeRange[0])} - ${formatNumberTime(timeRange[1])}) vardiyası olan uzman/sorumlu izinlidir. Randevu eklenemez!`;
      }
      return null;
    }

    const docName = selectedDoctorObj?.name || 'Seçilen uzman';
    if (selectedDoctorShifts.length === 0) {
      return `${docName} için bu tarihte (${defaultDate}) tanımlı vardiya bulunmamaktadır. Randevu eklenemez!`;
    }

    const isCovered = selectedDoctorShifts.some(isShiftCoveringRange);
    if (!isCovered) {
      const shiftRanges = selectedDoctorShifts
        .map((s: any) => `${s.startTime}-${s.endTime}`)
        .join(', ');
      return `Seçilen randevu saati (${formatNumberTime(timeRange[0])} - ${formatNumberTime(timeRange[1])}), ${docName} vardiya saatleri (${shiftRanges}) dışındadır. Randevu eklenemez!`;
    }

    const conflictLeave = findDoctorLeaveConflict(selectedDoctorId);
    if (conflictLeave) {
      const rangeText = conflictLeave.isFullDay
        ? 'Tüm gün'
        : `${conflictLeave.startTime} - ${conflictLeave.endTime}`;
      return `${docName} bu saatlerde (${rangeText}) izinlidir. Randevu eklenemez!`;
    }

    return null;
  }, [
    selectedDoctorId,
    selectedDoctorObj,
    selectedDoctorShifts,
    dayShifts,
    targetDate,
    defaultDate,
    timeRange,
    doctorLeaves,
  ]);

  const popoverRef = React.useRef<HTMLDivElement>(null);
  const [computedLeft, setComputedLeft] = useState(x);
  const [computedTop, setComputedTop] = useState(y);

  const modalWidth = 460;
  const modalHeight = 620;

  useEffect(() => {
    if (popoverRef.current) {
      const offsetParent = popoverRef.current.offsetParent as HTMLElement;
      let cLeft = x;
      let cTop = y;

      if (offsetParent) {
        const parentRect = offsetParent.getBoundingClientRect();
        const scrollY = window.scrollY || 0;
        const scrollX = window.scrollX || 0;

        const parentPageTop = parentRect.top + scrollY;
        const parentPageLeft = parentRect.left + scrollX;

        cTop = y - parentPageTop;
        cLeft = x - parentPageLeft;
      }

      if (typeof window !== 'undefined') {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const viewportY =
          cTop + (offsetParent ? offsetParent.getBoundingClientRect().top : 0);
        if (viewportY + modalHeight > screenHeight) {
          cTop -= viewportY + modalHeight - screenHeight + 20;
        }
        const viewportX =
          cLeft +
          (offsetParent ? offsetParent.getBoundingClientRect().left : 0);
        if (viewportX + modalWidth > screenWidth) {
          cLeft -= viewportX + modalWidth - screenWidth + 20;
        }
        if (cLeft < 10) cLeft = 10;
        if (cTop < 10) cTop = 10;
      }

      setComputedLeft(cLeft);
      setComputedTop(cTop);
    }
  }, [x, y, isCentered]);

  const isStandaloneMode =
    !bookingContext.hasAnyDynamicTables || bookingContext.linkedTables.length === 0;

  const isSaveDisabled = useMemo(() => {
    if (contextLoading || isSubmitting) return true;
    if (isStandaloneMode) {
      return !customTitle.trim();
    }
    return false;
  }, [contextLoading, isSubmitting, isStandaloneMode, customTitle]);

  const handleSave = async () => {
    if (isSubmitting) return;
    if (shiftValidationError) {
      toast.error(`⚠️ ${shiftValidationError}`);
      return;
    }

    if (isStandaloneMode) {
      if (!customTitle.trim()) {
        toast.error('Lütfen randevu başlığını veya kişi adını girin.');
        return;
      }
      setIsSubmitting(true);
      try {
        await onSave({
          type: 'dynamic_appointment',
          appointmentType,
          intakeSource: 'standalone',
          title: customTitle.trim(),
          phone: standalonePhone.trim() || null,
          notes: apptNotes.trim() || null,
          doctorId: selectedDoctorId || null,
          startTime: formatNumberTime(timeRange[0]),
          endTime: formatNumberTime(timeRange[1]),
          dynamicLinks: [],
        });
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Auto-flush any open new-record forms or dirty inline field edits inside dynamic tables
      let finalSelectedMap = selectedIdsByTable;
      let latestCtx: AppointmentBookingContextData = bookingContext;

      if (dynamicSectionRef.current) {
        const flushed = await dynamicSectionRef.current.flushPendingChanges();
        if (!flushed.ok) {
          setIsSubmitting(false);
          return;
        }
        finalSelectedMap = flushed.selectedIdsByTable;
        const refreshed = await loadBookingContext();
        if (refreshed) latestCtx = refreshed;
      }

      // 2. Check required dynamic tables after flush
      for (const entry of latestCtx.linkedTables) {
        const selIds = finalSelectedMap[entry.table.id] || [];
        if (entry.config?.isRequiredInAppointment && selIds.length === 0) {
          toast.error(`Lütfen "${entry.table.name}" bölümünden bir kayıt seçin veya alanları doldurup ekleyin.`);
          setIsSubmitting(false);
          return;
        }
      }

      // 3. Collect all dynamic links across linked + extra tables
      const dynamicLinks: Array<{ tableId: string; rowId: string }> = [];
      const seenRowIds = new Set<string>();
      let primaryPhone: string | null = standalonePhone.trim() || null;
      const composedParts: string[] = [];

      const entryMap = new Map<string, (typeof latestCtx.allTables)[number]>();
      for (const t of latestCtx.allTables) entryMap.set(t.table.id, t);
      for (const lt of latestCtx.linkedTables) entryMap.set(lt.table.id, lt);

      const orderedTableIds = Array.from(
        new Set([
          ...latestCtx.linkedTables.map((lt) => lt.table.id),
          ...Object.keys(finalSelectedMap),
        ])
      );

      for (const tableId of orderedTableIds) {
        const rowIds = finalSelectedMap[tableId] || [];
        const entry = entryMap.get(tableId);
        for (const rowId of rowIds) {
          if (!rowId || seenRowIds.has(rowId)) continue;
          seenRowIds.add(rowId);
          dynamicLinks.push({ tableId, rowId });
          const rowObj = entry?.rows.find((r) => r.id === rowId);
          if (rowObj?.displayTitle) composedParts.push(rowObj.displayTitle);
          if (!primaryPhone && rowObj?.phone) primaryPhone = rowObj.phone;
        }
      }

      const effectiveAutoTitle = composedParts.slice(0, 4).join(' • ');
      const finalTitle =
        (hasEditedCustomTitle ? customTitle.trim() : '') ||
        effectiveAutoTitle ||
        customTitle.trim();

      if (!finalTitle && dynamicLinks.length === 0) {
        toast.error('Lütfen en az bir tablo kaydı seçin/ekleyin veya randevu başlığı girin.');
        setIsSubmitting(false);
        return;
      }

      await onSave({
        type: 'dynamic_appointment',
        appointmentType,
        intakeSource: dynamicLinks.length > 0 ? 'dynamic_table' : 'standalone',
        title: finalTitle || 'Yeni Randevu',
        phone: primaryPhone,
        notes: apptNotes.trim() || null,
        doctorId: selectedDoctorId || null,
        startTime: formatNumberTime(timeRange[0]),
        endTime: formatNumberTime(timeRange[1]),
        dynamicLinks,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Solid Theme Tokens
  const cardBg = 'var(--card-bg)';
  const subCardBg = 'var(--card-inner, var(--background-2))';
  const borderCol = 'var(--input-border)';
  const inputBorder = 'var(--input-border)';
  const textCol = 'var(--foreground)';
  const labelCol = 'var(--foreground-2)';
  const mutedCol = 'var(--foreground-3)';
  const inputBg = 'var(--input-bg)';
  const brandBlue = '#2563eb';

  const inputStyle: React.CSSProperties = {
    padding: '9px 12px',
    borderRadius: '8px',
    border: `1px solid ${inputBorder}`,
    background: inputBg,
    color: textCol,
    fontSize: '0.85rem',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    boxShadow: 'var(--pc-neo-inset)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    color: labelCol,
    marginBottom: 4,
    display: 'block',
    fontWeight: 600,
  };

  const [isMobileScreen, setIsMobileScreen] = useState(false);

  useEffect(() => {
    const checkScreen = () => {
      setIsMobileScreen(typeof window !== 'undefined' && window.innerWidth < 640);
    };
    checkScreen();
    window.addEventListener('resize', checkScreen);
    return () => window.removeEventListener('resize', checkScreen);
  }, []);

  const selectOptionStyle: React.CSSProperties = {
    background: cardBg,
    color: textCol,
  };

  const effectiveCentered = isCentered || isMobileScreen;
  const effectiveWidth = isMobileScreen ? 'calc(100vw - 24px)' : modalWidth;
  const activeTableCount = bookingContext.linkedTables.length;

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100004,
          background: 'var(--modal-overlay)',
        }}
        {...backdropDismiss}
      />
      <div
        ref={popoverRef}
        style={{
          position: effectiveCentered ? 'fixed' : 'absolute',
          left: effectiveCentered ? '50%' : computedLeft,
          top: effectiveCentered ? '50%' : computedTop,
          transform: effectiveCentered ? 'translate(-50%, -50%)' : 'none',
          width: effectiveWidth,
          maxWidth: '460px',
          background: cardBg,
          border: `1.5px solid ${borderCol}`,
          borderRadius: '14px',
          boxShadow: 'var(--pc-modal-shadow)',
          zIndex: 100005,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '15px 20px',
            borderBottom: `1px solid ${borderCol}`,
            background: subCardBg,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--pc-clay-primary)',
                flexShrink: 0,
              }}
            >
              <Calendar size={17} color="#ffffff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '1.02rem',
                  fontWeight: 700,
                  color: textCol,
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {customTitle || autoComposedTitle || 'Yeni Randevu'}
              </div>
              <div
                style={{
                  fontSize: '0.75rem',
                  color: mutedCol,
                  marginTop: '2px',
                }}
              >
                Tarih: {defaultDate} •{' '}
                {isStandaloneMode
                  ? 'Bağımsız Randevu'
                  : `Randevu Akışı (${activeTableCount} Tablo)`}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: inputBg,
              border: `1px solid ${borderCol}`,
              borderRadius: '6px',
              width: '28px',
              height: '28px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: textCol,
              boxShadow: 'var(--pc-clay-btn)',
              flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <div
          style={{
            padding: '16px 20px',
            flex: 1,
            overflowY: 'auto',
            background: cardBg,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {contextLoading ? (
              <div
                style={{
                  padding: '20px',
                  textAlign: 'center',
                  fontSize: '0.84rem',
                  color: mutedCol,
                  background: subCardBg,
                  borderRadius: '10px',
                  border: `1px solid ${borderCol}`,
                }}
              >
                Dinamik tablo ve alan bağlantıları yükleniyor…
              </div>
            ) : isStandaloneMode ? (
              /* ── CASE A: 0 Dynamic Tables -> Standalone Appointment ── */
              <div
                style={{
                  background: subCardBg,
                  padding: '14px',
                  borderRadius: '10px',
                  border: `1px solid ${borderCol}`,
                  boxShadow: 'var(--pc-neo-subcard)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: '0.86rem', fontWeight: 700, color: textCol }}>
                    Randevu Bilgileri
                  </span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: 'var(--pc-tint)',
                      color: 'var(--pc-tint-fg)',
                      border: '1px solid var(--pc-border)',
                    }}
                  >
                    Bağımsız Mod
                  </span>
                </div>

                <div>
                  <label style={labelStyle}>
                    Randevu Başlığı / Kişi Adı <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Örn: Ahmet Yılmaz - Ön Görüşme"
                    value={customTitle}
                    onChange={(e) => {
                      setHasEditedCustomTitle(true);
                      setCustomTitle(e.target.value);
                    }}
                    style={inputStyle}
                    autoFocus
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={labelStyle}>İletişim Telefonu</label>
                    <PhoneMaskedInput
                      placeholder="0 (5XX) XXX XX XX"
                      value={standalonePhone}
                      onValueChange={setStandalonePhone}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Randevu Önceliği</label>
                    <select
                      value={appointmentType}
                      onChange={(e) => setAppointmentType(e.target.value)}
                      style={inputStyle}
                    >
                      <option value="general" style={selectOptionStyle}>Normal</option>
                      <option value="priority" style={selectOptionStyle}>Öncelikli</option>
                      <option value="urgent" style={selectOptionStyle}>Acil</option>
                      <option value="kontrol" style={selectOptionStyle}>Takip / Kontrol</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Kısa Not</label>
                  <input
                    type="text"
                    placeholder="İsteğe bağlı randevu notu"
                    value={apptNotes}
                    onChange={(e) => setApptNotes(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>
            ) : (
              /* ── CASE B: Dynamic Tables Active -> Fast Booking Flow Records Only ── */
              <>
                <AppointmentDynamicRecordsSection
                  ref={dynamicSectionRef}
                  mode="quick-create"
                  context={bookingContext}
                  selectedIdsByTable={selectedIdsByTable}
                  onChangeSelectedIdsByTable={setSelectedIdsByTable}
                  onRefreshContext={async () => {
                    await loadBookingContext();
                  }}
                />

                {/* Editable Appointment Title, Priority & Note */}
                <div
                  style={{
                    background: subCardBg,
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: `1px solid ${borderCol}`,
                    boxShadow: 'var(--pc-neo-subcard)',
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '10px',
                  }}
                >
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Randevu Başlığı (Seçilen kayıtlardan otomatik oluşur)</label>
                    <input
                      type="text"
                      placeholder="Otomatik başlık veya özel görüşme konusu"
                      value={customTitle}
                      onChange={(e) => {
                        setHasEditedCustomTitle(true);
                        setCustomTitle(e.target.value);
                      }}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Öncelik / Tür</label>
                    <select
                      value={appointmentType}
                      onChange={(e) => setAppointmentType(e.target.value)}
                      style={inputStyle}
                    >
                      <option value="general" style={selectOptionStyle}>Normal</option>
                      <option value="priority" style={selectOptionStyle}>Öncelikli</option>
                      <option value="urgent" style={selectOptionStyle}>Acil</option>
                      <option value="kontrol" style={selectOptionStyle}>Takip / Kontrol</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Randevu Notu</label>
                    <input
                      type="text"
                      placeholder="İsteğe bağlı not"
                      value={apptNotes}
                      onChange={(e) => setApptNotes(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>
              </>
            )}

            {/* SPECIALIST / STAFF SELECTION */}
            <div
              style={{
                background: subCardBg,
                padding: '14px',
                borderRadius: '10px',
                border: shiftValidationError
                  ? '1.5px solid var(--danger, #ef4444)'
                  : `1px solid ${borderCol}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                boxShadow: 'var(--pc-neo-subcard)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <label
                  style={{
                    fontSize: '0.86rem',
                    fontWeight: 700,
                    color: textCol,
                  }}
                >
                  {isClinicSector
                    ? 'İlgili Çalışan / Uzman (İsteğe Bağlı)'
                    : 'İlgili Çalışan / Sorumlu (İsteğe Bağlı)'}
                </label>
                {!selectedDoctorId ? (
                  dayShifts.length === 0 ? (
                    <span
                      style={{
                        fontSize: '0.73rem',
                        color: 'var(--danger, #ef4444)',
                        fontWeight: 700,
                      }}
                    >
                      ⛔ Vardiya Yok
                    </span>
                  ) : shiftValidationError ? (
                    <span
                      style={{
                        fontSize: '0.73rem',
                        color: 'var(--danger, #ef4444)',
                        fontWeight: 700,
                      }}
                    >
                      ⛔ Vardiya / İzin Uyuşmazlığı
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: '#f59e0b',
                        fontWeight: 700,
                      }}
                    >
                      ⚠️ Atanmadı
                    </span>
                  )
                ) : selectedDoctorShifts.length === 0 ? (
                  <span
                    style={{
                      fontSize: '0.73rem',
                      color: 'var(--danger, #ef4444)',
                      fontWeight: 700,
                    }}
                  >
                    ⛔ Vardiya Yok
                  </span>
                ) : shiftValidationError ? (
                  <span
                    style={{
                      fontSize: '0.73rem',
                      color: 'var(--danger, #ef4444)',
                      fontWeight: 700,
                    }}
                  >
                    ⛔ Vardiya / İzin Uyuşmazlığı
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: '0.73rem',
                      color: 'var(--btn-clinic-mint-text, #15803d)',
                      fontWeight: 700,
                    }}
                  >
                    ✓ Vardiya: {selectedDoctorShifts.map((s: any) => `${s.startTime}-${s.endTime}`).join(', ')}
                  </span>
                )}
              </div>
              <select
                value={selectedDoctorId}
                onChange={(e) => setSelectedDoctorId(e.target.value)}
                style={{
                  ...inputStyle,
                  border: shiftValidationError
                    ? '1.5px solid var(--danger, #ef4444)'
                    : !selectedDoctorId
                      ? '1.5px solid #f59e0b'
                      : `1px solid ${inputBorder}`,
                  color: shiftValidationError
                    ? 'var(--danger, #ef4444)'
                    : !selectedDoctorId
                      ? '#f59e0b'
                      : textCol,
                  fontWeight: !selectedDoctorId || shiftValidationError ? 600 : 400,
                }}
              >
                <option value="" style={selectOptionStyle}>
                  ⚠️ Seçiniz (Atama Bekliyor)
                </option>
                {doctors.map((d) => {
                  const tDate = String(defaultDate || '').slice(0, 10);
                  const docShifts = (shifts || []).filter(
                    (s: any) =>
                      s.userId === d.id &&
                      String(s.date || '').slice(0, 10) === tDate
                  );
                  const shiftSuffix =
                    docShifts.length > 0
                      ? ` (${docShifts.map((s: any) => `${s.startTime}-${s.endTime}`).join(', ')})`
                      : ' (Vardiya Yok)';
                  return (
                    <option key={d.id} value={d.id} style={selectOptionStyle}>
                      {d.name}{shiftSuffix}
                    </option>
                  );
                })}
              </select>
              {shiftValidationError && (
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--danger, #ef4444)',
                    background: inputBg,
                    border: '1px solid var(--danger, #ef4444)',
                    borderRadius: '7px',
                    padding: '8px 10px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                    lineHeight: 1.35,
                  }}
                >
                  <span style={{ flexShrink: 0 }}>⚠️</span>
                  <span>{shiftValidationError}</span>
                </div>
              )}
            </div>

            {/* TIME SELECTION */}
            <div
              style={{
                background: subCardBg,
                padding: '14px',
                borderRadius: '10px',
                border: `1px solid ${borderCol}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                boxShadow: 'var(--pc-neo-subcard)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <label
                  style={{
                    fontSize: '0.86rem',
                    fontWeight: 700,
                    color: textCol,
                  }}
                >
                  Randevu Saati
                </label>
                <span
                  style={{
                    fontSize: '0.8rem',
                    color: brandBlue,
                    fontWeight: 700,
                  }}
                >
                  {defaultDate}
                </span>
              </div>
              <FancyHourPicker
                range={timeRange}
                onChange={(val) => {
                  setHasUserChangedTime(true);
                  setTimeRange(val);
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: `1px solid ${borderCol}`,
            background: subCardBg,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '14px 20px',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 18px',
                borderRadius: '8px',
                border: `1px solid ${borderCol}`,
                background: cardBg,
                color: textCol,
                cursor: 'pointer',
                fontSize: '0.86rem',
                fontWeight: 600,
                boxShadow: 'var(--pc-clay-btn)',
              }}
            >
              İptal
            </button>
            <button
              type="button"
              disabled={isSaveDisabled || Boolean(shiftValidationError)}
              onClick={() => void handleSave()}
              style={{
                padding: '9px 24px',
                borderRadius: '8px',
                background: 'linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                border: '1px solid #1d4ed8',
                cursor: isSaveDisabled || Boolean(shiftValidationError) ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                fontSize: '0.86rem',
                opacity: isSaveDisabled || Boolean(shiftValidationError) ? 0.55 : 1,
                boxShadow: isSaveDisabled || Boolean(shiftValidationError) ? 'none' : 'var(--pc-clay-primary)',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ color: '#ffffff' }}>
                {isSubmitting ? 'Kaydediliyor…' : 'Kaydet'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

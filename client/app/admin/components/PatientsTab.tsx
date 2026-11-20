'use client'

import React from 'react'
import DynamicTablesWorkspace from './dynamic-tables/DynamicTablesWorkspace'

export const splitFullName = (
  fullName: string | null | undefined
): { firstName: string; lastName: string } => {
  const clean = (fullName || '').trim()
  if (!clean) return { firstName: '', lastName: '' }
  const parts = clean.split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0] || '', lastName: '' }
  const lastName = parts[parts.length - 1] || ''
  const firstName = parts.slice(0, -1).join(' ')
  return { firstName, lastName }
}

export default function PatientsTab() {
  return <DynamicTablesWorkspace />
}

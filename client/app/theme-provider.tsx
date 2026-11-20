'use client'

import { useEffect, useState } from 'react'

const DOM_GUARD_KEY = '__voiceaiDomReconcileGuarded__'

function isReactHoistedHeadElement(node: Node): boolean {
  if (node.nodeType !== 1) return false
  const tag = (node as Element).tagName
  if (tag !== 'LINK' && tag !== 'STYLE' && tag !== 'META' && tag !== 'TITLE') {
    return false
  }
  const keys = Object.keys(node)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k.startsWith('__reactHoistable$') || k.startsWith('__reactFiber$')) {
      return true
    }
  }
  return false
}

function installDomReconciliationGuard() {
  if (typeof window === 'undefined' || typeof Node === 'undefined') return
  const win = window as unknown as Record<string, unknown>
  if (win[DOM_GUARD_KEY]) return
  win[DOM_GUARD_KEY] = true

  const origRemoveChild = Node.prototype.removeChild
  const origInsertBefore = Node.prototype.insertBefore
  const origAppendChild = Node.prototype.appendChild
  const inertHeadFragment = document.createDocumentFragment()

  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (!child) {
      return origRemoveChild.call(this, child) as T
    }
    if (child.parentNode !== this) {
      return child
    }
    const removed = origRemoveChild.call(this, child) as T
    // Next.js 15 Webpack CSS HMR (mini-css-extract-plugin) veya tarayıcı eklentileri
    // <head> içindeki React 19 HostHoistable (<link rel="stylesheet">) düğümünü React'ten önce
    // kopardığında child.parentNode === null kalıp React commit aşamasında
    // "Cannot read properties of null (reading 'removeChild')" hatasına yol açmasını önler.
    if (typeof document !== 'undefined' && this === document.head && isReactHoistedHeadElement(child)) {
      if (typeof HTMLLinkElement !== 'undefined' && child instanceof HTMLLinkElement) {
        child.disabled = true
      }
      origAppendChild.call(inertHeadFragment, child)
      while (inertHeadFragment.childNodes.length > 32 && inertHeadFragment.firstChild) {
        origRemoveChild.call(inertHeadFragment, inertHeadFragment.firstChild)
      }
    }
    return removed
  }

  Node.prototype.insertBefore = function <T extends Node>(newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      return origAppendChild.call(this, newNode) as T
    }
    return origInsertBefore.call(this, newNode, referenceNode) as T
  }
}

installDomReconciliationGuard()

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    installDomReconciliationGuard()
    const saved = localStorage.getItem('theme') as 'dark' | 'light' | null
    const preferred = saved ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    document.documentElement.setAttribute('data-theme', preferred)
  }, [])

  return <>{children}</>
}

export function ThemeToggle({ className }: { className?: string }) {
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    const update = () => {
      setIsDark((document.documentElement.getAttribute('data-theme') ?? 'dark') === 'dark')
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const toggle = () => {
    const next = isDark ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
  }

  return (
    <button
      onClick={toggle}
      className={`theme-toggle${className ? ` ${className}` : ''}`}
      title={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  )
}

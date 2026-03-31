import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type CustomerVideo = {
  id: string
  title: string
  description: string
  category: string
  mimeType?: string | null
  createdAt: string
  sourceType: 'upload' | 'url'
  streamUrl: string
  customerId: string | null
  customerName: string | null
}

type AccessPayload = {
  code: string
  scope: 'video' | 'customer'
  customerId: string | null
  customerName: string | null
  videos: CustomerVideo[]
}

type Customer = {
  id: string
  name: string
  createdAt: string
  videoCount: number
  activeCodeCount: number
}

type AdminVideo = {
  id: string
  title: string
  description: string
  sourceType: 'upload' | 'url'
  videoUrl: string | null
  fileName: string | null
  filePath: string | null
  mimeType: string | null
  sizeBytes: number | null
  category: string
  customerId: string | null
  customerName: string | null
  createdAt: string
  activeCodeCount: number
}

type ShareCode = {
  id: string
  code: string
  isActive: number
  expiresAt: string | null
  createdAt: string
}

type ActivityLog = {
  id: string
  createdAtIso: string
  createdAtDe: string
  ip: string
  userAgent: string | null
  eventType: string
  code: string | null
  videoId: string | null
  videoTitle: string | null
  customerId: string | null
  customerName: string | null
  success: number
  detail: string | null
}

type AdminTab = 'dashboard' | 'videos' | 'customers' | 'activity'

type AdminAccount = {
  username: string
  twoFactorEnabled: boolean
}

const API_BASE = import.meta.env.VITE_API_URL ?? ''
const LOGO_URL = '/webdesign-hammer-logo.png'
const ADMIN_ACTIVE_TAB_KEY = 'admin_active_tab'

function isAdminTab(value: string | null): value is AdminTab {
  return value === 'dashboard' || value === 'videos' || value === 'customers' || value === 'activity'
}

function toApiUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`
}

function App() {
  const isAdminRoute = window.location.pathname.startsWith('/admin')
  return isAdminRoute ? <AdminApp /> : <CustomerApp />
}

function CustomerApp() {
  const [customerCode, setCustomerCode] = useState(localStorage.getItem('customer_code') ?? '')
  const [access, setAccess] = useState<AccessPayload | null>(null)
  const [customerFilterFrom, setCustomerFilterFrom] = useState('')
  const [customerFilterTo, setCustomerFilterTo] = useState('')
  const [customerKeyword, setCustomerKeyword] = useState('')
  const [customerLoading, setCustomerLoading] = useState(false)
  const [customerError, setCustomerError] = useState<string | null>(null)

  const customerVisibleVideos = useMemo(() => {
    if (!access) return []
    if (access.scope === 'video') return access.videos

    const keyword = customerKeyword.trim().toLowerCase()
    const fromTime = customerFilterFrom ? new Date(`${customerFilterFrom}T00:00:00`).getTime() : null
    const toTime = customerFilterTo ? new Date(`${customerFilterTo}T23:59:59`).getTime() : null

    return access.videos.filter((video) => {
      const createdAt = new Date(video.createdAt).getTime()
      if (fromTime && Number.isFinite(fromTime) && createdAt < fromTime) return false
      if (toTime && Number.isFinite(toTime) && createdAt > toTime) return false

      if (!keyword) return true
      const haystack = [video.title, video.description, video.category, video.customerName || ''].join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
  }, [access, customerFilterFrom, customerFilterTo, customerKeyword])

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCustomerLoading(true)
    setCustomerError(null)

    try {
      const res = await fetch(`${API_BASE}/api/access/by-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: customerCode }),
      })
      if (!res.ok) {
        const api = (await res.json()) as { error?: string }
        throw new Error(api.error ?? 'Code ungültig.')
      }

      const data = (await res.json()) as AccessPayload
      localStorage.setItem('customer_code', data.code)
      setCustomerCode(data.code)
      setAccess(data)
      setCustomerFilterFrom('')
      setCustomerFilterTo('')
      setCustomerKeyword('')
    } catch (err) {
      setCustomerError(err instanceof Error ? err.message : 'Code ungültig.')
    } finally {
      setCustomerLoading(false)
    }
  }

  function leaveVideo() {
    setAccess(null)
    setCustomerFilterFrom('')
    setCustomerFilterTo('')
    setCustomerKeyword('')
    setCustomerError(null)
  }

  return (
    <div className="page page-customer">
      <main className="customer-shell">
        {!access ? (
          <section className="card access-card">
            <img className="brand-logo" src={LOGO_URL} alt="Webdesign Hammer" />
            <h1>Erklärvideo Zugriff</h1>
            <p className="muted">Bitte geben Sie Ihren Freigabecode ein, um Ihr Video direkt abzuspielen.</p>

            <form className="access-form" onSubmit={submitCode}>
              <label>
                Freigabecode
                <input
                  className="input"
                  value={customerCode}
                  onChange={(event) => setCustomerCode(event.target.value.toUpperCase())}
                  placeholder="VID-XXXXXX"
                  required
                />
              </label>
              <button type="submit" className="btn-primary" disabled={customerLoading}>
                {customerLoading ? 'Code wird geprüft…' : 'Video öffnen'}
              </button>
            </form>

            {customerError && <p className="error">{customerError}</p>}
          </section>
        ) : (
          <section className="card video-card">
            <div className="section-head">
              <div>
                <h2>Ihre Videos</h2>
                <p className="muted">{access.customerName || 'Freigabe'}</p>
              </div>
              <button type="button" className="btn-secondary" onClick={leaveVideo}>
                Zurück zur Code-Eingabe
              </button>
            </div>

            {access.scope === 'customer' && (
              <>
                <div className="video-filters customer-filters">
                  <label>
                    Schlagwort
                    <input
                      className="input"
                      placeholder="Titel, Beschreibung, Kategorie…"
                      value={customerKeyword}
                      onChange={(e) => setCustomerKeyword(e.target.value)}
                    />
                  </label>
                  <label>
                    Zeitraum von
                    <input
                      className="input date-input"
                      type="date"
                      value={customerFilterFrom}
                      onChange={(e) => setCustomerFilterFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    Zeitraum bis
                    <input
                      className="input date-input"
                      type="date"
                      value={customerFilterTo}
                      onChange={(e) => setCustomerFilterTo(e.target.value)}
                    />
                  </label>
                </div>
                <p className="muted">Treffer: {customerVisibleVideos.length} von {access.videos.length}</p>
              </>
            )}

            <div className="video-tile-grid">
              {customerVisibleVideos.length === 0 && (
                <article className="panel-card empty-state">
                  <h3>Keine Treffer</h3>
                  <p className="muted">Bitte passen Sie die Filter an.</p>
                </article>
              )}

              {customerVisibleVideos.map((video) => (
                <article key={video.id} className="video-tile">
                  <div className="video-thumb-wrap">
                    {video.sourceType === 'upload' ? (
                      <video
                        className="video-thumb"
                        src={toApiUrl(video.streamUrl)}
                        controls
                        controlsList="nodownload"
                        playsInline
                      />
                    ) : (
                      <div className="video-tile-body">
                        <a className="btn-primary" href={toApiUrl(video.streamUrl)} target="_blank" rel="noreferrer">
                          Externes Video öffnen
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="video-tile-body">
                    <h3>{video.title}</h3>
                    <p className="muted">
                      {video.customerName || access.customerName || 'Kunde'} | {video.category}
                    </p>
                    {video.description && <p className="video-text">{video.description}</p>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function AdminApp() {
  const [adminToken, setAdminToken] = useState<string | null>(localStorage.getItem('admin_token'))
  const [adminUser, setAdminUser] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminOtp, setAdminOtp] = useState('')
  const [loginNeeds2fa, setLoginNeeds2fa] = useState(false)
  const [adminLoginError, setAdminLoginError] = useState<string | null>(null)
  const [adminBusy, setAdminBusy] = useState(false)
  const [account, setAccount] = useState<AdminAccount | null>(null)
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [accountNotice, setAccountNotice] = useState<string | null>(null)

  const [nextUsername, setNextUsername] = useState('')

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [twoFaPassword, setTwoFaPassword] = useState('')
  const [twoFaOtp, setTwoFaOtp] = useState('')
  const [setupSecretFormatted, setSetupSecretFormatted] = useState<string | null>(null)
  const [setupOtpAuthUrl, setSetupOtpAuthUrl] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const saved = localStorage.getItem(ADMIN_ACTIVE_TAB_KEY)
    return isAdminTab(saved) ? saved : 'dashboard'
  })
  const [videos, setVideos] = useState<AdminVideo[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [videosLoading, setVideosLoading] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Allgemein')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [videoFilterCustomerId, setVideoFilterCustomerId] = useState('')
  const [videoFilterFrom, setVideoFilterFrom] = useState('')
  const [videoFilterTo, setVideoFilterTo] = useState('')
  const [videoKeyword, setVideoKeyword] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
  const [editingVideo, setEditingVideo] = useState<AdminVideo | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editCustomerId, setEditCustomerId] = useState('')
  const [editFile, setEditFile] = useState<File | null>(null)
  const [editUploadProgress, setEditUploadProgress] = useState(0)
  const [savingEdit, setSavingEdit] = useState(false)

  const [newCustomerName, setNewCustomerName] = useState('')
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [editCustomerName, setEditCustomerName] = useState('')
  const [savingCustomerEdit, setSavingCustomerEdit] = useState(false)
  const [deletingCustomerId, setDeletingCustomerId] = useState<string | null>(null)

  const [codeMap, setCodeMap] = useState<Record<string, ShareCode[]>>({})
  const [customerCodeMap, setCustomerCodeMap] = useState<Record<string, ShareCode[]>>({})
  const [codesLoadingFor, setCodesLoadingFor] = useState<string | null>(null)
  const [customerCodesLoadingFor, setCustomerCodesLoadingFor] = useState<string | null>(null)
  const [codeBusyFor, setCodeBusyFor] = useState<string | null>(null)
  const [customerCodeBusyFor, setCustomerCodeBusyFor] = useState<string | null>(null)

  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  const totalActiveCodes = useMemo(
    () =>
      videos.reduce((sum, video) => sum + Number(video.activeCodeCount || 0), 0) +
      customers.reduce((sum, customer) => sum + Number(customer.activeCodeCount || 0), 0),
    [videos, customers],
  )

  const filteredVideos = useMemo(() => {
    const keyword = videoKeyword.trim().toLowerCase()
    const fromTime = videoFilterFrom ? new Date(`${videoFilterFrom}T00:00:00`).getTime() : null
    const toTime = videoFilterTo ? new Date(`${videoFilterTo}T23:59:59`).getTime() : null

    return videos.filter((video) => {
      if (videoFilterCustomerId && video.customerId !== videoFilterCustomerId) return false

      const createdAt = new Date(video.createdAt).getTime()
      if (fromTime && Number.isFinite(fromTime) && createdAt < fromTime) return false
      if (toTime && Number.isFinite(toTime) && createdAt > toTime) return false

      if (!keyword) return true
      const haystack = [
        video.title,
        video.description,
        video.category,
        video.customerName || '',
        video.fileName || '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(keyword)
    })
  }, [videos, videoFilterCustomerId, videoFilterFrom, videoFilterTo, videoKeyword])

  useEffect(() => {
    if (adminToken) {
      void loadAdminData(adminToken)
      void loadAccount(adminToken)
    }
  }, [adminToken])

  useEffect(() => {
    if (adminToken && activeTab === 'activity') {
      void loadActivity(adminToken)
    }
  }, [adminToken, activeTab])

  useEffect(() => {
    localStorage.setItem(ADMIN_ACTIVE_TAB_KEY, activeTab)
  }, [activeTab])

  async function adminLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAdminBusy(true)
    setAdminLoginError(null)

    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminUser, password: adminPassword, otp: adminOtp }),
      })
      if (!res.ok) {
        const api = (await res.json()) as { error?: string; requiresTwoFactor?: boolean }
        setLoginNeeds2fa(Boolean(api.requiresTwoFactor))
        throw new Error(api.error || 'Login fehlgeschlagen')
      }

      const data = (await res.json()) as { token: string; username: string; twoFactorEnabled: boolean }
      localStorage.setItem('admin_token', data.token)
      setAdminToken(data.token)
      setAccount({ username: data.username, twoFactorEnabled: data.twoFactorEnabled })
      setAdminUser(data.username)
      setLoginNeeds2fa(data.twoFactorEnabled)
      setAdminPassword('')
      setAdminOtp('')
    } catch (err) {
      setAdminLoginError(err instanceof Error ? err.message : 'Benutzername oder Passwort ist falsch.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function adminLogout() {
    if (!adminToken) return
    try {
      await fetch(`${API_BASE}/api/admin/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    } catch {
      // ignore
    }
    localStorage.removeItem('admin_token')
    setAdminToken(null)
    setAccount(null)
    setAccountModalOpen(false)
    setAccountError(null)
    setAccountNotice(null)
    setVideos([])
    setCustomers([])
    setCodeMap({})
    setCustomerCodeMap({})
    setLogs([])
  }

  async function loadAdminData(token: string) {
    setVideosLoading(true)
    setAdminError(null)
    try {
      const [videosRes, customersRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/videos`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/api/admin/customers`, { headers: { Authorization: `Bearer ${token}` } }),
      ])

      if (videosRes.status === 401 || customersRes.status === 401) {
        await adminLogout()
        return
      }

      if (!videosRes.ok || !customersRes.ok) {
        throw new Error('Daten konnten nicht geladen werden.')
      }

      const videosData = (await videosRes.json()) as AdminVideo[]
      const customerData = (await customersRes.json()) as Customer[]
      setVideos(videosData)
      setCustomers(customerData)
      if (!selectedCustomerId && customerData.length) {
        setSelectedCustomerId(customerData[0].id)
      }
    } catch {
      setAdminError('Daten konnten nicht geladen werden.')
    } finally {
      setVideosLoading(false)
    }
  }

  async function loadAccount(token: string) {
    try {
      const res = await fetch(`${API_BASE}/api/admin/account`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        await adminLogout()
        return
      }
      if (!res.ok) throw new Error('Konto konnte nicht geladen werden.')
      const data = (await res.json()) as AdminAccount
      setAccount(data)
      setAdminUser((prev) => prev || data.username)
      setNextUsername(data.username)
      setLoginNeeds2fa(data.twoFactorEnabled)
    } catch {
      setAdminError('Konto konnte nicht geladen werden.')
    }
  }

  async function accountApi(path: string, body: Record<string, unknown>, method = 'POST') {
    if (!adminToken) throw new Error('Nicht angemeldet.')
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.status === 401 && String(payload.error || '').toLowerCase().includes('session')) {
      await adminLogout()
      throw new Error('Session abgelaufen. Bitte erneut anmelden.')
    }
    if (!res.ok) throw new Error(String(payload.error || 'Anfrage fehlgeschlagen.'))
    return payload
  }

  async function saveUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAccountBusy(true)
    setAccountError(null)
    setAccountNotice(null)
    try {
      const data = await accountApi(
        '/api/admin/account/username',
        {
        username: nextUsername,
        },
        'PATCH',
      )
      const updatedUsername = String(data.username || nextUsername)
      setAccount((prev) => ({ username: updatedUsername, twoFactorEnabled: Boolean(prev?.twoFactorEnabled) }))
      setAdminUser(updatedUsername)
      setNextUsername(updatedUsername)
      setAccountNotice('Benutzername wurde gespeichert.')
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Benutzername konnte nicht geändert werden.')
    } finally {
      setAccountBusy(false)
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setAccountError('Neues Passwort und Bestätigung stimmen nicht überein.')
      return
    }
    setAccountBusy(true)
    setAccountError(null)
    setAccountNotice(null)
    try {
      const data = await accountApi(
        '/api/admin/account/password',
        {
        newPassword,
        },
        'PATCH',
      )
      if (!data.ok) throw new Error('Passwort konnte nicht gespeichert werden.')
      setAccountNotice('Passwort wurde gespeichert.')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : 'Passwort konnte nicht geändert werden.')
    } finally {
      setAccountBusy(false)
    }
  }

  async function startTwoFactorSetup() {
    setAccountBusy(true)
    setAccountError(null)
    setAccountNotice(null)
    try {
      const data = await accountApi('/api/admin/account/2fa/setup', { password: twoFaPassword })
      setSetupSecretFormatted(String(data.secretFormatted || ''))
      setSetupOtpAuthUrl(String(data.otpauthUrl || ''))
      setAccountNotice('2FA-Setup erstellt. Bitte Code aus Ihrer Authenticator-App eingeben und aktivieren.')
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : '2FA-Setup fehlgeschlagen.')
    } finally {
      setAccountBusy(false)
    }
  }

  async function enableTwoFactor() {
    setAccountBusy(true)
    setAccountError(null)
    setAccountNotice(null)
    try {
      const data = await accountApi('/api/admin/account/2fa/enable', {
        password: twoFaPassword,
        otp: twoFaOtp,
      })
      setAccountNotice('2FA wurde aktiviert. Bitte melden Sie sich erneut an.')
      if (data.reLoginRequired) {
        await adminLogout()
      }
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : '2FA konnte nicht aktiviert werden.')
    } finally {
      setAccountBusy(false)
    }
  }

  async function disableTwoFactor() {
    setAccountBusy(true)
    setAccountError(null)
    setAccountNotice(null)
    try {
      const data = await accountApi('/api/admin/account/2fa/disable', {
        password: twoFaPassword,
        otp: twoFaOtp,
      })
      setAccountNotice('2FA wurde deaktiviert. Bitte melden Sie sich erneut an.')
      if (data.reLoginRequired) {
        await adminLogout()
      }
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : '2FA konnte nicht deaktiviert werden.')
    } finally {
      setAccountBusy(false)
    }
  }

  async function loadActivity(token: string) {
    setLogsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/admin/activity?limit=300`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        await adminLogout()
        return
      }
      if (!res.ok) throw new Error('Log konnte nicht geladen werden')
      const data = (await res.json()) as ActivityLog[]
      setLogs(data)
    } catch {
      setAdminError('Aktivitätslog konnte nicht geladen werden.')
    } finally {
      setLogsLoading(false)
    }
  }

  function uploadWithProgress(
    url: string,
    token: string,
    formData: FormData,
    method: 'POST' | 'PATCH' = 'POST',
    onProgress?: (percent: number) => void,
  ) {
    return new Promise<AdminVideo>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open(method, url)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.responseType = 'json'

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        const percent = Math.round((event.loaded / event.total) * 100)
        if (onProgress) onProgress(percent)
        else setUploadProgress(percent)
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response as AdminVideo)
          return
        }
        const msg = (xhr.response as { error?: string })?.error ?? 'Upload fehlgeschlagen'
        reject(new Error(msg))
      }

      xhr.onerror = () => reject(new Error('Netzwerkfehler beim Upload'))
      xhr.send(formData)
    })
  }

  async function uploadVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!adminToken || !file) {
      setAdminError('Bitte Videodatei auswählen.')
      return
    }
    if (!selectedCustomerId) {
      setAdminError('Bitte zuerst einen Kunden auswählen.')
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setAdminError(null)

    try {
      const formData = new FormData()
      formData.set('title', title)
      formData.set('description', description)
      formData.set('category', category)
      formData.set('customerId', selectedCustomerId)
      formData.set('video', file)

      const created = await uploadWithProgress(`${API_BASE}/api/admin/videos/upload`, adminToken, formData)
      setVideos((prev) => [{ ...created, activeCodeCount: 0 }, ...prev])
      setCustomers((prev) =>
        prev.map((item) =>
          item.id === selectedCustomerId ? { ...item, videoCount: item.videoCount + 1 } : item,
        ),
      )
      setTitle('')
      setDescription('')
      setCategory('Allgemein')
      setFile(null)
      const input = document.getElementById('video-file') as HTMLInputElement | null
      if (input) input.value = ''
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Upload fehlgeschlagen.')
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!adminToken) return
    if (!newCustomerName.trim()) {
      setAdminError('Bitte einen Kundennamen eingeben.')
      return
    }

    setCreatingCustomer(true)
    setAdminError(null)
    try {
      const res = await fetch(`${API_BASE}/api/admin/customers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newCustomerName.trim() }),
      })
      if (!res.ok) {
        const api = (await res.json()) as { error?: string }
        throw new Error(api.error ?? 'Kunde konnte nicht angelegt werden')
      }
      const created = (await res.json()) as Customer
      const createdNormalized = { ...created, videoCount: 0, activeCodeCount: 0 }
      setCustomers((prev) => [...prev, createdNormalized].sort((a, b) => a.name.localeCompare(b.name, 'de')))
      setSelectedCustomerId(created.id)
      setNewCustomerName('')
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Kunde konnte nicht angelegt werden')
    } finally {
      setCreatingCustomer(false)
    }
  }

  function openEditCustomer(customer: Customer) {
    setEditingCustomer(customer)
    setEditCustomerName(customer.name)
  }

  function closeEditCustomer() {
    setEditingCustomer(null)
    setEditCustomerName('')
    setSavingCustomerEdit(false)
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!adminToken || !editingCustomer) return
    if (!editCustomerName.trim()) {
      setAdminError('Bitte einen Kundennamen eingeben.')
      return
    }

    setSavingCustomerEdit(true)
    setAdminError(null)
    try {
      const res = await fetch(`${API_BASE}/api/admin/customers/${editingCustomer.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: editCustomerName.trim() }),
      })
      if (!res.ok) {
        const api = (await res.json()) as { error?: string }
        throw new Error(api.error ?? 'Kunde konnte nicht bearbeitet werden.')
      }

      const updated = (await res.json()) as Customer
      setCustomers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setVideos((prev) =>
        prev.map((video) => (video.customerId === updated.id ? { ...video, customerName: updated.name } : video)),
      )
      closeEditCustomer()
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Kunde konnte nicht bearbeitet werden.')
    } finally {
      setSavingCustomerEdit(false)
    }
  }

  async function deleteCustomer(customerId: string) {
    if (!adminToken) return
    setDeletingCustomerId(customerId)
    setAdminError(null)
    try {
      const res = await fetch(`${API_BASE}/api/admin/customers/${customerId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      if (!res.ok) {
        const api = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(api.error ?? 'Kunde konnte nicht gelöscht werden.')
      }

      setCustomers((prev) => prev.filter((item) => item.id !== customerId))
      setCustomerCodeMap((prev) => {
        const next = { ...prev }
        delete next[customerId]
        return next
      })
      setVideos((prev) =>
        prev.map((video) => (video.customerId === customerId ? { ...video, customerId: null, customerName: null } : video)),
      )
      if (selectedCustomerId === customerId) {
        setSelectedCustomerId('')
      }
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Kunde konnte nicht gelöscht werden.')
    } finally {
      setDeletingCustomerId(null)
    }
  }

  async function deleteVideo(videoId: string) {
    if (!adminToken) return
    setAdminError(null)

    const video = videos.find((item) => item.id === videoId)

    try {
      const res = await fetch(`${API_BASE}/api/admin/videos/${videoId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      if (!res.ok) throw new Error('Löschen fehlgeschlagen')

      setVideos((prev) => prev.filter((item) => item.id !== videoId))
      setCodeMap((prev) => {
        const next = { ...prev }
        delete next[videoId]
        return next
      })
      if (video?.customerId) {
        setCustomers((prev) =>
          prev.map((item) =>
            item.id === video.customerId ? { ...item, videoCount: Math.max(0, item.videoCount - 1) } : item,
          ),
        )
      }
    } catch {
      setAdminError('Video konnte nicht gelöscht werden.')
    }
  }

  function openEditVideo(video: AdminVideo) {
    setEditingVideo(video)
    setEditTitle(video.title)
    setEditDescription(video.description || '')
    setEditCategory(video.category || 'Allgemein')
    setEditCustomerId(video.customerId || '')
    setEditFile(null)
    setEditUploadProgress(0)
    const input = document.getElementById('edit-video-file') as HTMLInputElement | null
    if (input) input.value = ''
  }

  function openAccountModal() {
    setNextUsername(account?.username || '')
    setNewPassword('')
    setConfirmPassword('')
    setTwoFaPassword('')
    setTwoFaOtp('')
    setSetupSecretFormatted(null)
    setSetupOtpAuthUrl(null)
    setAccountError(null)
    setAccountNotice(null)
    setAccountModalOpen(true)
  }

  function closeEditVideo() {
    setEditingVideo(null)
    setEditFile(null)
    setEditUploadProgress(0)
    const input = document.getElementById('edit-video-file') as HTMLInputElement | null
    if (input) input.value = ''
    setSavingEdit(false)
  }

  async function saveEditVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!adminToken || !editingVideo) return
    if (!editCustomerId) {
      setAdminError('Bitte einen Kunden auswählen.')
      return
    }

    setSavingEdit(true)
    setAdminError(null)
    try {
      let updated: AdminVideo
      if (editFile) {
        const formData = new FormData()
        formData.set('title', editTitle)
        formData.set('description', editDescription)
        formData.set('category', editCategory)
        formData.set('customerId', editCustomerId)
        formData.set('video', editFile)
        updated = await uploadWithProgress(
          `${API_BASE}/api/admin/videos/${editingVideo.id}/replace`,
          adminToken,
          formData,
          'POST',
          setEditUploadProgress,
        )
      } else {
        const res = await fetch(`${API_BASE}/api/admin/videos/${editingVideo.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: editTitle,
            description: editDescription,
            category: editCategory,
            customerId: editCustomerId,
          }),
        })
        if (!res.ok) {
          const api = (await res.json()) as { error?: string }
          throw new Error(api.error ?? 'Video konnte nicht bearbeitet werden.')
        }
        updated = (await res.json()) as AdminVideo
      }
      setVideos((prev) => prev.map((video) => (video.id === updated.id ? updated : video)))
      closeEditVideo()
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Video konnte nicht bearbeitet werden.')
    } finally {
      setSavingEdit(false)
      setEditUploadProgress(0)
    }
  }

  async function loadCodes(videoId: string) {
    if (!adminToken) return
    setCodesLoadingFor(videoId)
    try {
      const res = await fetch(`${API_BASE}/api/admin/videos/${videoId}/codes`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      if (!res.ok) throw new Error('Codes konnten nicht geladen werden')
      const data = (await res.json()) as ShareCode[]
      setCodeMap((prev) => ({ ...prev, [videoId]: data }))
    } catch {
      setAdminError('Codes konnten nicht geladen werden.')
    } finally {
      setCodesLoadingFor(null)
    }
  }

  async function generateVideoCode(videoId: string) {
    if (!adminToken) return
    setCodeBusyFor(videoId)
    try {
      const res = await fetch(`${API_BASE}/api/admin/videos/${videoId}/codes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const api = (await res.json()) as { error?: string }
        throw new Error(api.error ?? 'Code konnte nicht erzeugt werden')
      }

      const created = (await res.json()) as ShareCode
      setCodeMap((prev) => ({ ...prev, [videoId]: [created, ...(prev[videoId] ?? [])] }))
      setVideos((prev) =>
        prev.map((video) =>
          video.id === videoId ? { ...video, activeCodeCount: video.activeCodeCount + 1 } : video,
        ),
      )
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Code konnte nicht erzeugt werden')
    } finally {
      setCodeBusyFor(null)
    }
  }

  async function loadCustomerCodes(customerId: string) {
    if (!adminToken) return
    setCustomerCodesLoadingFor(customerId)
    try {
      const res = await fetch(`${API_BASE}/api/admin/customers/${customerId}/codes`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      if (!res.ok) throw new Error('Kundencodes konnten nicht geladen werden')
      const data = (await res.json()) as ShareCode[]
      setCustomerCodeMap((prev) => ({ ...prev, [customerId]: data }))
    } catch {
      setAdminError('Kundencodes konnten nicht geladen werden.')
    } finally {
      setCustomerCodesLoadingFor(null)
    }
  }

  async function generateCustomerCode(customerId: string) {
    if (!adminToken) return
    setCustomerCodeBusyFor(customerId)
    try {
      const res = await fetch(`${API_BASE}/api/admin/customers/${customerId}/codes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const api = (await res.json()) as { error?: string }
        throw new Error(api.error ?? 'Kundencode konnte nicht erzeugt werden')
      }
      const created = (await res.json()) as ShareCode
      setCustomerCodeMap((prev) => ({ ...prev, [customerId]: [created, ...(prev[customerId] ?? [])] }))
      setCustomers((prev) =>
        prev.map((item) =>
          item.id === customerId ? { ...item, activeCodeCount: item.activeCodeCount + 1 } : item,
        ),
      )
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Kundencode konnte nicht erzeugt werden')
    } finally {
      setCustomerCodeBusyFor(null)
    }
  }

  async function toggleCode(codeId: string, contextId: string, isCurrentlyActive: boolean, isCustomerScope = false) {
    if (!adminToken) return
    try {
      const res = await fetch(`${API_BASE}/api/admin/codes/${codeId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: !isCurrentlyActive }),
      })
      if (!res.ok) throw new Error('Code-Status konnte nicht geändert werden.')

      if (isCustomerScope) {
        setCustomerCodeMap((prev) => ({
          ...prev,
          [contextId]: (prev[contextId] ?? []).map((code) =>
            code.id === codeId ? { ...code, isActive: isCurrentlyActive ? 0 : 1 } : code,
          ),
        }))
        setCustomers((prev) =>
          prev.map((customer) => {
            if (customer.id !== contextId) return customer
            return {
              ...customer,
              activeCodeCount: isCurrentlyActive
                ? Math.max(0, customer.activeCodeCount - 1)
                : customer.activeCodeCount + 1,
            }
          }),
        )
        return
      }

      setCodeMap((prev) => ({
        ...prev,
        [contextId]: (prev[contextId] ?? []).map((code) =>
          code.id === codeId ? { ...code, isActive: isCurrentlyActive ? 0 : 1 } : code,
        ),
      }))
      setVideos((prev) =>
        prev.map((video) => {
          if (video.id !== contextId) return video
          return {
            ...video,
            activeCodeCount: isCurrentlyActive
              ? Math.max(0, video.activeCodeCount - 1)
              : video.activeCodeCount + 1,
          }
        }),
      )
    } catch {
      setAdminError('Code-Status konnte nicht aktualisiert werden.')
    }
  }

  function copyCode(code: string) {
    void navigator.clipboard.writeText(code)
  }

  function formatSize(bytes: number | null): string {
    if (!bytes) return '-'
    const mb = bytes / 1024 / 1024
    return `${mb.toFixed(1)} MB`
  }

  function adminPreviewUrl(videoId: string): string {
    if (!adminToken) return ''
    return `${API_BASE}/api/admin/videos/${videoId}/stream?token=${encodeURIComponent(adminToken)}`
  }

  function renderDashboard() {
    return (
      <section className="panel-grid">
        <article className="panel-card stat">
          <h3>Kunden</h3>
          <p>{customers.length}</p>
        </article>
        <article className="panel-card stat">
          <h3>Videos gesamt</h3>
          <p>{videos.length}</p>
        </article>
        <article className="panel-card stat">
          <h3>Aktive Codes</h3>
          <p>{totalActiveCodes}</p>
        </article>
      </section>
    )
  }

  function renderVideosTab() {
    return (
      <section className="panel-card">
        <div className="section-head">
          <h2>Videos</h2>
          <button type="button" className="btn-primary" onClick={() => setIsUploadModalOpen(true)}>
            Video hinzufügen
          </button>
        </div>

        <div className="video-filters">
          <label>
            Schlagwort
            <input
              className="input"
              placeholder="Titel, Beschreibung, Kategorie, Kunde…"
              value={videoKeyword}
              onChange={(e) => setVideoKeyword(e.target.value)}
            />
          </label>
          <label>
            Kunde
            <select className="input" value={videoFilterCustomerId} onChange={(e) => setVideoFilterCustomerId(e.target.value)}>
              <option value="">Alle Kunden</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Zeitraum von
            <input className="input" type="date" value={videoFilterFrom} onChange={(e) => setVideoFilterFrom(e.target.value)} />
          </label>
          <label>
            Zeitraum bis
            <input className="input" type="date" value={videoFilterTo} onChange={(e) => setVideoFilterTo(e.target.value)} />
          </label>
        </div>
        <p className="muted">Treffer: {filteredVideos.length} von {videos.length}</p>

        <div className="video-tile-grid">
          {!videos.length && (
            <article className="panel-card empty-state">
              <h3>Noch keine Videos vorhanden</h3>
              <p className="muted">Fügen Sie Ihr erstes Video über „Video hinzufügen“ hinzu.</p>
            </article>
          )}

          {videos.length > 0 && filteredVideos.length === 0 && (
            <article className="panel-card empty-state">
              <h3>Keine Treffer</h3>
              <p className="muted">Bitte passen Sie die Filter an.</p>
            </article>
          )}

          {filteredVideos.map((video) => (
            <article key={video.id} className="video-tile">
              <div className="video-thumb-wrap">
                <video
                  className="video-thumb"
                  src={adminPreviewUrl(video.id)}
                  preload="metadata"
                  muted
                  controls
                  controlsList="nodownload"
                />
              </div>
              <div className="video-tile-body">
                <h3>{video.title}</h3>
                <p className="muted">
                  {video.customerName || 'Ohne Kunde'} | {video.category} | {formatSize(video.sizeBytes)}
                </p>
                <div className="row-actions">
                  <button className="btn-secondary" type="button" onClick={() => openEditVideo(video)}>
                    Bearbeiten
                  </button>
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => void generateVideoCode(video.id)}
                    disabled={codeBusyFor === video.id}
                  >
                    {codeBusyFor === video.id ? 'Erzeuge…' : 'Video-Code erzeugen'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void loadCodes(video.id)}
                    disabled={codesLoadingFor === video.id}
                  >
                    {codesLoadingFor === video.id ? 'Lade…' : 'Video-Codes anzeigen'}
                  </button>
                  <button className="btn-danger" type="button" onClick={() => void deleteVideo(video.id)}>
                    Löschen
                  </button>
                </div>
                <p className="muted">Aktive Video-Codes: {video.activeCodeCount}</p>
                {(codeMap[video.id] ?? []).length > 0 && (
                  <ul className="code-list">
                    {(codeMap[video.id] ?? []).map((code) => (
                      <li key={code.id}>
                        <span className="code-pill">{code.code}</span>
                        <span className={code.isActive ? 'badge green' : 'badge red'}>
                          {code.isActive ? 'aktiv' : 'inaktiv'}
                        </span>
                        <button type="button" className="mini" onClick={() => copyCode(code.code)}>
                          Kopieren
                        </button>
                        <button
                          type="button"
                          className="mini"
                          onClick={() => void toggleCode(code.id, video.id, Boolean(code.isActive), false)}
                        >
                          {code.isActive ? 'Deaktivieren' : 'Aktivieren'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    )
  }

  function renderCustomersTab() {
    const groupedByCustomer = customers.map((customer) => ({
      ...customer,
      videos: videos.filter((video) => video.customerId === customer.id),
    }))

    return (
      <section className="panel-card">
        <h2>Kunden</h2>
        <form className="customer-create" onSubmit={createCustomer}>
          <input
            className="input"
            placeholder="Neuen Kunden anlegen"
            value={newCustomerName}
            onChange={(event) => setNewCustomerName(event.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={creatingCustomer}>
            {creatingCustomer ? 'Speichere…' : 'Kunde anlegen'}
          </button>
        </form>

        <div className="customer-list">
          {groupedByCustomer.map((customer) => (
            <article key={customer.id} className="customer-card">
              <div>
                <h3>{customer.name}</h3>
                <p className="muted">Videos: {customer.videoCount} | Aktive Kundencodes: {customer.activeCodeCount}</p>
                <div className="customer-video-links">
                  {customer.videos.length === 0 && <span className="muted">Keine Videos zugeordnet</span>}
                  {customer.videos.map((video) => (
                    <span key={video.id} className="video-chip">
                      {video.title}
                    </span>
                  ))}
                </div>
              </div>
              <div className="row-actions">
                <button className="btn-secondary" type="button" onClick={() => openEditCustomer(customer)}>
                  Bearbeiten
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => void generateCustomerCode(customer.id)}
                  disabled={customerCodeBusyFor === customer.id}
                >
                  {customerCodeBusyFor === customer.id ? 'Erzeuge…' : 'Kundencode erzeugen'}
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => void loadCustomerCodes(customer.id)}
                  disabled={customerCodesLoadingFor === customer.id}
                  >
                    {customerCodesLoadingFor === customer.id ? 'Lade…' : 'Kundencodes anzeigen'}
                  </button>
                  <button
                    className="btn-danger"
                    type="button"
                    onClick={() => void deleteCustomer(customer.id)}
                    disabled={deletingCustomerId === customer.id}
                  >
                    {deletingCustomerId === customer.id ? 'Lösche…' : 'Löschen'}
                  </button>
              </div>

              {(customerCodeMap[customer.id] ?? []).length > 0 && (
                <ul className="code-list">
                  {(customerCodeMap[customer.id] ?? []).map((code) => (
                    <li key={code.id}>
                      <span className="code-pill">{code.code}</span>
                      <span className={code.isActive ? 'badge green' : 'badge red'}>
                        {code.isActive ? 'aktiv' : 'inaktiv'}
                      </span>
                      <button type="button" className="mini" onClick={() => copyCode(code.code)}>
                        Kopieren
                      </button>
                      <button
                        type="button"
                        className="mini"
                        onClick={() => void toggleCode(code.id, customer.id, Boolean(code.isActive), true)}
                      >
                        {code.isActive ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>
    )
  }

  function renderActivityTab() {
    return (
      <section className="panel-card">
        <div className="activity-head">
          <h2>Aktivitätslog</h2>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => adminToken && void loadActivity(adminToken)}
            disabled={logsLoading}
          >
            {logsLoading ? 'Lade…' : 'Aktualisieren'}
          </button>
        </div>

        <div className="table-wrap">
          <table className="activity-table">
            <thead>
              <tr>
                <th>Zeit (DE)</th>
                <th>IP</th>
                <th>Ereignis</th>
                <th>Kunde</th>
                <th>Code</th>
                <th>Video</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {!logs.length && (
                <tr>
                  <td colSpan={8}>Noch keine Einträge vorhanden.</td>
                </tr>
              )}
              {logs.map((row) => (
                <tr key={row.id}>
                  <td>{row.createdAtDe}</td>
                  <td>{row.ip}</td>
                  <td>{row.eventType}</td>
                  <td>{row.customerName || row.customerId || '-'}</td>
                  <td>{row.code || '-'}</td>
                  <td>{row.videoTitle || row.videoId || '-'}</td>
                  <td>
                    <span className={row.success ? 'badge green' : 'badge red'}>
                      {row.success ? 'ok' : 'fehler'}
                    </span>
                  </td>
                  <td>{row.detail || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  if (!adminToken) {
    return (
      <div className="page page-admin">
        <main className="admin-login-shell">
          <section className="card access-card">
            <img className="brand-logo" src={LOGO_URL} alt="Webdesign Hammer" />
            <h1>Admin Login</h1>
            <p className="muted">Bereich für Uploads, Freigabecodes und Aktivitätsprotokolle.</p>
            <form className="access-form" onSubmit={adminLogin}>
              <label>
                Benutzername
                <input className="input" value={adminUser} onChange={(e) => setAdminUser(e.target.value)} required />
              </label>
              <label>
                Passwort
                <input
                  type="password"
                  className="input"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  required
                />
              </label>
              {loginNeeds2fa && (
                <label>
                  2FA-Code
                  <input
                    className="input"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    value={adminOtp}
                    onChange={(e) => setAdminOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    required
                  />
                </label>
              )}
              <button type="submit" className="btn-primary" disabled={adminBusy}>
                {adminBusy ? 'Anmeldung läuft…' : 'Anmelden'}
              </button>
            </form>
            {adminLoginError && <p className="error">{adminLoginError}</p>}
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="page page-admin admin-layout">
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <img className="brand-logo-small" src={LOGO_URL} alt="Webdesign Hammer" />
        </div>

        <nav className="sidebar-nav">
          <button className={activeTab === 'dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('dashboard')}>
            Dashboard
          </button>
          <button className={activeTab === 'videos' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('videos')}>
            Videos & Codes
          </button>
          <button className={activeTab === 'customers' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('customers')}>
            Kunden
          </button>
          <button className={activeTab === 'activity' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('activity')}>
            Aktivitätslog
          </button>
        </nav>

        <button type="button" className="btn-secondary sidebar-logout" onClick={adminLogout}>
          Abmelden
        </button>
      </aside>

      <main className="admin-content">
        <header className="admin-content-head panel-card">
          <div className="admin-head-row">
            <div>
              <h1>
                {activeTab === 'dashboard' && 'Dashboard'}
                {activeTab === 'videos' && 'Videos & Freigabecodes'}
                {activeTab === 'customers' && 'Kunden'}
                {activeTab === 'activity' && 'Aktivitätslog'}
              </h1>
              <p className="muted">
                {videosLoading ? 'Daten werden geladen…' : `${videos.length} Videos | ${customers.length} Kunden`}
              </p>
            </div>
            <div className="account-chip-wrap">
              <button type="button" className="account-chip" onClick={openAccountModal}>
                <span className="account-chip-icon" aria-hidden="true">Konto</span>
                <span>{account?.username || adminUser || 'Admin'}</span>
              </button>
            </div>
          </div>
          {adminError && <p className="error">{adminError}</p>}
        </header>

        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'videos' && renderVideosTab()}
        {activeTab === 'customers' && renderCustomersTab()}
        {activeTab === 'activity' && renderActivityTab()}

        {accountModalOpen && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card account-modal">
              <div className="section-head">
                <h2>Mein Konto</h2>
                <button type="button" className="btn-secondary" onClick={() => setAccountModalOpen(false)}>
                  Schließen
                </button>
              </div>

              {accountError && <p className="error">{accountError}</p>}
              {accountNotice && <p className="notice">{accountNotice}</p>}

              <section className="panel-card account-section">
                <h3>Benutzername ändern</h3>
                <form className="stack" onSubmit={saveUsername}>
                  <label>
                    Neuer Benutzername
                    <input className="input" value={nextUsername} onChange={(e) => setNextUsername(e.target.value)} required />
                  </label>
                  <button type="submit" className="btn-primary" disabled={accountBusy}>
                    Speichern
                  </button>
                </form>
              </section>

              <section className="panel-card account-section">
                <h3>Passwort ändern</h3>
                <form className="stack" onSubmit={savePassword}>
                  <label>
                    Neues Passwort
                    <input
                      className="input"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Neues Passwort bestätigen
                    <input
                      className="input"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </label>
                  <button type="submit" className="btn-primary" disabled={accountBusy}>
                    Passwort speichern
                  </button>
                </form>
              </section>

              <section className="panel-card account-section">
                <h3>2FA Sicherheit</h3>
                <p className="muted">{account?.twoFactorEnabled ? '2FA ist aktiv.' : '2FA ist derzeit deaktiviert.'}</p>
                <div className="stack">
                  <label>
                    Passwort zur Bestätigung
                    <input
                      className="input"
                      type="password"
                      value={twoFaPassword}
                      onChange={(e) => setTwoFaPassword(e.target.value)}
                      required
                    />
                  </label>

                  {!account?.twoFactorEnabled && (
                    <>
                      <button type="button" className="btn-secondary" onClick={() => void startTwoFactorSetup()} disabled={accountBusy}>
                        2FA Setup starten
                      </button>
                      {setupSecretFormatted && (
                        <div className="otp-secret-box">
                          <p>
                            <strong>Secret:</strong> <span className="code-pill">{setupSecretFormatted}</span>
                          </p>
                          {setupOtpAuthUrl && (
                            <p className="muted">
                              Alternativ-Link: <code>{setupOtpAuthUrl}</code>
                            </p>
                          )}
                        </div>
                      )}
                      <label>
                        Code aus Authenticator-App
                        <input
                          className="input"
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          value={twoFaOtp}
                          onChange={(e) => setTwoFaOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        />
                      </label>
                      <button type="button" className="btn-primary" onClick={() => void enableTwoFactor()} disabled={accountBusy}>
                        2FA aktivieren
                      </button>
                    </>
                  )}

                  {account?.twoFactorEnabled && (
                    <>
                      <label>
                        Aktueller 2FA-Code
                        <input
                          className="input"
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          value={twoFaOtp}
                          onChange={(e) => setTwoFaOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          required
                        />
                      </label>
                      <button type="button" className="btn-secondary" onClick={() => void disableTwoFactor()} disabled={accountBusy}>
                        2FA deaktivieren
                      </button>
                    </>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {activeTab === 'customers' && editingCustomer && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card">
              <div className="section-head">
                <h2>Kunde bearbeiten</h2>
                <button type="button" className="btn-secondary" onClick={closeEditCustomer}>
                  Schließen
                </button>
              </div>

              <form className="stack" onSubmit={saveCustomer}>
                <label>
                  Kundenname
                  <input className="input" value={editCustomerName} onChange={(e) => setEditCustomerName(e.target.value)} required />
                </label>
                <button type="submit" className="btn-primary" disabled={savingCustomerEdit}>
                  {savingCustomerEdit ? 'Speichert…' : 'Änderungen speichern'}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'videos' && isUploadModalOpen && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card">
              <div className="section-head">
                <h2>Video hinzufügen</h2>
                <button type="button" className="btn-secondary" onClick={() => setIsUploadModalOpen(false)}>
                  Schließen
                </button>
              </div>

              <form className="upload-grid" onSubmit={uploadVideo}>
                <label>
                  Titel
                  <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
                </label>
                <label>
                  Kategorie
                  <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} required />
                </label>
                <label>
                  Kunde
                  <select className="input" value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)} required>
                    <option value="">Kunde auswählen…</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div></div>
                <label className="full-width">
                  Beschreibung
                  <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
                <label className="full-width">
                  Videodatei
                  <input
                    id="video-file"
                    className="input"
                    type="file"
                    accept="video/*"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    required
                  />
                </label>
                <div className="full-width upload-actions">
                  <button type="submit" className="btn-primary" disabled={uploading}>
                    {uploading ? `Upload ${uploadProgress}%` : 'Hochladen'}
                  </button>
                </div>
              </form>
              {uploading && (
                <div className="progress-wrap" aria-label="Upload-Fortschritt">
                  <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'videos' && editingVideo && (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card">
              <div className="section-head">
                <h2>Video bearbeiten</h2>
                <button type="button" className="btn-secondary" onClick={closeEditVideo}>
                  Schließen
                </button>
              </div>

              <form className="upload-grid" onSubmit={saveEditVideo}>
                <label>
                  Titel
                  <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
                </label>
                <label>
                  Kategorie
                  <input className="input" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} required />
                </label>
                <label>
                  Kunde
                  <select className="input" value={editCustomerId} onChange={(e) => setEditCustomerId(e.target.value)} required>
                    <option value="">Kunde auswählen…</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div></div>
                <label className="full-width">
                  Beschreibung
                  <textarea className="input" rows={3} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                </label>
                <label className="full-width">
                  Videodatei ersetzen (optional)
                  <input
                    id="edit-video-file"
                    className="input"
                    type="file"
                    accept="video/*"
                    onChange={(event) => setEditFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <div className="full-width upload-actions">
                  <button type="submit" className="btn-primary" disabled={savingEdit}>
                    {savingEdit
                      ? editFile
                        ? `Datei wird ersetzt ${editUploadProgress}%`
                        : 'Speichert…'
                      : 'Änderungen speichern'}
                  </button>
                </div>
              </form>
              {savingEdit && editFile && (
                <div className="progress-wrap" aria-label="Upload-Fortschritt">
                  <div className="progress-bar" style={{ width: `${editUploadProgress}%` }} />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App

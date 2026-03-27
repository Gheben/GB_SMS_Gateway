import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
})

// Inietta il token JWT in ogni richiesta se presente
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('jwt_token')
  if (token) cfg.headers['Authorization'] = `Bearer ${token}`
  return cfg
})

// Redirect al login se il token scade (NON per le route di autenticazione stesse)
api.interceptors.response.use(
  r => r,
  err => {
    const url = err.config?.url || ''
    const isAuthRoute = url.includes('/auth/login') || url.includes('/auth/sso') || url.includes('/auth/refresh-token')
    const alreadyOnLogin = window.location.pathname === '/login'
    if (err.response?.status === 401 && !isAuthRoute && !alreadyOnLogin) {
      localStorage.removeItem('jwt_token')
      localStorage.removeItem('jwt_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export const authApi = {
  login:        (username, password) => api.post('/auth/login', { username, password }).then(r => r.data),
  sso:          () => api.get('/auth/sso').then(r => r.data),
  getPerms:     () => api.get('/users/permissions').then(r => r.data),
  refreshToken: () => api.get('/auth/refresh-token').then(r => r.data),
}

export const usersApi = {
  getAll:  () => api.get('/users').then(r => r.data),
  create:  (data) => api.post('/users', data).then(r => r.data),
  update:  (id, data) => api.put(`/users/${id}`, data).then(r => r.data),
  remove:  (id) => api.delete(`/users/${id}`).then(r => r.data),
}

export const ldapApi = {
  getSettings:  () => api.get('/users/ldap-settings').then(r => r.data),
  saveSettings: (data) => api.post('/users/ldap-settings', data).then(r => r.data),
  testConn:     () => api.post('/users/ldap-test').then(r => r.data),
  getGroups:    () => api.get('/users/ldap-groups').then(r => r.data),
}

export const localGroupsApi = {
  getAll:        () => api.get('/groups').then(r => r.data),
  getOne:        (id) => api.get(`/groups/${id}`).then(r => r.data),
  create:        (data) => api.post('/groups', data).then(r => r.data),
  update:        (id, data) => api.put(`/groups/${id}`, data).then(r => r.data),
  remove:        (id) => api.delete(`/groups/${id}`).then(r => r.data),
  getMembers:    (id) => api.get(`/groups/${id}/members`).then(r => r.data),
  addMember:     (id, userId) => api.post(`/groups/${id}/members`, { userId }).then(r => r.data),
  removeMember:  (id, userId) => api.delete(`/groups/${id}/members/${userId}`).then(r => r.data),
  // Per Rules.jsx — lista semplificata senza requireAdmin (via users.js)
  getAllSimple:   () => api.get('/users/local-groups').then(r => r.data),
}

export const auditApi = {
  getAll:  (params) => api.get('/audit', { params }).then(r => r.data),
  purge:   (days) => api.delete('/audit', { params: { days } }).then(r => r.data),
}


export const messagesApi = {
  getAll:   (params) => api.get('/messages', { params }).then(r => r.data),
  getById:  (id) => api.get(`/messages/${id}`).then(r => r.data),
  getStats: () => api.get('/messages/stats').then(r => r.data),
  send:     (data) => api.post('/messages/send', data).then(r => r.data),
}

export const portsApi = {
  getAll:       (params) => api.get('/ports', { params }).then(r => r.data),
  setSimNumber: (deviceId, portNumber, simNumber) =>
    api.put(`/ports/${deviceId}/${portNumber}/sim`, { sim_number: simNumber }).then(r => r.data),
  setPortInfo:  (deviceId, portNumber, data) =>
    api.put(`/ports/${deviceId}/${portNumber}/info`, data).then(r => r.data),
}

export const devicesApi = {
  getAll:   () => api.get('/devices').then(r => r.data),
  getOne:   (id) => api.get(`/devices/${id}`).then(r => r.data),
  create:   (data) => api.post('/devices', data).then(r => r.data),
  update:   (id, data) => api.put(`/devices/${id}`, data).then(r => r.data),
  remove:   (id) => api.delete(`/devices/${id}`).then(r => r.data),
}

export const rulesApi = {
  getAll:  () => api.get('/rules').then(r => r.data),
  getOne:  (id) => api.get(`/rules/${id}`).then(r => r.data),
  create:  (data) => api.post('/rules', data).then(r => r.data),
  update:  (id, data) => api.put(`/rules/${id}`, data).then(r => r.data),
  remove:  (id) => api.delete(`/rules/${id}`).then(r => r.data),
  test:    (data) => api.post('/rules/test', data).then(r => r.data),
}

export const settingsApi = {
  getSmtp:       () => api.get('/settings/smtp').then(r => r.data),
  saveSmtp:      (data) => api.post('/settings/smtp', data).then(r => r.data),
  testSmtp:      (to) => api.post('/settings/smtp/test', { to }).then(r => r.data),
  getTemplate:   () => api.get('/settings/email-template').then(r => r.data),
  saveTemplate:  (template) => api.post('/settings/email-template', { template }).then(r => r.data),
  getSubject:    () => api.get('/settings/email-subject').then(r => r.data),
  saveSubject:   (subject) => api.post('/settings/email-subject', { subject }).then(r => r.data),
  getSaml:       () => api.get('/settings/saml').then(r => r.data),
  saveSaml:      (data) => api.post('/settings/saml', data).then(r => r.data),
  getWebhook:    () => api.get('/settings/webhook').then(r => r.data),
  saveWebhook:   (data) => api.post('/settings/webhook', data).then(r => r.data),
}

export const reportApi = {
  get: (days = 30) => api.get('/report', { params: { days } }).then(r => r.data),
}

export const healthApi = {
  get: () => api.get('/health').then(r => r.data),
}

export default api
